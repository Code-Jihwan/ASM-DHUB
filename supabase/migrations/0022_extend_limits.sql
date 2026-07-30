-- 예약 시간 한도 확대: 기본 2시간 → 3시간, 연장 2시간 → 3시간.
--   한 예약의 최대 길이는 3 + 3 = 6시간.
--
-- policy.max_base()/max_extend() 는 reservation_bounded 제약(0001)과
-- extend_reservation()(0006)이 실행 시점에 호출하므로, 함수만 바꾸면 한도가 함께 바뀐다.
-- (규칙은 policy.* 함수 한 곳에서 관리한다.)

create or replace function policy.max_base()   returns interval language sql immutable as $$ select interval '3 hours' $$;
create or replace function policy.max_extend() returns interval language sql immutable as $$ select interval '3 hours' $$;
