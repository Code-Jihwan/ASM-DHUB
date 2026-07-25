-- 부산센터 개발공간 좌석 예약 (48석, 24시간 운영)
--
-- 정책
--   기본 예약 최대 6시간 / 연장 1회 최대 3시간 (종료 1시간 전부터)
--   따라서 한 예약의 최대 길이는 9시간, 이후엔 새로 예약
--   1인 1건 동시 보유, 종료 후 재예약은 즉시 가능
--   예약 오픈은 사용 시작 12시간 전부터, 30분 단위

create extension if not exists btree_gist;

-- 정책 상수. 운영하며 조정되므로 한 곳에 모아둔다.
create schema if not exists policy;

create or replace function policy.max_base()      returns interval language sql immutable as $$ select interval '6 hours'  $$;
create or replace function policy.max_extend()    returns interval language sql immutable as $$ select interval '3 hours'  $$;
create or replace function policy.extend_window() returns interval language sql immutable as $$ select interval '1 hour'   $$;
create or replace function policy.book_ahead()    returns interval language sql immutable as $$ select interval '12 hours' $$;
create or replace function policy.slot_seconds()  returns int      language sql immutable as $$ select 1800 $$;


create table seat (
  id       int  primary key,
  label    text not null unique,
  zone     text,
  active   bool not null default true   -- 고장/공사 등으로 잠글 때 false
);


create table reservation (
  id         uuid        primary key default gen_random_uuid(),
  seat_id    int         not null references seat(id),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  period     tstzrange   not null,
  extended   bool        not null default false,
  status     text        not null default 'active' check (status in ('active', 'cancelled')),
  created_at timestamptz not null default now(),

  -- 같은 좌석에 시간이 겹치는 예약은 존재할 수 없다.
  -- 동시 클릭, 뒷예약 침범하는 연장 모두 여기서 막힌다.
  constraint reservation_no_overlap exclude using gist (
    seat_id with =,
    period  with &&
  ) where (status = 'active'),

  constraint reservation_bounded check (
    upper(period) - lower(period)
      <= policy.max_base() + case when extended then policy.max_extend() else interval '0' end
  ),

  constraint reservation_positive check (upper(period) > lower(period))
);

create index reservation_user_idx on reservation (user_id) where status = 'active';
create index reservation_period_idx on reservation using gist (period) where status = 'active';


-- 시각 기반 규칙은 now()에 의존해 immutable 하지 않으므로 트리거에서 검증한다.
create or replace function reservation_validate() returns trigger
language plpgsql as $$
declare
  slot int := policy.slot_seconds();
begin
  if extract(epoch from lower(new.period))::bigint % slot <> 0
     or extract(epoch from upper(new.period))::bigint % slot <> 0 then
    raise exception '예약은 30분 단위로만 가능합니다';
  end if;

  if not exists (select 1 from seat where id = new.seat_id and active) then
    raise exception '사용할 수 없는 좌석입니다';
  end if;

  if tg_op = 'INSERT' then
    if lower(new.period) < date_trunc('minute', now()) then
      raise exception '지난 시간은 예약할 수 없습니다';
    end if;

    if lower(new.period) > now() + policy.book_ahead() then
      raise exception '예약은 사용 시작 12시간 전부터 가능합니다';
    end if;

    -- 동시 보유 검사. 같은 유저의 요청을 직렬화해야 두 건이 동시에 통과하지 않는다.
    perform pg_advisory_xact_lock(hashtext(new.user_id::text));

    if exists (
      select 1 from reservation
      where user_id = new.user_id
        and status = 'active'
        and upper(period) > now()   -- 끝난 예약은 보유로 치지 않는다
    ) then
      raise exception '이미 예약이 있습니다. 종료 후 다시 예약해 주세요';
    end if;
  end if;

  return new;
end;
$$;

create trigger reservation_validate_trg
  before insert or update on reservation
  for each row execute function reservation_validate();


-- 연장. 겹침 검사는 exclude 제약이 대신하므로 정책만 확인한다.
create or replace function extend_reservation(p_id uuid, p_new_end timestamptz)
returns reservation
language plpgsql security definer set search_path = public as $$
declare
  r reservation;
begin
  select * into r from reservation where id = p_id for update;

  if not found or r.status <> 'active' then
    raise exception '예약을 찾을 수 없습니다';
  end if;

  if r.user_id <> auth.uid() then
    raise exception '본인 예약만 연장할 수 있습니다';
  end if;

  if r.extended then
    raise exception '연장은 1회만 가능합니다';
  end if;

  if now() < upper(r.period) - policy.extend_window() then
    raise exception '연장은 종료 1시간 전부터 가능합니다';
  end if;

  if now() >= upper(r.period) then
    raise exception '이미 종료된 예약입니다';
  end if;

  if p_new_end <= upper(r.period)
     or p_new_end > upper(r.period) + policy.max_extend() then
    raise exception '연장은 최대 3시간까지 가능합니다';
  end if;

  update reservation
     set period = tstzrange(lower(period), p_new_end, '[)'),
         extended = true
   where id = p_id
  returning * into r;

  return r;
end;
$$;


alter table seat        enable row level security;
alter table reservation enable row level security;

-- 좌석 현황은 로그인한 사람 누구나 본다.
create policy seat_read on seat
  for select to authenticated using (true);

-- 남의 예약도 시간대가 보여야 좌석도가 그려진다. 신원 노출은 뷰에서 가린다.
create policy reservation_read on reservation
  for select to authenticated using (true);

create policy reservation_insert on reservation
  for insert to authenticated with check (user_id = auth.uid());

create policy reservation_cancel on reservation
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


-- 좌석도가 쓰는 뷰. 본인 예약이 아니면 누구인지 알 수 없다.
create view seat_status with (security_invoker = true) as
select
  s.id            as seat_id,
  s.label,
  s.zone,
  s.active,
  r.id            as reservation_id,
  r.period,
  r.extended,
  r.user_id = auth.uid() as is_mine
from seat s
left join reservation r
  on r.seat_id = s.id
 and r.status = 'active'
 and upper(r.period) > now();


-- 좌석 현황을 실시간으로 밀어주기 위해 publication에 등록한다.
-- 로컬 PostgreSQL에는 이 publication이 없으므로 건너뛴다.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table reservation;
  end if;
end $$;


-- 48석: A/B 두 구역 24석씩
insert into seat (id, label, zone)
select n,
       format('%s-%s', case when n <= 24 then 'A' else 'B' end,
                       lpad((case when n <= 24 then n else n - 24 end)::text, 2, '0')),
       case when n <= 24 then 'A' else 'B' end
from generate_series(1, 48) as n;
