-- 관리자 명단 관리용 조회 함수. 명단 + 가입 여부(가입한 계정 이메일 포함)를 준다.
--   추가/삭제/잠금해제는 roster RLS(관리자 all) 로 클라이언트가 직접 한다.
--   가입 계정 이메일은 auth.users 라 security definer 로만 읽을 수 있어 함수로 내보낸다.

create or replace function admin_list_roster()
returns table (
  id            bigint,
  team          text,
  name          text,
  claimed       boolean,
  claimed_email text,
  claimed_at    timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception '관리자만 볼 수 있습니다';
  end if;

  return query
    select r.id, r.team, r.name,
           r.claimed_by is not null,
           u.email::text,
           r.claimed_at
    from roster r
    left join auth.users u on u.id = r.claimed_by
    order by r.team, r.name;
end;
$$;

grant execute on function admin_list_roster() to authenticated;
