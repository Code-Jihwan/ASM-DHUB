-- 개발용: 운영 시간을 24시간으로 열어 밤에도 예약을 테스트한다.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 Run.
--
-- 프론트는 .env.local 의 NEXT_PUBLIC_DEV_HOURS_24=1 로 함께 열어야 슬롯이 보인다.
-- 배포 전에는 반드시 아래 "되돌리기"를 실행해 08:00~20:00 으로 복구할 것.
--
-- 참고: 예약은 같은 날 안에서 끝나야 하므로(자정 넘김 금지), 23:30~24:00 슬롯은
-- 프론트에 떠도 DB가 거부한다. 그 30분만 빼면 하루 전 시간대 모두 테스트된다.

create or replace function policy.open_time()  returns time language sql immutable as $$ select time '00:00' $$;
create or replace function policy.close_time() returns time language sql immutable as $$ select time '23:59' $$;


-- ── 되돌리기 (배포 전 실행) ────────────────────────────────
-- create or replace function policy.open_time()  returns time language sql immutable as $$ select time '08:00' $$;
-- create or replace function policy.close_time() returns time language sql immutable as $$ select time '20:00' $$;
