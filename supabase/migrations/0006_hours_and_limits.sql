-- 운영 정책 개편
--   예약 최대 2시간, 연장 2시간 1회 (총 4시간)
--   예약은 08:00~20:00 만. 그 밖의 시간은 자율 이용이라 예약을 받지 않는다.
--   자리비움 30분 허용

create or replace function policy.max_base()   returns interval language sql immutable as $$ select interval '2 hours' $$;
create or replace function policy.max_extend() returns interval language sql immutable as $$ select interval '2 hours' $$;

create or replace function policy.open_time()  returns time     language sql immutable as $$ select time '08:00' $$;
create or replace function policy.close_time() returns time     language sql immutable as $$ select time '20:00' $$;
create or replace function policy.tz()         returns text     language sql immutable as $$ select 'Asia/Seoul' $$;
create or replace function policy.away_grace() returns interval language sql immutable as $$ select interval '30 minutes' $$;


-- 자리비움 시작 시각. null이면 자리에 있는 상태.
alter table reservation add column if not exists away_since timestamptz;


-- 삽입 검증에 운영 시간을 추가한다.
create or replace function reservation_validate() returns trigger
language plpgsql as $$
declare
  slot    int := policy.slot_seconds();
  ltz     text := policy.tz();
  s_local timestamp;
  e_local timestamp;
begin
  if extract(epoch from lower(new.period))::bigint % slot <> 0
     or extract(epoch from upper(new.period))::bigint % slot <> 0 then
    raise exception '예약은 30분 단위로만 가능합니다';
  end if;

  if not exists (select 1 from seat where id = new.seat_id and active) then
    raise exception '사용할 수 없는 좌석입니다';
  end if;

  -- 운영 시간. 같은 날 안에서 끝나야 한다.
  -- (날짜 검사가 없으면 23시~02시 같은 예약이 시/분 비교만 통과해 버린다.)
  s_local := lower(new.period) at time zone ltz;
  e_local := upper(new.period) at time zone ltz;
  if s_local::time < policy.open_time()
     or e_local::time > policy.close_time()
     or s_local::date <> e_local::date then
    raise exception '예약은 %부터 %까지만 가능합니다. 그 밖의 시간은 자유롭게 이용하세요',
      to_char(policy.open_time()::interval, 'HH24:MI'),
      to_char(policy.close_time()::interval, 'HH24:MI');
  end if;

  if tg_op = 'INSERT' then
    if lower(new.period) < date_trunc('minute', now()) then
      raise exception '지난 시간은 예약할 수 없습니다';
    end if;

    if lower(new.period) > now() + policy.book_ahead() then
      raise exception '예약은 사용 시작 %시간 전부터 가능합니다',
        round(extract(epoch from policy.book_ahead()) / 3600);
    end if;

    -- 동시 보유 검사. 같은 유저의 요청을 직렬화해야 두 건이 동시에 통과하지 않는다.
    perform pg_advisory_xact_lock(hashtext(new.user_id::text));

    if exists (
      select 1 from reservation
      where user_id = new.user_id
        and status = 'active'
        and upper(period) > now()
    ) then
      raise exception '이미 예약이 있습니다. 종료 후 다시 예약해 주세요';
    end if;
  end if;

  return new;
end;
$$;


-- 연장도 운영 시간을 넘을 수 없다.
-- 18:00~20:00 예약은 연장이 불가능하다. 20시 이후는 어차피 자율 이용이다.
create or replace function extend_reservation(p_id uuid, p_new_end timestamptz)
returns reservation
language plpgsql security definer set search_path = public as $$
declare
  r   reservation;
  ltz text := policy.tz();
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
    raise exception '연장은 최대 %시간까지 가능합니다',
      round(extract(epoch from policy.max_extend()) / 3600);
  end if;

  if (p_new_end at time zone ltz)::time > policy.close_time()
     or (p_new_end at time zone ltz)::date <> (lower(r.period) at time zone ltz)::date then
    raise exception '연장은 %까지만 가능합니다',
      to_char(policy.close_time()::interval, 'HH24:MI');
  end if;

  update reservation
     set period = tstzrange(lower(period), p_new_end, '[)'),
         extended = true
   where id = p_id
  returning * into r;

  return r;
end;
$$;


-- 자리비움 표시. 이용 중일 때만 켤 수 있다.
-- 30분 초과는 DB에서 막지 않는다. 화면에 경과 시간을 띄우고 신고로 처리한다.
create or replace function set_away(p_id uuid, p_away boolean)
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
    raise exception '본인 예약만 바꿀 수 있습니다';
  end if;

  if now() < lower(r.period) or now() >= upper(r.period) then
    raise exception '이용 중일 때만 자리비움을 표시할 수 있습니다';
  end if;

  update reservation
     set away_since = case when p_away then now() else null end
   where id = p_id
  returning * into r;

  return r;
end;
$$;

grant execute on function set_away(uuid, boolean) to authenticated;
