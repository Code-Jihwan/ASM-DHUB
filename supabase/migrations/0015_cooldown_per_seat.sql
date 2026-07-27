-- 재예약 쿨다운을 (사람 × 자리) 단위로 바꾼다.
--   목적: 한 사람이 같은 자리를 계속 붙잡고 있는 것을 막는다.
--   홍길동이 1번 자리를 쓰고 끝나면 → 홍길동은 1번을 20분간 다시 못 잡는다.
--   같은 홍길동도 다른 자리는 즉시 예약 가능. 남들도 1번을 즉시 예약 가능.
--
--   취소도 쿨다운을 건다. 단 10분 이내에 취소한 경우는 봐준다(자리 잘못 골라 바로 취소 등).
--   취소 시점 기준으로 20분. 그래서 취소 시각(cancelled_at)을 기록한다.

alter table reservation add column if not exists cancelled_at timestamptz;

create or replace function policy.cancel_grace() returns interval language sql immutable as $$ select interval '10 minutes' $$;

-- 상태가 cancelled 로 바뀌는 순간 취소 시각을 남긴다. (클라이언트 취소, 자동 취소, 변경 모두 포함)
create or replace function reservation_stamp_cancel() returns trigger
language plpgsql as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    new.cancelled_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists reservation_stamp_cancel_trg on reservation;
create trigger reservation_stamp_cancel_trg
  before update on reservation
  for each row execute function reservation_stamp_cancel();

-- 삽입 검증 + 자리별 쿨다운.
create or replace function reservation_validate() returns trigger
language plpgsql as $$
declare
  unit    int  := policy.duration_unit();
  ltz     text := policy.tz();
  s_local timestamp;
  e_local timestamp;
begin
  if tg_op = 'UPDATE'
     and new.period = old.period
     and new.seat_id = old.seat_id then
    return new;
  end if;

  if extract(epoch from lower(new.period))::bigint % 60 <> 0 then
    raise exception '예약 시작 시각이 올바르지 않습니다';
  end if;
  if extract(epoch from (upper(new.period) - lower(new.period)))::bigint % unit <> 0 then
    raise exception '이용 시간은 10분 단위로만 가능합니다';
  end if;

  if not exists (select 1 from seat where id = new.seat_id and active) then
    raise exception '사용할 수 없는 좌석입니다';
  end if;

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

    -- 자리별 재예약 쿨다운. 변경(change_reservation)은 app.skip_cooldown 으로 건너뛴다.
    if coalesce(current_setting('app.skip_cooldown', true), 'off') <> 'on'
       and exists (
      select 1 from reservation r
      where r.user_id = new.user_id
        and r.seat_id = new.seat_id
        and (
          -- 정상 종료: 종료 후 쿨다운 안 지남
          (r.status = 'active' and upper(r.period) <= now()
             and now() < upper(r.period) + policy.cooldown())
          or
          -- 취소: 10분 이상 점유하고 취소한 경우만, 취소 시점 기준 쿨다운
          (r.status = 'cancelled' and r.cancelled_at is not null
             and r.cancelled_at - lower(r.period) >= policy.cancel_grace()
             and now() < r.cancelled_at + policy.cooldown())
        )
    ) then
      raise exception '방금 이용한 자리는 %분 뒤에 다시 예약할 수 있습니다. 다른 자리를 이용해 주세요',
        round(extract(epoch from policy.cooldown()) / 60);
    end if;
  end if;

  return new;
end;
$$;

-- 예약 변경은 옛 예약을 취소하고 새로 넣는다. 같은 자리로 시간만 옮길 때 방금 취소한 것이
-- 쿨다운을 걸지 않도록, 이 트랜잭션에서만 쿨다운을 건너뛴다.
create or replace function change_reservation(
  p_old_id  uuid,
  p_seat_id int,
  p_period  tstzrange
) returns reservation
language plpgsql security definer set search_path = public as $$
declare
  old_r reservation;
  new_r reservation;
begin
  select * into old_r from reservation where id = p_old_id for update;

  if not found or old_r.status <> 'active' then
    raise exception '변경할 예약을 찾을 수 없습니다';
  end if;

  if old_r.user_id <> auth.uid() then
    raise exception '본인 예약만 변경할 수 있습니다';
  end if;

  perform set_config('app.skip_cooldown', 'on', true); -- 이 트랜잭션 한정

  update reservation set status = 'cancelled' where id = p_old_id;

  insert into reservation (seat_id, user_id, period)
  values (p_seat_id, old_r.user_id, p_period)
  returning * into new_r;

  return new_r;
end;
$$;
