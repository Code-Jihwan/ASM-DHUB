-- 관리자 페이지의 '사용자 · 관리자 권한'과 '연수생 명단'에서 연수생별
-- 누적 개발공간 이용 시간(분)을 함께 보여주기 위해, 두 목록 RPC에 minutes 컬럼을 더한다.
--
-- 이용 시간 정의는 '이용 분석'의 이용 시간 순위(0031)와 동일 — 각 예약이 좌석을 '실제로 점유한' 시간:
--   실제 종료 = least(coalesce(cancelled_at, 종료), 종료, now())   (취소/진행 중은 그 시점까지만)
--   이용 초  = greatest(0, 실제 종료 - 시작),  전체 기간 합계를 분으로.
-- 사용자별로 합친다(연수생/사무국/관리자 구분 없이 각자 값). 예약이 없으면 0.
--
-- RETURNS TABLE에 컬럼을 더하면 create or replace가 막히므로(return type 변경 불가) drop 후 재생성.
-- 라이브 함수라 drop→create→grant 를 트랜잭션으로 묶어 '함수가 잠깐 없는 순간'을 없앤다.

begin;

-- 사용자 · 관리자 권한 목록 (+ minutes)
drop function if exists admin_list_profiles();
create function admin_list_profiles()
returns table (
  user_id    uuid,
  name       text,
  team       text,
  is_admin   boolean,
  email      text,
  created_at timestamptz,
  minutes    int
)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception '관리자만 볼 수 있습니다';
  end if;

  return query
    select p.user_id, p.name, p.team, p.is_admin, u.email::text, p.created_at,
           coalesce(uu.minutes, 0)
    from profile p
    join auth.users u on u.id = p.user_id
    left join (
      select r.user_id,
        round(sum(greatest(0, extract(epoch from (
          least(coalesce(r.cancelled_at, upper(r.period)), upper(r.period), now())
          - lower(r.period)
        )))) / 60)::int as minutes
      from reservation r
      group by r.user_id
    ) uu on uu.user_id = p.user_id
    order by p.is_admin desc, p.name;
end;
$$;
grant execute on function admin_list_profiles() to authenticated;

-- 연수생 명단 (+ minutes: 가입한 계정의 누적 이용 시간, 미가입이면 0)
drop function if exists admin_list_roster();
create function admin_list_roster()
returns table (
  id            bigint,
  team          text,
  name          text,
  claimed       boolean,
  claimed_email text,
  claimed_at    timestamptz,
  minutes       int
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
           r.claimed_at,
           coalesce(uu.minutes, 0)
    from roster r
    left join auth.users u on u.id = r.claimed_by
    left join (
      select r2.user_id,
        round(sum(greatest(0, extract(epoch from (
          least(coalesce(r2.cancelled_at, upper(r2.period)), upper(r2.period), now())
          - lower(r2.period)
        )))) / 60)::int as minutes
      from reservation r2
      group by r2.user_id
    ) uu on uu.user_id = r.claimed_by
    order by r.team, r.name;
end;
$$;
grant execute on function admin_list_roster() to authenticated;

commit;
