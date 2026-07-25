-- 취소가 막히는 문제 수정
--
-- reservation_validate_trg 는 before insert or update 라서 status 만 바꾸는
-- 취소에도 시간 검증이 돌았다. 그 결과
--   - 정책 변경 전에 만든 예약(2시간 초과, 운영시간 밖)을 취소할 수 없고
--   - set_away(자리비움)와 change_reservation(옛 예약 취소 단계)도 함께 막혔다.
--
-- 시간과 좌석이 그대로면 검증할 것이 없다. 그때는 통과시킨다.

create or replace function reservation_validate() returns trigger
language plpgsql as $$
declare
  slot    int := policy.slot_seconds();
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

  if extract(epoch from lower(new.period))::bigint % slot <> 0
     or extract(epoch from upper(new.period))::bigint % slot <> 0 then
    raise exception '예약은 30분 단위로만 가능합니다';
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
