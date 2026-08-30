-- 버그 수정: 자리 변경("자리 옮기기")을 한 예약을 나중에 '연장'하면
--   "이용 시간은 10분 단위로만 가능합니다"로 거부되어 연장이 안 되는 문제.
--
-- 원인: change_reservation(0023)은 이미 지난 구간을 버리려고 시작을 '현재 분'으로
--   잘랐다(date_trunc('minute', now())). 그 결과 남은 이용 시간(종료-시작)이 10분의
--   배수가 아니게 된다(예: 60분 예약을 14:47에 옮기면 14:47~종료 = 36분).
--   이동 자체는 검증 트리거를 우회(app.moving)하므로 통과한다.
--   그러나 '연장'은 우회하지 않아, extend_reservation의 UPDATE가 트리거를 다시 태우고
--   트리거가 '이용 시간(종료-시작) % 10분' 검사에서 비정렬 값을 거부한다.
--
-- 해결: 자리 변경 시 시작을 '종료 시각 기준 10분 격자'에 맞춘다.
--   원래 이용 시간이 10분 배수였으므로(=종료 ≡ 시작 mod 10분), 격자에 맞춘 시작 역시
--   남은 시간이 항상 10분의 배수가 되어 이후 연장이 정상 동작한다.
--   종료 시각은 그대로라 실제로 쓸 수 있는 시간은 줄지 않는다(앞쪽 커버 구간만 <10분 당겨짐).
--   격자점은 '지금' 이후로만 잡아(과거 구간을 버려) 종료된 예약과의 가짜 충돌도 그대로 피한다.

------------------------------------------------------------------ 자리 이동
create or replace function change_reservation(p_old_id uuid, p_seat_id int)
returns reservation
language plpgsql security definer set search_path = public as $$
declare
  r         reservation;
  unit      int := policy.duration_unit();   -- 600초(10분)
  earliest  timestamptz;                      -- 과거를 버린, 가능한 가장 이른 시작
  new_start timestamptz;                       -- 10분 격자에 맞춘 실제 시작
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

  -- 이미 지난 구간은 버리고(→ earliest), 남은 이용 시간이 늘 10분 배수가 되도록
  -- 시작을 '종료 시각 기준' 10분 격자에 맞춘다. 격자점은 earliest 이후로만 잡는다.
  earliest := greatest(lower(r.period), date_trunc('minute', now()));
  if earliest >= upper(r.period) then
    raise exception '이미 종료된 예약은 옮길 수 없습니다';
  end if;

  new_start := upper(r.period)
             - (floor(extract(epoch from (upper(r.period) - earliest)) / unit)::bigint * unit)
               * interval '1 second';

  if new_start >= upper(r.period) then
    -- 남은 시간이 10분 미만 → 정렬 가능한 이용 시간이 없다(옮길 실익도 없음).
    raise exception '남은 이용 시간이 10분 미만이라 자리를 옮길 수 없습니다';
  end if;

  -- 옮겨갈 자리가 재예약 쿨다운 중이면 막는다(자리 이동으로 우회 방지).
  if exists (
    select 1 from reservation x
    where x.user_id = r.user_id
      and x.seat_id = p_seat_id
      and x.id <> p_old_id
      and (
        (x.status = 'active' and upper(x.period) <= now()
           and now() < upper(x.period) + policy.cooldown())
        or
        (x.status = 'cancelled' and x.cancelled_at is not null
           and x.cancelled_at - lower(x.period) >= policy.cancel_grace()
           and now() < x.cancelled_at + policy.cooldown())
      )
  ) then
    raise exception '방금 이용한 자리는 %분 뒤에 다시 예약할 수 있습니다. 다른 자리를 이용해 주세요',
      round(extract(epoch from policy.cooldown()) / 60);
  end if;

  -- 정렬/시간 검사는 건너뛰고(app.moving), 잠긴 자리·겹침만 강제한다.
  perform set_config('app.moving', 'on', true);

  update reservation
     set seat_id = p_seat_id,
         period  = tstzrange(new_start, upper(r.period), '[)')
   where id = p_old_id
  returning * into r;

  return r;
end;
$$;

grant execute on function change_reservation(uuid, int) to authenticated;

------------------------------------------------------------------ 기존 데이터 보정(일회성)
-- 이 수정 배포 전에 이미 자리 변경으로 '비정렬 이용 시간'이 된 채 아직 안 끝난 예약은
-- 지금도 연장이 막힌다. 그 예약들의 시작을 위와 같은 규칙(종료 기준 10분 격자, 지금 이후)으로
-- 한 번 스냅해 즉시 정상화한다. period는 부분집합으로 줄어들 뿐이라 새 충돌은 생기지 않는다.
--   대상: 활성·미종료·이용시간이 10분 배수가 아님·정렬 가능한 시간이 10분 이상·좌석 활성.
do $$
declare
  unit int := policy.duration_unit();
begin
  perform set_config('app.moving', 'on', true);
  update reservation r
     set period = tstzrange(
           upper(r.period)
             - (floor(extract(epoch from
                 (upper(r.period) - greatest(lower(r.period), date_trunc('minute', now())))
               ) / unit)::bigint * unit) * interval '1 second',
           upper(r.period), '[)')
   where r.status = 'active'
     and upper(r.period) > now()
     and extract(epoch from (upper(r.period) - lower(r.period)))::bigint % unit <> 0
     and extract(epoch from
           (upper(r.period) - greatest(lower(r.period), date_trunc('minute', now())))
         ) >= unit
     and exists (select 1 from seat s where s.id = r.seat_id and s.active);
end $$;
