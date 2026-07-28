-- 허점 수정: 자리 변경(change_reservation)이 재예약 쿨다운을 우회하던 문제.
--   예) 26번을 자리비움으로 취소당해 26번이 쿨다운 → 27번을 예약한 뒤
--       27→26 자리 이동으로 26번을 다시 차지하던 우회.
--   옮겨갈 자리가 이 사용자에게 쿨다운 중이면 이동을 막는다.
--   (쿨다운 판정은 0015의 reservation_validate INSERT 검사와 동일한 조건)

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

  -- 옮겨갈 자리가 재예약 쿨다운 중이면 막는다(자리 이동으로 우회 방지).
  if exists (
    select 1 from reservation x
    where x.user_id = r.user_id
      and x.seat_id = p_seat_id
      and x.id <> p_old_id
      and (
        -- 정상 종료: 종료 후 쿨다운 안 지남
        (x.status = 'active' and upper(x.period) <= now()
           and now() < upper(x.period) + policy.cooldown())
        or
        -- 취소: 10분 이상 점유 후 취소한 경우, 취소 시점 기준 쿨다운(자리비움 자동취소 포함)
        (x.status = 'cancelled' and x.cancelled_at is not null
           and x.cancelled_at - lower(x.period) >= policy.cancel_grace()
           and now() < x.cancelled_at + policy.cooldown())
      )
  ) then
    raise exception '방금 이용한 자리는 %분 뒤에 다시 예약할 수 있습니다. 다른 자리를 이용해 주세요',
      round(extract(epoch from policy.cooldown()) / 60);
  end if;

  -- 겹침은 exclusion 제약이, 잠긴 자리는 검증 트리거가 막는다.
  update reservation set seat_id = p_seat_id where id = p_old_id
  returning * into r;

  return r;
end;
$$;

grant execute on function change_reservation(uuid, int) to authenticated;
