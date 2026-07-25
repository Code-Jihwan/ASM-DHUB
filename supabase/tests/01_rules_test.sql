-- 예약 규칙 검증. psql -f 로 실행하면 마지막에 통과/실패가 찍힌다.
--
-- 운영 시간(08~20)이 생긴 뒤로 now() 기준 상대 시각을 쓰면 실행 시각에 따라
-- 결과가 달라진다. 기준점을 "내일 09:00 KST"로 고정해 결정적으로 만든다.
-- 12시간 예약창은 그 기준점을 못 쓰므로 book_ahead를 잠시 넓혔다 되돌린다.
--
-- RLS 정책은 superuser가 우회하므로 여기서 다루지 않는다.

\set ON_ERROR_STOP on

create schema if not exists tests;

/** 내일 09:00 KST. 항상 운영 시간 안이고 항상 미래다. */
create or replace function tests.base() returns timestamptz
language sql stable as $$
  select (date_trunc('day', now() at time zone policy.tz())
          + interval '1 day' + interval '9 hours') at time zone policy.tz()
$$;

create or replace function tests.assert_rejects(p_label text, p_sql text, p_expect text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(lower(p_expect) in lower(sqlerrm)) = 0 then
      raise exception 'FAIL [%]: 기대 "%" / 실제 "%"', p_label, p_expect, sqlerrm;
    end if;
    raise notice 'PASS  %', p_label;
    return;
  end;
  raise exception 'FAIL [%]: 거부되어야 하는데 통과했다', p_label;
end;
$$;

create or replace function tests.assert(p_label text, p_cond bool)
returns void language plpgsql as $$
begin
  if not p_cond then
    raise exception 'FAIL [%]', p_label;
  end if;
  raise notice 'PASS  %', p_label;
end;
$$;

/** 예약 한 건을 만든다. 검증 대상이 아닌 준비 작업에 쓴다. */
create or replace function tests.mk(p_seat int, p_user uuid, p_from timestamptz, p_to timestamptz)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into reservation (seat_id, user_id, period)
  values (p_seat, p_user, tstzrange(p_from, p_to, '[)'))
  returning id into v;
  return v;
end;
$$;


/**
 * 진행 중인 예약을 다루는 테스트(연장, 자리비움)는 now()에 묶일 수밖에 없다.
 * 그런데 UPDATE도 운영시간 트리거를 타므로, 실행 시각이 08~20 밖이면
 * 검증하려는 규칙과 무관하게 실패한다. 그 구간에서만 운영시간을 풀어준다.
 */
create or replace function tests.hours_off() returns void language plpgsql as $$
begin
  create or replace function policy.open_time()  returns time language sql immutable as $f$ select time '00:00' $f$;
  create or replace function policy.close_time() returns time language sql immutable as $f$ select time '24:00' $f$;
end $$;

create or replace function tests.hours_on() returns void language plpgsql as $$
begin
  create or replace function policy.open_time()  returns time language sql immutable as $f$ select time '08:00' $f$;
  create or replace function policy.close_time() returns time language sql immutable as $f$ select time '20:00' $f$;
end $$;

/**
 * now()+1시간 이하의 마지막 30분 경계. (now, now+1h] 안에 든다.
 * 올림을 쓰면 종료가 1시간 넘게 남아 연장 창이 안 열린다.
 */
create or replace function tests.soon_end() returns timestamptz
language sql stable as $$
  select to_timestamp(floor(extract(epoch from now() + interval '1 hour') / 1800) * 1800)
$$;


-- 내일을 예약하려면 12시간 창을 넘어야 한다. 잠시 넓힌다. 파일 끝에서 되돌린다.
create or replace function policy.book_ahead() returns interval language sql immutable as $$ select interval '48 hours' $$;


---------------------------------------------------------------- 기본 예약
do $$
declare
  alice uuid; bob uuid;
  b timestamptz := tests.base();
begin
  delete from reservation; delete from profile; delete from auth.users;
  insert into auth.users (email) values ('alice@d.kr') returning id into alice;
  insert into auth.users (email) values ('bob@d.kr')   returning id into bob;
  insert into profile (user_id, name, team) values
    (alice, '앨리스', '1팀'),
    (bob,   '밥',     '2팀');

  perform tests.assert_rejects('30분 단위가 아니면 거부',
    format('select tests.mk(1, %L, %L, %L)', alice, b + interval '10 min', b + interval '2 hours'),
    '30분 단위');

  perform tests.assert_rejects('기본 예약 2시간 초과는 거부',
    format('select tests.mk(1, %L, %L, %L)', alice, b, b + interval '2 hours 30 min'),
    'reservation_bounded');

  update seat set active = false where id = 10;
  perform tests.assert_rejects('잠긴 좌석은 예약 불가',
    format('select tests.mk(10, %L, %L, %L)', alice, b, b + interval '1 hour'),
    '사용할 수 없는 좌석');
  update seat set active = true where id = 10;

  -- 2시간 정각은 통과해야 한다 (경계값)
  perform tests.mk(1, alice, b, b + interval '2 hours');
  perform tests.assert('기본 예약 2시간 정각은 허용', true);

  perform tests.assert_rejects('같은 좌석 시간 겹치면 거부',
    format('select tests.mk(1, %L, %L, %L)', bob, b + interval '1 hour', b + interval '2 hours'),
    'reservation_no_overlap');

  -- 맞닿는 건 겹침이 아니다. [) 범위라 11시 종료 / 11시 시작은 공존한다.
  perform tests.mk(1, bob, b + interval '2 hours', b + interval '4 hours');
  perform tests.assert('종료 시각과 맞닿는 예약은 허용', true);

  perform tests.assert_rejects('이미 예약이 있으면 추가 예약 거부',
    format('select tests.mk(3, %L, %L, %L)', alice, b + interval '5 hours', b + interval '6 hours'),
    '이미 예약이 있습니다');

  raise notice '--- 기본 예약 / 겹침 / 보유 제한 통과 ---';
end $$;


---------------------------------------------------------------- 운영 시간 08~20
do $$
declare
  u uuid;
  b timestamptz := tests.base();               -- 내일 09:00
  d timestamptz := b - interval '9 hours';     -- 내일 00:00
begin
  delete from reservation; delete from profile; delete from auth.users;
  insert into auth.users (email) values ('carol@d.kr') returning id into u;
  insert into profile (user_id, name, team) values (u, '캐롤', '3팀');

  perform tests.assert_rejects('08시 이전 시작은 거부',
    format('select tests.mk(1, %L, %L, %L)', u, d + interval '7 hours 30 min', d + interval '9 hours'),
    '08:00');

  perform tests.assert_rejects('20시 이후 종료는 거부',
    format('select tests.mk(1, %L, %L, %L)', u, d + interval '19 hours', d + interval '21 hours'),
    '20:00');

  perform tests.assert_rejects('자정을 넘는 예약은 거부',
    format('select tests.mk(1, %L, %L, %L)', u, d + interval '23 hours', d + interval '25 hours'),
    '20:00');

  -- 경계값: 정확히 08:00 시작, 정확히 20:00 종료
  perform tests.mk(1, u, d + interval '8 hours', d + interval '10 hours');
  perform tests.assert('08:00 정각 시작은 허용', true);

  delete from reservation;
  perform tests.mk(2, u, d + interval '18 hours', d + interval '20 hours');
  perform tests.assert('20:00 정각 종료는 허용', true);

  raise notice '--- 운영 시간 통과 ---';
end $$;


---------------------------------------------------------------- 프로필 요구
do $$
declare
  u uuid;
  b timestamptz := tests.base();
begin
  delete from reservation; delete from profile; delete from auth.users;
  insert into auth.users (email) values ('noprofile@d.kr') returning id into u;

  perform tests.assert_rejects('프로필 없으면 예약 거부',
    format('select tests.mk(1, %L, %L, %L)', u, b, b + interval '1 hour'),
    '이름, 팀, 연락처');

  raise notice '--- 프로필 요구 통과 ---';
end $$;


---------------------------------------------------------------- 연장
do $$
declare
  u uuid; v uuid;
  b   timestamptz := tests.base();
  d   timestamptz := b - interval '9 hours';
  rid uuid;
  r   reservation;
begin
  delete from reservation; delete from profile; delete from auth.users;
  insert into auth.users (email) values ('dan@d.kr') returning id into u;
  insert into auth.users (email) values ('eve@d.kr') returning id into v;
  insert into profile (user_id, name, team) values
    (u, '댄', '4팀'),
    (v, '이브', '5팀');

  -- 진행 중이면서 종료 1시간 전인 상태를 만든다: 1시간 전 시작 ~ 1시간 뒤 종료
  alter table reservation disable trigger reservation_validate_trg;
  insert into reservation (seat_id, user_id, period)
  values (5, u, tstzrange(now() - interval '1 hour', now() + interval '1 hour', '[)'))
  returning id into rid;
  alter table reservation enable trigger reservation_validate_trg;

  perform set_config('request.jwt.claim.sub', u::text, true);

  perform tests.assert_rejects('연장 2시간 초과는 거부',
    format('select extend_reservation(%L, %L)', rid, now() + interval '3 hours 30 min'),
    '최대 2시간');

  perform tests.assert_rejects('거꾸로 가는 연장은 거부',
    format('select extend_reservation(%L, %L)', rid, now() - interval '30 min'),
    '최대 2시간');

  perform set_config('request.jwt.claim.sub', v::text, true);
  perform tests.assert_rejects('남의 예약은 연장 불가',
    format('select extend_reservation(%L, %L)', rid, now() + interval '2 hours'),
    '본인 예약만');
  perform set_config('request.jwt.claim.sub', u::text, true);

  raise notice '--- 연장 거부 규칙 통과 ---';
end $$;


-- 연장이 운영 종료 시각을 넘지 못하는지.
-- 실행 시각에 의존하지 않도록, 종료 시각 기준으로 close_time을 잠시 옮겨 확인한다.
-- (extend_reservation은 UPDATE 전에 거부하므로 트리거는 관여하지 않는다.)
do $$
declare
  u uuid; rid uuid;
  e timestamptz := tests.soon_end();
begin
  delete from reservation; delete from profile; delete from auth.users;
  insert into auth.users (email) values ('fay@d.kr') returning id into u;
  insert into profile (user_id, name, team) values (u, '페이', '6팀');

  alter table reservation disable trigger reservation_validate_trg;
  insert into reservation (seat_id, user_id, period)
  values (7, u, tstzrange(e - interval '2 hours', e, '[)'))
  returning id into rid;
  alter table reservation enable trigger reservation_validate_trg;

  perform set_config('request.jwt.claim.sub', u::text, true);

  -- 운영 종료를 예약 종료 30분 뒤로 옮긴다. 2시간 연장은 이걸 넘는다.
  execute format(
    'create or replace function policy.close_time() returns time language sql immutable as $f$ select time %L $f$',
    ((e + interval '30 min') at time zone policy.tz())::time);

  perform tests.assert_rejects('연장은 운영 종료 시각을 넘을 수 없다',
    format('select extend_reservation(%L, %L)', rid, e + interval '2 hours'),
    '까지만 가능합니다');

  perform tests.hours_on();
  raise notice '--- 연장 운영시간 상한 통과 ---';
end $$;


---------------------------------------------------------------- 정상 연장 + 1회 제한
do $$
declare
  u uuid; rid uuid; r reservation;
  e timestamptz;
begin
  delete from reservation; delete from profile; delete from auth.users;
  insert into auth.users (email) values ('gus@d.kr') returning id into u;
  insert into profile (user_id, name, team) values (u, '거스', '7팀');

  e := tests.soon_end();

  -- 실제 연장은 UPDATE라 운영시간 트리거를 탄다. 이 블록이 검증하려는 건
  -- 연장 길이와 1회 제한이므로 운영시간은 잠시 풀어둔다.
  perform tests.hours_off();

  alter table reservation disable trigger reservation_validate_trg;
  insert into reservation (seat_id, user_id, period)
  values (9, u, tstzrange(e - interval '2 hours', e, '[)'))
  returning id into rid;
  alter table reservation enable trigger reservation_validate_trg;

  perform set_config('request.jwt.claim.sub', u::text, true);

  select * into r from extend_reservation(rid, e + interval '2 hours');
  perform tests.assert('2시간 연장 성공', upper(r.period) = e + interval '2 hours');
  perform tests.assert('연장 플래그가 선다', r.extended);
  perform tests.assert('총 길이 4시간', upper(r.period) - lower(r.period) = interval '4 hours');

  perform tests.assert_rejects('연장은 1회만',
    format('select extend_reservation(%L, %L)', rid, e + interval '3 hours'),
    '1회만');

  perform tests.hours_on();
  raise notice '--- 연장 성공 / 1회 제한 통과 ---';
end $$;


---------------------------------------------------------------- 자리비움
do $$
declare
  u uuid; rid uuid; r reservation;
  e timestamptz;
begin
  delete from reservation; delete from profile; delete from auth.users;
  insert into auth.users (email) values ('hana@d.kr') returning id into u;
  insert into profile (user_id, name, team) values (u, '하나', '8팀');

  e := tests.soon_end();

  -- set_away도 UPDATE라 운영시간 트리거를 탄다.
  perform tests.hours_off();

  alter table reservation disable trigger reservation_validate_trg;
  insert into reservation (seat_id, user_id, period)
  values (11, u, tstzrange(e - interval '2 hours', e, '[)'))
  returning id into rid;
  alter table reservation enable trigger reservation_validate_trg;

  perform set_config('request.jwt.claim.sub', u::text, true);

  select * into r from set_away(rid, true);
  perform tests.assert('자리비움 켜짐', r.away_since is not null);

  select * into r from set_away(rid, false);
  perform tests.assert('자리비움 해제', r.away_since is null);

  -- 아직 시작하지 않은 예약에는 켤 수 없다
  delete from reservation;
  rid := tests.mk(12, u, tests.base(), tests.base() + interval '1 hour');
  perform tests.assert_rejects('시작 전에는 자리비움 불가',
    format('select set_away(%L, true)', rid),
    '이용 중일 때만');

  perform tests.hours_on();
  raise notice '--- 자리비움 통과 ---';
end $$;


---------------------------------------------------------------- 12시간 예약창
do $$
declare
  u uuid;
  b timestamptz := tests.base();
begin
  delete from reservation; delete from profile; delete from auth.users;
  insert into auth.users (email) values ('ivy@d.kr') returning id into u;
  insert into profile (user_id, name, team) values (u, '아이비', '9팀');

  -- 창을 1시간으로 좁히면 내일 09:00은 반드시 거부된다
  create or replace function policy.book_ahead() returns interval language sql immutable as $f$ select interval '1 hour' $f$;
  perform tests.assert_rejects('예약창보다 먼 시각은 거부',
    format('select tests.mk(1, %L, %L, %L)', u, b, b + interval '1 hour'),
    '전부터 가능합니다');

  -- 다시 넓히면 통과한다
  create or replace function policy.book_ahead() returns interval language sql immutable as $f$ select interval '48 hours' $f$;
  perform tests.mk(1, u, b, b + interval '1 hour');
  perform tests.assert('예약창 안이면 허용', true);

  perform tests.assert_rejects('지난 시간은 예약 불가',
    format('select tests.mk(2, %L, %L, %L)', u, b - interval '48 hours', b - interval '47 hours'),
    '지난 시간');

  raise notice '--- 예약창 통과 ---';
end $$;


----------------------------------------------------- 정책 위반 예약도 취소는 된다
-- 정책이 바뀌기 전에 만들어진 예약(운영시간 밖, 길이 초과)이 영영 취소되지 않으면
-- 그 좌석은 아무도 못 쓴다. 상태만 바꾸는 변경은 시간 검증을 타지 않아야 한다.
do $$
declare
  u   uuid;
  rid uuid;
  d   timestamptz := (date_trunc('day', now() at time zone policy.tz())) at time zone policy.tz();
begin
  delete from reservation; delete from profile; delete from auth.users;
  insert into auth.users (email) values ('old@d.kr') returning id into u;
  insert into profile (user_id, name, team) values (u, '옛사용자', '0팀');

  -- 운영시간 밖(22:00~24:00)인 예약을 강제로 심는다.
  -- 길이는 2시간이라 reservation_bounded 제약에는 걸리지 않는다.
  alter table reservation disable trigger reservation_validate_trg;
  insert into reservation (seat_id, user_id, period)
  values (13, u, tstzrange(d + interval '22 hours', d + interval '24 hours', '[)'))
  returning id into rid;
  alter table reservation enable trigger reservation_validate_trg;

  update reservation set status = 'cancelled' where id = rid;
  perform tests.assert('운영시간 밖 예약도 취소된다',
    (select status from reservation where id = rid) = 'cancelled');

  -- 자리비움 플래그만 바꾸는 것도 통과해야 한다
  update reservation set status = 'active' where id = rid;
  update reservation set away_since = now() where id = rid;
  perform tests.assert('시간을 안 건드리는 변경은 통과',
    (select away_since from reservation where id = rid) is not null);

  -- 반대로 시간을 바꾸려 하면 여전히 막혀야 한다
  perform tests.assert_rejects('시간을 바꾸면 검증이 돈다',
    format('update reservation set period = tstzrange(%L, %L, ''[)'') where id = %L',
           d + interval '22 hours', d + interval '23 hours', rid),
    '20:00');

  raise notice '--- 취소 경로 통과 ---';
end $$;


---------------------------------------------------------------- 운영 상수 확인
create or replace function policy.book_ahead() returns interval language sql immutable as $$ select interval '12 hours' $$;

do $$
begin
  perform tests.assert('기본 예약 2시간',   policy.max_base()    = interval '2 hours');
  perform tests.assert('연장 2시간',        policy.max_extend()  = interval '2 hours');
  perform tests.assert('예약창 12시간',     policy.book_ahead()  = interval '12 hours');
  perform tests.assert('운영 08:00 시작',   policy.open_time()   = time '08:00');
  perform tests.assert('운영 20:00 종료',   policy.close_time()  = time '20:00');
  perform tests.assert('자리비움 30분',     policy.away_grace()  = interval '30 minutes');
  perform tests.assert('30분 단위',         policy.slot_seconds() = 1800);
end $$;

do $$ begin raise notice '';
             raise notice '===== 전체 통과 =====';
end $$;
