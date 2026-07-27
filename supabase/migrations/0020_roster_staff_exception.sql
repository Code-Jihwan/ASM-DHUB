-- 사무국 직원 예외: 팀명이 "사무국"이면 명단(roster) 대조 없이 가입을 허용한다.
--   공백 제거 + 소문자 정규화 후 '사무국' 과 같으면 통과. 여러 계정 허용(자리 잠금 없음).
--   관리자 권한은 자동 부여하지 않는다(관리자페이지에서 별도 지정).

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

  if exists (select 1 from profile where user_id = auth.uid()) then
    raise exception '이미 등록된 계정입니다';
  end if;

  -- 사무국 직원 예외: 명단 대조 없이 가입.
  if regexp_replace(lower(p_team), '\s+', '', 'g') = '사무국' then
    insert into profile (user_id, name, team)
    values (auth.uid(), btrim(p_name), btrim(p_team));
    return;
  end if;

  -- 그 외에는 명단과 대조한다.
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
