-- 이용자 프로필. 구글 로그인만으로는 이름/팀/연락처를 알 수 없어 따로 받는다.
-- 운영자가 "누가 썼는지" 파악하는 데 필요한 최소 정보만 둔다.

create table profile (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  name       text not null,
  team       text not null,
  phone      text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profile_name_filled  check (length(btrim(name)) between 1 and 40),
  constraint profile_team_filled  check (length(btrim(team)) between 1 and 40),
  -- 하이픈 없이 숫자만 저장한다. 010 계열 휴대폰만 받는다.
  constraint profile_phone_format check (phone ~ '^01[016789][0-9]{7,8}$')
);

create index profile_team_idx on profile (team);


create or replace function profile_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profile_touch_trg
  before update on profile
  for each row execute function profile_touch();


-- 프로필 없이는 예약할 수 없다. 화면에서만 막으면 API로 우회된다.
create or replace function reservation_requires_profile() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from profile where user_id = new.user_id) then
    raise exception '예약 전에 이름, 팀, 연락처를 등록해 주세요';
  end if;
  return new;
end;
$$;

create trigger reservation_requires_profile_trg
  before insert on reservation
  for each row execute function reservation_requires_profile();


alter table profile enable row level security;

-- 본인 것만 보고 고칠 수 있다.
-- 좌석도에 남의 이름이 뜨지 않는 이유이기도 하다.
create policy profile_read_own on profile
  for select to authenticated using (user_id = auth.uid());

create policy profile_insert_own on profile
  for insert to authenticated with check (user_id = auth.uid());

create policy profile_update_own on profile
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
