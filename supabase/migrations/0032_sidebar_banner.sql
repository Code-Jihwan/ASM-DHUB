-- 사이드바 광고 배너(관리자 관리형). PC 사이드바 하단 슬롯에 노출한다.
--   이미지는 Supabase Storage(banners 버킷, 공개)에 올리고,
--   배너 행(단일, id=1)에 이미지 URL·링크·대체텍스트·on/off 를 둔다.
--   팝업 공지(0024)와 같은 방식: 읽기는 로그인 사용자 전체, 수정은 관리자만.

------------------------------------------------------------------ 1) 스토리지 버킷
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('banners', 'banners', true, 2097152,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

-- 업로드·수정·삭제는 관리자만. 공개 버킷이라 조회(다운로드)는 공개.
drop policy if exists "banners admin insert" on storage.objects;
create policy "banners admin insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'banners' and public.is_admin());

drop policy if exists "banners admin update" on storage.objects;
create policy "banners admin update" on storage.objects
  for update to authenticated
  using (bucket_id = 'banners' and public.is_admin())
  with check (bucket_id = 'banners' and public.is_admin());

drop policy if exists "banners admin delete" on storage.objects;
create policy "banners admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'banners' and public.is_admin());

drop policy if exists "banners public read" on storage.objects;
create policy "banners public read" on storage.objects
  for select to public
  using (bucket_id = 'banners');

------------------------------------------------------------------ 2) 배너 설정(단일 행)
create table if not exists banner (
  id         smallint    primary key default 1,
  image_url  text,
  link_url   text,
  alt        text        not null default '',
  active     boolean     not null default false,
  updated_at timestamptz not null default now(),
  constraint banner_singleton check (id = 1),
  constraint banner_alt_len check (length(alt) <= 200)
);

insert into banner (id) values (1) on conflict (id) do nothing;

-- 수정 시 updated_at 자동 갱신.
create or replace function banner_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists banner_touch_trg on banner;
create trigger banner_touch_trg
  before update on banner
  for each row execute function banner_touch();

alter table banner enable row level security;

-- 로그인한 누구나 읽는다(사이드바 표시용).
drop policy if exists banner_read on banner;
create policy banner_read on banner
  for select to authenticated using (true);

-- 작성·수정은 관리자만.
drop policy if exists banner_admin_write on banner;
create policy banner_admin_write on banner
  for all to authenticated using (is_admin()) with check (is_admin());
