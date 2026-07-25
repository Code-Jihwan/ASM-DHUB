-- 전화번호 수집 중단. 연락처는 별도 로컬 대장으로 관리하므로 웹에서는 받지 않는다.
-- (개인정보 최소 수집)

-- admin_seat_history가 phone을 반환하므로 먼저 함수를 고친다.
-- 반환 컬럼 구성이 바뀌므로 create or replace로는 안 되고 drop 후 재생성한다.
drop function if exists admin_seat_history(int);

create function admin_seat_history(p_seat_id int)
returns table (
  reservation_id uuid,
  period         tstzrange,
  extended       bool,
  status         text,
  away_since     timestamptz,
  name           text,
  team           text,
  created_at     timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception '관리자만 볼 수 있습니다';
  end if;

  return query
    select r.id, r.period, r.extended, r.status, r.away_since,
           p.name, p.team, r.created_at
    from reservation r
    left join profile p on p.user_id = r.user_id
    where r.seat_id = p_seat_id
    order by lower(r.period) desc
    limit 200;
end;
$$;

alter table profile drop column if exists phone;
