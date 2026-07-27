-- 부산센터 연수생 명단(roster)으로 가입을 통제한다.
--   온보딩에서 입력한 (팀명, 이름)이 명단에 있어야 가입 승인.
--   한 명단 항목은 한 계정에만 연결(claimed). 같은 사람이 다른 구글 계정으로
--   재가입하려 해도 이미 사용된 항목이라 거부된다.
--
-- 매칭은 공백을 모두 제거하고 소문자로 바꾼 정규화 키로 한다.
--   "소마 1팀" = "소마1팀", "Hong Gildong" = "honggildong" 처럼 사소한 표기차를 흡수.

create table if not exists roster (
  id         bigint generated always as identity primary key,
  team       text not null,
  name       text not null,
  -- 정규화 키: 공백 제거 + 소문자. 팀|이름.
  norm       text generated always as (
    regexp_replace(lower(team), '\s+', '', 'g') || '|' || regexp_replace(lower(name), '\s+', '', 'g')
  ) stored,
  claimed_by uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint roster_team_len check (length(btrim(team)) between 1 and 40),
  constraint roster_name_len check (length(btrim(name)) between 1 and 40)
);

-- 같은 (팀,이름) 중복 등록 방지
create unique index if not exists roster_norm_uidx on roster (norm);

alter table roster enable row level security;

-- 명단은 관리자만 조회·관리한다(가입 대조는 아래 security definer 함수가 대신 한다).
drop policy if exists roster_admin_all on roster;
create policy roster_admin_all on roster
  for all to authenticated using (is_admin()) with check (is_admin());

-- 온보딩: (이름, 팀)을 명단과 대조해 통과하면 프로필을 만든다.
--   security definer 라 명단 RLS를 우회해 대조/잠금한다.
create or replace function register_profile(p_name text, p_team text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_norm    text;
  v_id      bigint;
  v_claimed uuid;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다';
  end if;

  if length(btrim(p_name)) = 0 or length(btrim(p_team)) = 0 then
    raise exception '이름과 팀명을 입력해 주세요';
  end if;

  -- 이미 프로필이 있으면 재온보딩 불가
  if exists (select 1 from profile where user_id = auth.uid()) then
    raise exception '이미 등록된 계정입니다';
  end if;

  -- roster.norm 과 동일한 방식으로 정규화
  v_norm := regexp_replace(lower(p_team), '\s+', '', 'g') || '|' || regexp_replace(lower(p_name), '\s+', '', 'g');

  select id, claimed_by into v_id, v_claimed
  from roster where norm = v_norm for update;

  if not found then
    raise exception '등록된 부산센터 연수생이 아닙니다. 이름과 팀명을 다시 확인해 주세요';
  end if;

  if v_claimed is not null then
    raise exception '이미 가입된 연수생입니다. 다른 계정으로는 가입할 수 없습니다. 관리자에게 문의하세요';
  end if;

  update roster set claimed_by = auth.uid(), claimed_at = now() where id = v_id;

  insert into profile (user_id, name, team)
  values (auth.uid(), btrim(p_name), btrim(p_team));
end;
$$;

grant execute on function register_profile(text, text) to authenticated;

-- ── 명단 적재 방법 (마이그레이션 실행 후 별도로) ─────────────────────────
--   insert into roster (team, name) values
--     ('소마 1팀', '홍길동'),
--     ('소마 1팀', '김철수'),
--     ('소마 2팀', '이영희')
--   on conflict (norm) do nothing;
--
-- ── 이미 가입한 사용자(관리자 등) 명단 항목 잠금 (명단 적재 후 1회) ──────
--   update roster r
--     set claimed_by = p.user_id, claimed_at = now()
--   from profile p
--   where r.claimed_by is null
--     and r.norm = regexp_replace(lower(p.team), '\s+', '', 'g') || '|'
--                  || regexp_replace(lower(p.name), '\s+', '', 'g');
