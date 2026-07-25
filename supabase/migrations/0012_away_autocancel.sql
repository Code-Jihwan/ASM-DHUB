-- 자리비움 자동 취소.
--
-- 자리를 비운 지 20분이 지나면 예약을 자동으로 취소한다. 클라이언트도 자기 예약을
-- 스스로 취소하지만(앱이 열려 있을 때), 앱을 닫아 버린 경우까지 확실히 처리하려면
-- 서버에서 주기적으로 쓸어 줘야 남의 눈에도 그 좌석이 풀린다.

create or replace function policy.away_limit() returns interval language sql immutable as $$ select interval '20 minutes' $$;

-- 자리비움이 한도를 넘긴 예약을 모두 취소한다. 반환값은 취소된 건수.
-- security definer 라 남의 예약도 취소할 수 있고, status 만 바꾸므로 검증 트리거는 통과한다.
create or replace function cancel_stale_away() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update reservation
     set status = 'cancelled'
   where status = 'active'
     and away_since is not null
     and away_since < now() - policy.away_limit();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- pg_cron 으로 1분마다 실행한다.
--   1) Supabase 대시보드 > Database > Extensions 에서 pg_cron 을 켠다.
--   2) SQL Editor 에서 아래를 한 번 실행한다.
--
--   select cron.schedule('cancel-stale-away', '* * * * *', $$ select cancel_stale_away() $$);
--
-- 되돌리려면:  select cron.unschedule('cancel-stale-away');
