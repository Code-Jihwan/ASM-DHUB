-- 로컬 검증용 auth 스키마 스텁.
-- Supabase가 관리형으로 제공하는 것을 순수 PostgreSQL에서 흉내낸다.
-- 실제 배포에는 사용하지 않는다.

-- Supabase가 기본 제공하는 롤
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique
);

-- 세션에 set local request.jwt.claim.sub = '<uuid>' 로 현재 유저를 지정한다.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
