-- 자리비움 악용 방지: 한 예약에서 자리비움은 정해진 횟수(2회)까지만.
--
-- 악용 사례: 자리를 비웠다가 자동취소(20분) 직전에 '복귀'를 누르고 다시 비우기를
--   반복하면, 실제로는 자리에 없으면서 좌석을 무한정 점유할 수 있다. 자리비움 횟수를
--   예약당 2회로 제한해 이를 막는다. 복귀는 횟수에 세지 않는다.
--
-- 참고: away_since만 바꾸므로 검증 트리거는 그대로 통과한다(period·seat_id 불변 → early return).

-- 예약당 자리비움 최대 횟수. 화면의 POLICY.awayMaxCount와 짝을 이룬다.
create or replace function policy.away_max_count() returns int
  language sql immutable as $$ select 2 $$;

-- 이 예약에서 지금까지 자리비움을 누른 횟수(복귀는 세지 않음). 기존 예약은 0부터 시작.
alter table reservation add column if not exists away_count int not null default 0;

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

  if p_away then
    -- 이미 자리비움 상태면 그대로 둔다(중복 카운트 방지).
    if r.away_since is not null then
      return r;
    end if;
    -- 한 예약에서 자리비움은 정해진 횟수까지만. 비움/복귀 반복으로 자동취소를 회피하는 악용을 막는다.
    if r.away_count >= policy.away_max_count() then
      raise exception '자리비움은 예약당 %번까지만 사용할 수 있습니다', policy.away_max_count();
    end if;
    update reservation
       set away_since = now(),
           away_count = away_count + 1
     where id = p_id
    returning * into r;
  else
    -- 복귀: 자리비움 표시만 해제한다(횟수는 그대로).
    update reservation
       set away_since = null
     where id = p_id
    returning * into r;
  end if;

  return r;
end;
$$;

grant execute on function set_away(uuid, boolean) to authenticated;
