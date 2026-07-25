-- policy 스키마 접근 권한.
--
-- reservation_validate() 트리거와 reservation_bounded 제약은 policy.* 함수를 호출하는데,
-- 둘 다 호출한 사용자의 권한으로 실행된다. 권한이 없으면 로그인한 사용자도
-- "permission denied for schema policy"로 예약에 실패한다.
--
-- 로컬 테스트는 superuser로 돌아 이 문제가 드러나지 않는다.

grant usage on schema policy to anon, authenticated;
grant execute on all functions in schema policy to anon, authenticated;

-- 나중에 policy에 함수를 추가해도 권한이 따라가도록
alter default privileges in schema policy
  grant execute on functions to anon, authenticated;

-- 연장 함수는 security definer라 소유자 권한으로 돌지만, 호출 자체는 허용돼야 한다.
grant execute on function extend_reservation(uuid, timestamptz) to authenticated;
