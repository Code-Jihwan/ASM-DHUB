-- 예약을 "지금부터 10분 단위"로 바꾼다.
--
-- 배경: 예약은 센터에 와서 하는 것이라, 30분 슬롯에 맞춰 절대 시각을 고르는 방식 대신
-- "지금부터 얼마 동안" 쓸지를 10분 단위로 고르게 한다. 시작은 현재 분(초 버림)이다.
--
-- 바뀌는 것은 정렬 검사뿐이다.
--   이전: 시작·종료가 각각 30분(policy.slot_seconds) 경계에 맞아야 함
--   이후: 시작은 분 단위(초=0), 이용 시간(종료-시작)은 10분의 배수
--
-- 최대 이용 시간은 reservation_bounded 제약(policy.max_base + max_extend)이 그대로 막는다.
-- 운영 시간·과거·동시 보유·자리비움 우회 등 나머지 로직은 0008 버전과 동일하다.

create or replace function policy.duration_unit() returns int language sql immutable as $$ select 600 $$;

create or replace function reservation_validate() returns trigger
language plpgsql as $$
declare
  unit    int  := policy.duration_unit();
  ltz     text := policy.tz();
  s_local timestamp;
  e_local timestamp;
begin
  -- 취소, 자리비움처럼 시간을 건드리지 않는 변경은 검증 대상이 아니다.
  if tg_op = 'UPDATE'
     and new.period = old.period
     and new.seat_id = old.seat_id then
    return new;
  end if;

  -- 시작은 분 단위(초 버림), 이용 시간은 10분의 배수.
  if extract(epoch from lower(new.period))::bigint % 60 <> 0 then
    raise exception '예약 시작 시각이 올바르지 않습니다';
  end if;
  if extract(epoch from (upper(new.period) - lower(new.period)))::bigint % unit <> 0 then
    raise exception '이용 시간은 10분 단위로만 가능합니다';
  end if;

  if not exists (select 1 from seat where id = new.seat_id and active) then
    raise exception '사용할 수 없는 좌석입니다';
  end if;

  -- 운영 시간. 같은 날 안에서 끝나야 한다.
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
