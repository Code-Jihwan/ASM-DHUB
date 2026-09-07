-- 회의실 예약 현황 스냅샷을 '로그인한 모든 사용자'에게 공개(조회 전용).
-- 0036 주석의 공개 절차 중 (1) 읽기 정책 개방에 해당. (2) 페이지/사이드바 게이트는 코드에서 해제됨.
-- 결정: 예약자 실명(who)·예약명(title)을 별도 마스킹 없이 전체 공개한다(운영자 방침).
--
-- 쓰기(save/clear)는 그대로 잠겨 있다 — security-definer RPC(is_admin 게이트) 또는 service_role 로만 기록.
-- 여기서는 읽기 정책만 using(true) 로 넓힌다.

drop policy if exists mrs_read on meeting_room_snapshot;
create policy mrs_read on meeting_room_snapshot
  for select to authenticated using (true);
