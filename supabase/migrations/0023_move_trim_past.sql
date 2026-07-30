-- 버그 수정: 자리 이동("이 자리로 옮기기")이 거의 매번 '이미 예약됨'으로 실패.
--
-- 원인: 이동은 원래 period(과거 시작 포함)를 그대로 둔 채 seat_id만 바꿨는데,
--   reservation_no_overlap exclusion 제약은 where(status='active')만 있고 시간 필터가 없다.
--   정상 종료된 예약은 status='active'로 영구히 남으므로(취소만 cancelled),
--   오늘 그 자리에서 [원래시작,종료]와 겹쳤던 종료 예약과 '과거 구간'이 겹쳐 가짜 충돌.
--   (seat_occupancy 뷰는 upper>now 라 그 자리를 UI에선 빈자리로 보여 준다.)
--   신규 예약은 시작이 now라 안 걸리고, 과거 구간을 가진 '이동'만 걸린다.
--
-- 해결: 이동 시 이미 지난 구간을 버리고 [max(now, 시작), 종료] 만 새 자리에 잡는다.
--   종료 시각은 그대로라 남은 이용 시간은 동일. 과거 구간이 없어 종료 예약과 안 겹친다.
--   트림한 시작은 10분 정렬이 아니므로, 이동 트랜잭션에선 검증 트리거의 정렬/시간
--   검사를 건너뛴다(app.moving). 잠긴 자리 차단·겹침은 그대로 강제된다.

------------------------------------------------------------------ 검증 트리거
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

  -- 자리 이동(change_reservation)은 이미 유효했던 예약을 옮기는 것이라
  -- 정렬·운영시간·삽입 검사는 건너뛴다. 잠긴 자리만 막고, 겹침은 exclusion 제약이 처리.
  if coalesce(current_setting('app.moving', true), 'off') = 'on' then
    if not exists (select 1 from seat where id = new.seat_id and active) then
      raise exception '사용할 수 없는 좌석입니다';
    end if;
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

    if coalesce(current_setting('app.skip_cooldown', true), 'off') <> 'on'
       and exists (
      select 1 from reservation r
      where r.user_id = new.user_id
        and r.seat_id = new.seat_id
        and (
          (r.status = 'active' and upper(r.period) <= now()
             and now() < upper(r.period) + policy.cooldown())
          or
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

------------------------------------------------------------------ 자리 이동
create or replace function change_reservation(p_old_id uuid, p_seat_id int)
returns reservation
language plpgsql security definer set search_path = public as $$
declare
  r         reservation;
  new_start timestamptz;
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

  -- 이미 지난 구간은 버리고 남은 시간만 새 자리에 잡는다.
  new_start := greatest(lower(r.period), date_trunc('minute', now()));
  if new_start >= upper(r.period) then
    raise exception '이미 종료된 예약은 옮길 수 없습니다';
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
