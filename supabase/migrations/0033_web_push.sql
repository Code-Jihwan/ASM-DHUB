-- 웹 푸시 알림. 기기(브라우저)마다 구독을 저장하고, 4가지 예약 이벤트가 생기면
-- 서버(Next /api/push/run)가 그 사용자의 기기로 푸시를 보낸다.
--   · push_subscription : 기기별 푸시 구독(endpoint + 키). 본인 것만 RLS.
--   · notif_log         : (예약, 이벤트) 1회만 보내기 위한 중복방지 로그.
--   · claim_due_push_events() : 지금 보내야 할 이벤트를 '집어들고'(notif_log에 기록)
--                               새로 집어든 것만 반환. 발송 자체는 서버가 한다.
-- pg_cron이 1분마다 /api/push/run 을 호출 → 그 안에서 이 함수를 부른다(스케줄은 별도 SQL).

------------------------------------------------------------------ 구독 테이블
create table if not exists push_subscription (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  endpoint   text        not null unique,
  p256dh     text        not null,
  auth       text        not null,
  ua         text,
  created_at timestamptz not null default now()
);
create index if not exists push_subscription_user_idx on push_subscription (user_id);

alter table push_subscription enable row level security;

-- 본인 구독만 등록/조회/삭제. (발송 서버는 service_role로 RLS를 우회해 전체를 읽는다.)
drop policy if exists push_sub_own on push_subscription;
create policy push_sub_own on push_subscription
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

------------------------------------------------------------------ 중복방지 로그
create table if not exists notif_log (
  reservation_id uuid        not null,
  dedup_key      text        not null,
  created_at     timestamptz not null default now(),
  primary key (reservation_id, dedup_key)
);
-- notif_log은 서버(service_role)만 다루므로 RLS로 잠가 둔다(정책 없음 = 일반 사용자 접근 불가).
alter table notif_log enable row level security;

------------------------------------------------------------------ 발송 대상 판정 + 집기
-- 지금 시각 기준 보내야 할 이벤트를 계산하고, notif_log에 없는 것만 새로 기록한 뒤
-- 그 '새로 집어든' 이벤트만 반환한다(= 각 이벤트는 딱 한 번만 발송된다).
create or replace function claim_due_push_events()
returns table (user_id uuid, kind text, title text, body text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    -- 자리비움 복귀 경고: 비운 지 (한도-5분)=15분 지났고 아직 자동취소 전
    select r.id, r.user_id, 'away_return'::text as kind,
           'away:' || extract(epoch from r.away_since)::bigint as dkey, s.label as seat
    from reservation r join seat s on s.id = r.seat_id
    where r.status = 'active' and r.away_since is not null
      and now() >= r.away_since + (policy.away_limit() - interval '5 minutes')
      and now() <  r.away_since + policy.away_limit()
    union all
    -- 연장 가능: 종료 1시간 전(연장 창 열림)부터 종료까지, 아직 연장 안 함
    select r.id, r.user_id, 'extend_open', 'extend', s.label
    from reservation r join seat s on s.id = r.seat_id
    where r.status = 'active' and r.extended = false
      and now() >= upper(r.period) - policy.extend_window()
      and now() <  upper(r.period)
    union all
    -- 종료 임박: 종료 10분 전부터 종료까지
    select r.id, r.user_id, 'ending_soon', 'ending', s.label
    from reservation r join seat s on s.id = r.seat_id
    where r.status = 'active'
      and now() >= upper(r.period) - interval '10 minutes'
      and now() <  upper(r.period)
    union all
    -- 자동취소됨: 자리비움 초과로 취소된 예약(최근 것만, 배포 직후 과거건 백필 방지)
    select r.id, r.user_id, 'auto_cancel', 'autocancel', s.label
    from reservation r join seat s on s.id = r.seat_id
    where r.status = 'cancelled' and r.away_since is not null
      and upper(r.period) > now() - interval '3 hours'
  ),
  claimed as (
    insert into notif_log (reservation_id, dedup_key)
    select id, dkey from due
    on conflict (reservation_id, dedup_key) do nothing
    returning reservation_id, dedup_key
  )
  select d.user_id, d.kind,
    case d.kind
      when 'away_return' then '자리 비운 지 15분'
      when 'extend_open' then '이제 연장할 수 있어요'
      when 'ending_soon' then '10분 뒤 예약 종료'
      else '예약이 자동취소됐어요'
    end,
    case d.kind
      when 'away_return' then d.seat || '번 자리 — 5분 안에 복귀 안 하면 자동취소돼요'
      when 'extend_open' then d.seat || '번 자리 — 더 쓰려면 지금 연장하세요'
      when 'ending_soon' then d.seat || '번 자리 — 연장하거나 반납해 주세요'
      else '자리비움 시간 초과로 ' || d.seat || '번 자리 예약이 취소됐어요'
    end
  from due d
  join claimed c on c.reservation_id = d.id and c.dedup_key = d.dkey;
end $$;

-- 발송 서버(service_role)만 호출한다.
grant execute on function claim_due_push_events() to service_role;
