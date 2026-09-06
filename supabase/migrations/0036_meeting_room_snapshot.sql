-- 회의실 예약 현황을 서버에 저장(단일 스냅샷). 관리자가 올린 파싱 결과(JSONB)를 공유한다.
-- 여러 관리자가 같은 데이터를 보고, 새 파일을 올리면 통째로 교체된다.
--
-- 지금은 관리자 전용(읽기·쓰기 모두). '연수생 전체 공개'는 한 줄로 끝나지 않는다:
--   (1) 아래 mrs_read 를 using(true) 로 넓히고,
--   (2) src/app/rooms/page.tsx 의 is_admin 리다이렉트와 Sidebar 노출 게이트를 풀어야 하며,
--   (3) data 에 예약자 실명(who)·예약명(title)이 그대로 담겨 전체 연수생에게 노출되므로,
--       마스킹하거나 공개용 축약 뷰를 먼저 만들어야 한다(별도 작업).
--   이 마이그레이션만으로는 공개되지 않는다.

create table if not exists meeting_room_snapshot (
  id               smallint primary key default 1,
  data             jsonb not null,       -- 파싱 결과(ParseResult): 예약·회의실·날짜 등
  uploaded_by      uuid references auth.users(id) on delete set null,
  uploaded_by_name text,                 -- 올린 사람 이름(읽는 쪽이 profile 조인 없이 보여주도록 비정규화)
  uploaded_at      timestamptz not null default now(),
  constraint meeting_room_snapshot_singleton check (id = 1)
);

alter table meeting_room_snapshot enable row level security;

-- 읽기: 관리자만. (공개 전환은 위 주석 참고 — 정책만 바꾼다고 끝이 아니다.)
drop policy if exists mrs_read on meeting_room_snapshot;
create policy mrs_read on meeting_room_snapshot
  for select to authenticated using (is_admin());

-- 쓰기는 정책으로 열지 않는다 → 아래 security-definer 함수(save/clear)로만 가능.

-- 저장(업서트). 업로더 신원(id·이름)은 서버가 채운다.
-- search_path='' + 스키마 정규화(방어심층: pg_temp 릴레이션 섀도잉 차단). 입력 형태/크기도 검증.
create or replace function save_meeting_room_snapshot(p_data jsonb)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  ts timestamptz := now();
  nm text;
begin
  if not public.is_admin() then
    raise exception '관리자만 올릴 수 있습니다';
  end if;
  if jsonb_typeof(p_data) is distinct from 'object'
     or jsonb_typeof(p_data -> 'bookings') is distinct from 'array' then
    raise exception '올바른 회의실 예약 현황 데이터가 아닙니다';
  end if;
  if octet_length(p_data::text) > 1000000 then
    raise exception '데이터가 너무 큽니다';
  end if;
  select name into nm from public.profile where user_id = auth.uid();
  insert into public.meeting_room_snapshot (id, data, uploaded_by, uploaded_by_name, uploaded_at)
  values (1, p_data, auth.uid(), nm, ts)
  on conflict (id) do update set
    data = excluded.data,
    uploaded_by = excluded.uploaded_by,
    uploaded_by_name = excluded.uploaded_by_name,
    uploaded_at = excluded.uploaded_at;
  return ts;
end;
$$;
grant execute on function save_meeting_room_snapshot(jsonb) to authenticated;

-- 삭제(관리자만).
create or replace function clear_meeting_room_snapshot()
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception '관리자만 지울 수 있습니다';
  end if;
  delete from public.meeting_room_snapshot where id = 1;
end;
$$;
grant execute on function clear_meeting_room_snapshot() to authenticated;

-- 실시간 반영(관리자가 올리면 열려 있는 화면이 스스로 갱신). Supabase 환경에서만 적용된다.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'meeting_room_snapshot'
     ) then
    alter publication supabase_realtime add table meeting_room_snapshot;
  end if;
end $$;
