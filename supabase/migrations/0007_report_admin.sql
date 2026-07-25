-- 신고 접수, 관리자 권한, 좌석별 예약자 이름 공개

------------------------------------------------------------------ 관리자
alter table profile add column if not exists is_admin boolean not null default false;

-- profile의 RLS 정책 안에서 profile을 다시 조회하면 무한 재귀가 난다.
-- security definer로 RLS를 우회해 판정한다.
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profile where user_id = auth.uid()), false)
$$;

grant execute on function is_admin() to authenticated;

-- 다시 실행해도 안전하도록 지우고 만든다.
drop policy if exists profile_read_admin on profile;
create policy profile_read_admin on profile
  for select to authenticated using (is_admin());


------------------------------------------------------------------ 신고
create table if not exists report (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  seat_id     int  references seat(id),
  message     text not null,
  resolved    bool not null default false,
  created_at  timestamptz not null default now(),

  constraint report_message_len check (length(btrim(message)) between 1 and 1000)
);

create index if not exists report_open_idx on report (created_at desc) where not resolved;

alter table report enable row level security;

drop policy if exists report_insert_own on report;
create policy report_insert_own on report
  for insert to authenticated with check (reporter_id = auth.uid());

drop policy if exists report_read_own on report;
create policy report_read_own on report
  for select to authenticated using (reporter_id = auth.uid());

drop policy if exists report_read_admin on report;
create policy report_read_admin on report
  for select to authenticated using (is_admin());

drop policy if exists report_resolve_admin on report;
create policy report_resolve_admin on report
  for update to authenticated using (is_admin()) with check (is_admin());


------------------------------------------------------------------ 좌석별 예약자 이름
-- 좌석 박스에 예약자 이름을 띄우려면 남의 프로필을 읽어야 하는데,
-- profile RLS는 본인 것만 허용한다. 이름만 골라 내보내는 뷰를 둔다.
-- security_invoker = false 라서 뷰 소유자 권한으로 돌아 RLS를 우회한다.
-- 연락처와 팀은 여기에 포함하지 않는다.
create or replace view seat_occupancy with (security_invoker = false) as
select
  r.seat_id,
  r.id         as reservation_id,
  r.user_id,
  r.period,
  r.extended,
  r.away_since,
  p.name       as reserver_name
from reservation r
join profile p on p.user_id = r.user_id
where r.status = 'active'
  and upper(r.period) > now();

revoke all on seat_occupancy from anon;
grant select on seat_occupancy to authenticated;


------------------------------------------------------------------ 관리자용 좌석 이력
create or replace function admin_seat_history(p_seat_id int)
returns table (
  reservation_id uuid,
  period         tstzrange,
  extended       bool,
  status         text,
  away_since     timestamptz,
  name           text,
  team           text,
  phone          text,
  created_at     timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception '관리자만 볼 수 있습니다';
  end if;

  return query
    select r.id, r.period, r.extended, r.status, r.away_since,
           p.name, p.team, p.phone, r.created_at
    from reservation r
    left join profile p on p.user_id = r.user_id
    where r.seat_id = p_seat_id
    order by lower(r.period) desc
    limit 200;
end;
$$;

grant execute on function admin_seat_history(int) to authenticated;
