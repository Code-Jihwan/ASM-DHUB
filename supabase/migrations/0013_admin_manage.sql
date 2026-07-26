-- 관리자 화면에서 사용자를 관리자로 지정/해제할 수 있게 한다.
--
-- is_admin 컬럼은 이미 있고(0007), 지금까지는 SQL로 직접 바꿔야 했다.
-- 관리자만 실행할 수 있는 함수 두 개로 목록 조회와 권한 변경을 연다.

-- 로그인한(=프로필이 있는) 모든 사용자 목록. 관리자만.
-- 이름이 겹칠 수 있어 이메일도 함께 준다(auth.users는 security definer로만 읽는다).
create or replace function admin_list_profiles()
returns table (
  user_id    uuid,
  name       text,
  team       text,
  is_admin   boolean,
  email      text,
  created_at timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception '관리자만 볼 수 있습니다';
  end if;

  return query
    select p.user_id, p.name, p.team, p.is_admin, u.email::text, p.created_at
    from profile p
    join auth.users u on u.id = p.user_id
    order by p.is_admin desc, p.name;
end;
$$;

-- 대상 사용자의 관리자 권한 설정. 관리자만.
-- 자기 권한을 스스로 해제하면 관리자 0명이 될 수 있어 막는다.
create or replace function set_admin(p_user_id uuid, p_is_admin boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception '관리자만 변경할 수 있습니다';
  end if;

  if p_user_id = auth.uid() and not p_is_admin then
    raise exception '본인 관리자 권한은 스스로 해제할 수 없습니다';
  end if;

  update profile set is_admin = p_is_admin where user_id = p_user_id;
end;
$$;

grant execute on function admin_list_profiles()          to authenticated;
grant execute on function set_admin(uuid, boolean)       to authenticated;

-- ── 첫 관리자 부트스트랩 (한 번만, 이메일 바꿔서 실행) ────────────────
-- 관리자 페이지에 처음 들어가려면 최소 1명은 SQL로 관리자로 지정해야 한다.
--   update profile set is_admin = true
--   where user_id = (select id from auth.users where email = 'you@example.com');
