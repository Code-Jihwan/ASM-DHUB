-- 예약 변경. 좌석이나 시간을 바꾼다.
--
-- "취소 후 재예약"을 클라이언트에서 두 번에 나눠 하면 위험하다.
--   - 그 사이에 남이 자리를 채갈 수 있고
--   - 새 예약이 실패하면 원래 예약까지 잃는다
-- 한 트랜잭션에서 기존 취소 + 새 삽입을 처리한다. 새 예약이 어떤 제약이든
-- 위반하면 전체가 롤백되어 원래 예약이 그대로 남는다.

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

  -- 먼저 취소해야 1인 1건 검사와 겹침 제약을 통과한다.
  -- 같은 좌석 다른 시간으로 옮기는 것도 이 덕분에 가능하다.
  update reservation set status = 'cancelled' where id = p_old_id;

  -- 삽입 트리거(30분 단위, 좌석 유효성, 12시간 창, 프로필 보유)와
  -- 겹침 제약이 그대로 적용된다. 하나라도 걸리면 여기서 예외가 나고 롤백된다.
  insert into reservation (seat_id, user_id, period)
  values (p_seat_id, old_r.user_id, p_period)
  returning * into new_r;

  return new_r;
end;
$$;

grant execute on function change_reservation(uuid, int, tstzrange) to authenticated;
