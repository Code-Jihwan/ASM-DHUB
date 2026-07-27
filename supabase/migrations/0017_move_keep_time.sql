-- 자리 변경을 "시간 그대로, 자리만 이동"으로 바꾼다.
--   기존엔 옛 예약을 취소하고 새 시간으로 다시 넣었다(0005/0015).
--   이제는 예약 행의 seat_id 만 바꾼다. 이용 시간(period)은 그대로 유지된다.
--     · 옮길 자리가 그 시간에 이미 차 있으면 exclusion 제약(reservation_no_overlap)이 막는다.
--     · 점검용으로 잠근 자리(active=false)는 검증 트리거가 막는다.
--     · 취소·재삽입이 없으므로 재예약 쿨다운도 걸리지 않는다.
--   검증 트리거의 INSERT 전용 검사(지난 시간·예약 오픈 시각 등)는 UPDATE라 건너뛴다.

drop function if exists change_reservation(uuid, int, tstzrange);

create or replace function change_reservation(p_old_id uuid, p_seat_id int)
returns reservation
language plpgsql security definer set search_path = public as $$
declare
  r reservation;
begin
  select * into r from reservation where id = p_old_id for update;

  if not found or r.status <> 'active' then
    raise exception '변경할 예약을 찾을 수 없습니다';
  end if;

  if r.user_id <> auth.uid() then
    raise exception '본인 예약만 변경할 수 있습니다';
  end if;

  if r.seat_id = p_seat_id then
    return r; -- 같은 자리면 변화 없음
  end if;

  update reservation set seat_id = p_seat_id where id = p_old_id
  returning * into r;

  return r;
end;
$$;

grant execute on function change_reservation(uuid, int) to authenticated;
