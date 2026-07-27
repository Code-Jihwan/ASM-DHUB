-- 관리자가 특정 좌석을 점검용으로 잠그거나 다시 연다.
--   seat.active = false 이면 예약 검증 트리거(0001)가 새 예약을 막는다.
--   잠글 때는 그 자리의 아직 끝나지 않은 활성 예약(진행 중·예정)을 함께 취소한다.
--   점검하려면 자리를 비워야 하기 때문. 반환값은 취소된 예약 건수.

create or replace function admin_set_seat_active(p_seat_id int, p_active boolean)
returns int
language plpgsql security definer set search_path = public as $$
declare
  affected int := 0;
begin
  if not is_admin() then
    raise exception '관리자만 변경할 수 있습니다';
  end if;

  if not exists (select 1 from seat where id = p_seat_id) then
    raise exception '존재하지 않는 좌석입니다';
  end if;

  -- 잠글 때만: 아직 안 끝난 그 자리의 활성 예약을 취소한다.
  -- status 만 바꾸므로 검증 트리거는 통과하고, cancelled_at 은 stamp 트리거가 찍는다.
  if not p_active then
    update reservation
       set status = 'cancelled'
     where seat_id = p_seat_id
       and status = 'active'
       and upper(period) > now();
    get diagnostics affected = row_count;
  end if;

  update seat set active = p_active where id = p_seat_id;
  return affected;
end;
$$;

grant execute on function admin_set_seat_active(int, boolean) to authenticated;
