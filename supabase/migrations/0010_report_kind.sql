-- 신고 개선: 유형(kind)과 신고 대상 예약자 스냅샷을 남긴다.
--
-- 기존 신고는 seat_id와 message만 담아서, "누구를" 신고한 것인지 알 수 없었다.
-- 자리 주인은 시간이 지나면 바뀌므로, 신고 시점의 예약자·예약을 함께 박아 둬야
-- 관리자가 대상을 특정해 처리할 수 있다.
--
--   occupancy — 자리 이용 신고 (안 비움 / 오래 비움 / 무단 사용). 대상 좌석·예약자를 담는다.
--   facility  — 좌석·시설 고장. 좌석만 담고 예약자는 없다.
--   other     — 좌석과 무관한 의견. 아무것도 담지 않는다.

alter table report
  add column if not exists kind             text not null default 'other',
  add column if not exists reported_user_id uuid references auth.users(id) on delete set null,
  add column if not exists reported_name    text,
  add column if not exists reservation_id   uuid references reservation(id) on delete set null;

alter table report drop constraint if exists report_kind_valid;
alter table report
  add constraint report_kind_valid check (kind in ('occupancy', 'facility', 'other'));

-- reported_name은 신고 시점 스냅샷이다. 이후 예약자가 탈퇴하거나 이름을 바꿔도
-- 신고 당시 누구였는지 그대로 남는다. RLS는 기존 정책을 그대로 쓴다
-- (본인 삽입, 본인·관리자 조회, 관리자 처리). 새 컬럼은 삽입 시 함께 들어간다.
