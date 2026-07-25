-- change_reservation 검증. 01_rules_test.sql 을 먼저 실행해 헬퍼를 만들어 둬야 한다.
\set ON_ERROR_STOP on

-- 내일을 예약해야 하므로 예약창을 잠시 넓힌다. 파일 끝에서 되돌린다.
create or replace function policy.book_ahead() returns interval language sql immutable as $$ select interval '48 hours' $$;

do $$
declare
  ann uuid; ben uuid;
  b   timestamptz := tests.base();
  rid uuid;
  r   reservation;
begin
  delete from reservation; delete from profile; delete from auth.users;

  insert into auth.users (email) values ('ann@d.kr') returning id into ann;
  insert into auth.users (email) values ('ben@d.kr') returning id into ben;
  insert into profile (user_id, name, team) values
    (ann, '앤', '1팀'),
    (ben, '벤', '2팀');

  -- 앤: 1번 좌석 09:00~11:00
  rid := tests.mk(1, ann, b, b + interval '2 hours');

  -- 벤: 5번 좌석 10:00~12:00 (변경 실패를 유도할 미끼)
  perform tests.mk(5, ben, b + interval '1 hour', b + interval '3 hours');

  ------------------------------------------------ 정상 변경: 1번 -> 3번, 시간도 이동
  perform set_config('request.jwt.claim.sub', ann::text, true);
  select * into r from change_reservation(rid, 3,
    tstzrange(b + interval '1 hour', b + interval '3 hours', '[)'));

  perform tests.assert('좌석이 3번으로 바뀜', r.seat_id = 3);
  perform tests.assert('시간이 옮겨짐', lower(r.period) = b + interval '1 hour');
  perform tests.assert('기존 예약은 취소됨', (select status from reservation where id = rid) = 'cancelled');
  perform tests.assert('활성 예약은 하나뿐',
    (select count(*) from reservation where user_id = ann and status = 'active') = 1);
  rid := r.id;

  ------------------------------------------------ 실패해도 원래 예약이 살아있어야 함
  begin
    perform change_reservation(rid, 5, tstzrange(b + interval '1 hour 30 min', b + interval '2 hours 30 min', '[)'));
    raise exception 'FAIL: 벤의 좌석과 겹치는데 통과했다';
  exception when others then
    if position('reservation_no_overlap' in sqlerrm) = 0
       and position('exclusion' in lower(sqlerrm)) = 0 then
      raise;
    end if;
  end;

  select * into r from reservation where id = rid;
  perform tests.assert('변경 실패 후에도 예약 살아있음', r.status = 'active');
  perform tests.assert('변경 실패 후 좌석 그대로 3번', r.seat_id = 3);

  ------------------------------------------------ 운영 시간을 넘는 변경도 막힌다
  begin
    perform change_reservation(rid, 4,
      tstzrange(b + interval '10 hours', b + interval '12 hours', '[)'));  -- 19:00~21:00
    raise exception 'FAIL: 20시를 넘는데 통과했다';
  exception when others then
    if position('20:00' in sqlerrm) = 0 then raise; end if;
  end;
  perform tests.assert('운영 시간 초과 변경 후에도 예약 유지',
    (select status from reservation where id = rid) = 'active');

  ------------------------------------------------ 남의 예약은 변경 불가
  perform set_config('request.jwt.claim.sub', ben::text, true);
  begin
    perform change_reservation(rid, 7, tstzrange(b, b + interval '1 hour', '[)'));
    raise exception 'FAIL: 남의 예약을 변경했다';
  exception when others then
    if position('본인 예약만' in sqlerrm) = 0 then raise; end if;
  end;
  perform tests.assert('남의 변경 시도 후에도 앤 예약 유지',
    (select user_id from reservation where id = rid) = ann);

  raise notice '===== 예약 변경 테스트 통과 =====';
end $$;

create or replace function policy.book_ahead() returns interval language sql immutable as $$ select interval '12 hours' $$;
