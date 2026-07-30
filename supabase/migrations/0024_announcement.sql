-- 팝업 공지. 관리자가 작성하면 사용자가 로그인 후 예약 화면에 들어올 때 팝업으로 뜬다.
--   단일 행(id=1)만 유지한다. active=false 면 안 뜬다.
--   updated_at 이 바뀌면(내용 수정) 다시 뜬다(클라이언트는 본 시각을 localStorage에 기록).

create table if not exists announcement (
  id         smallint    primary key default 1,
  title      text        not null default '',
  body       text        not null default '',
  active     boolean     not null default false,
  updated_at timestamptz not null default now(),
  constraint announcement_singleton check (id = 1),
  constraint announcement_title_len check (length(title) <= 100),
  constraint announcement_body_len  check (length(body)  <= 2000)
);

insert into announcement (id) values (1) on conflict (id) do nothing;

-- 수정 시 updated_at 자동 갱신.
create or replace function announcement_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists announcement_touch_trg on announcement;
create trigger announcement_touch_trg
  before update on announcement
  for each row execute function announcement_touch();

alter table announcement enable row level security;

-- 로그인한 누구나 읽는다(팝업 표시용).
drop policy if exists announcement_read on announcement;
create policy announcement_read on announcement
  for select to authenticated using (true);

-- 작성·수정은 관리자만.
drop policy if exists announcement_admin_write on announcement;
create policy announcement_admin_write on announcement
  for all to authenticated using (is_admin()) with check (is_admin());
