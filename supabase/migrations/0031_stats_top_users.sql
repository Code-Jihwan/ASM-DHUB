-- 시설 이용 분석에 '이용 시간이 많은 연수생 TOP 5'를 더한다.
--
-- 선택 기간 동안 좌석을 실제로 점유한 시간(분)을 사람별로 합쳐 상위 5명을 뽑는다.
-- 대상은 연수생만 — 사무국(team='사무국')과 관리자(is_admin)는 제외한다.
-- 이름·팀을 함께 내려, 화면이 팀명까지 표기할 수 있게 한다.
--
-- 추가되는 값(admin_stats 반환 jsonb):
--   top_users : [{name, team, minutes}] 최대 5개, 이용시간 내림차순.
--
-- 나머지는 0030과 동일하다. create or replace로 본문만 바꾼다.

create or replace function admin_stats(p_from date default null, p_to date default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ltz       text := policy.tz();
  open_t    time := policy.open_time();
  close_t   time := policy.close_time();
  h0        int  := extract(hour from open_t)::int;
  h1        int  := extract(hour from close_t)::int;   -- 마지막 시간대는 h1-1
  seats_n   int;
  today_d   date;
  from_d    date;
  to_d      date;
  avail     numeric;      -- 좌석 1개가 하루에 제공하는 초(운영시간)
  inc_today boolean;      -- 오늘을 곡선·도넛에 포함할지
  out_json  jsonb;
begin
  if not is_admin() then
    raise exception '관리자만 볼 수 있습니다';
  end if;

  select count(*) into seats_n from seat;
  today_d := (now() at time zone ltz)::date;
  to_d    := coalesce(p_to, today_d);
  from_d  := coalesce(
               p_from,
               (select min((lower(period) at time zone ltz)::date) from reservation),
               today_d);
  inc_today := to_d >= today_d;
  avail := greatest(1, extract(epoch from (close_t - open_t)));

  with base as (
    select
      r.seat_id, r.user_id, r.status, r.away_since, r.cancelled_at,
      lower(r.period) as s,
      (lower(r.period) at time zone ltz)::date as d,
      (extract(epoch from (upper(r.period) - lower(r.period))) / 60)::int as planned_min,
      least(coalesce(r.cancelled_at, upper(r.period)), upper(r.period), now()) as e
    from reservation r
    where (lower(r.period) at time zone ltz)::date between from_d and to_d
  ),
  -- 평균은 오늘을 뺀 '완료된 날'만으로. (과거만 보는 범위면 base 전체가 그대로 past)
  past as (select * from base where d < today_d),
  today_base as (select * from base where inc_today and d = today_d),
  past_days as (select count(distinct d)::numeric as n from past),
  hours as (select generate_series(h0, h1 - 1) as h),

  -- 시간대별: 날짜별 점유 초 → 평균 → %
  hourly_day as (
    select hs.h, p.d,
      sum(greatest(0, extract(epoch from (
        least(p.e, ((p.d::timestamp) + make_interval(hours => hs.h + 1)) at time zone ltz)
        - greatest(p.s, ((p.d::timestamp) + make_interval(hours => hs.h)) at time zone ltz)
      ))))::numeric as secs
    from past p cross join hours hs
    group by hs.h, p.d
  ),
  hourly_avg as (
    select hs.h, round(coalesce(avg(hd.secs), 0) / 3600 / seats_n * 100, 1) as avg_pct
    from hours hs left join hourly_day hd on hd.h = hs.h
    group by hs.h
  ),
  hourly_today as (
    select hs.h,
      case
        when not inc_today then null
        -- 아직 안 지난(현재 진행/미래) 시간대는 비운다. 부분 집계로 낮게 보이는 걸 막는다.
        when ((today_d::timestamp) + make_interval(hours => hs.h + 1)) at time zone ltz > now()
          then null
        else round(coalesce(sum(greatest(0, extract(epoch from (
          least(t.e, ((today_d::timestamp) + make_interval(hours => hs.h + 1)) at time zone ltz)
          - greatest(t.s, ((today_d::timestamp) + make_interval(hours => hs.h)) at time zone ltz)
        )))), 0) / 3600 / seats_n * 100, 1)
      end as today_pct
    from hours hs left join today_base t on true
    group by hs.h
  ),

  -- 좌석별 이용률: 완료된 날 동안 점유한 시간 ÷ (운영시간 × 날 수)
  seat_pct as (
    select s.id, s.label,
      case when (select n from past_days) = 0 then 0
        else round(
          coalesce(sum(greatest(0, extract(epoch from (p.e - p.s)))), 0)
          / (avail * (select n from past_days)) * 100)::int
      end as pct
    from seat s left join past p on p.seat_id = s.id
    group by s.id, s.label
  ),

  duration as (
    select
      case
        when planned_min <= 30  then '30분 이하'
        when planned_min <= 60  then '~1시간'
        when planned_min <= 120 then '~2시간'
        when planned_min <= 180 then '~3시간'
        else '3시간 초과'
      end as bucket,
      case
        when planned_min <= 30  then 1
        when planned_min <= 60  then 2
        when planned_min <= 120 then 3
        when planned_min <= 180 then 4
        else 5
      end as ord,
      count(*)::int as cnt
    from base
    group by 1, 2
  ),
  outcome as (
    select
      case
        when status = 'active' then '정상 종료'
        when away_since is not null then '자리비움 자동취소'
        when cancelled_at is not null
             and cancelled_at - s >= policy.cancel_grace() then '좌석 반납'
        else '예약 취소'
      end as kind,
      -- ord의 분기 순서는 kind와 반드시 같아야 한다(다르면 kind와 ord가 어긋난다).
      case
        when status = 'active' then 1
        when away_since is not null then 4
        when cancelled_at is not null
             and cancelled_at - s >= policy.cancel_grace() then 2
        else 3
      end as ord,
      count(*)::int as cnt
    from base
    group by 1, 2
  ),

  -- 이용 인원: 하루에 예약이 한 번이라도 있었던 고유 사용자 수(한 명은 하루 1로 센다).
  daily_users as (
    select d, count(distinct user_id)::int as u
    from base
    group by d
  ),
  -- 요일별 하루 평균. 완료된 날(오늘 제외)만. dow는 월=1 … 일=7(isodow).
  weekday as (
    select extract(isodow from d)::int as dow, round(avg(u))::int as avg
    from daily_users where d < today_d
    group by extract(isodow from d)
  ),
  -- 이용 시간이 많은 연수생 TOP 5. 좌석 점유 초(e-s)를 사람별로 합쳐 분으로.
  -- 연수생만: 사무국(team='사무국')·관리자(is_admin)는 뺀다. 1분 미만 점유는 제외.
  top_users as (
    select p.name, p.team,
      round(sum(greatest(0, extract(epoch from (b.e - b.s)))) / 60)::int as minutes
    from base b
    join profile p on p.user_id = b.user_id
    where coalesce(p.is_admin, false) = false
      and coalesce(p.team, '') <> '사무국'
    group by p.user_id, p.name, p.team
    having sum(greatest(0, extract(epoch from (b.e - b.s)))) >= 60
    order by minutes desc, p.name
    limit 5
  )

  select jsonb_build_object(
    'from', to_char(from_d, 'YYYY-MM-DD'),
    'to', to_char(to_d, 'YYYY-MM-DD'),
    'days', (select n from past_days),
    'seats', seats_n,
    'include_today', inc_today,
    -- 지금 이 순간 좌석을 점유 중인 인원. 범위와 무관하게 항상 '지금'을 본다.
    'current_users', (
      select count(distinct r.user_id)::int from reservation r
      where r.status = 'active' and r.period @> now()
    ),
    'users_total', (select count(distinct user_id)::int from base),
    'users_avg', (select round(coalesce(avg(u), 0))::int from daily_users where d < today_d),
    'weekday', (
      select coalesce(jsonb_agg(jsonb_build_object('dow', g.dow, 'avg', coalesce(w.avg, 0))
                                order by g.dow), '[]'::jsonb)
      from generate_series(1, 7) as g(dow)
      left join weekday w on w.dow = g.dow
    ),
    'top_users', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', name, 'team', team, 'minutes', minutes)
               order by minutes desc, name), '[]'::jsonb)
      from top_users
    ),
    'hourly', (
      select coalesce(jsonb_agg(jsonb_build_object('h', hs.h, 'avg', a.avg_pct, 'today', t.today_pct)
                                order by hs.h), '[]'::jsonb)
      from hours hs
      join hourly_avg a on a.h = hs.h
      join hourly_today t on t.h = hs.h
    ),
    'seats_pct', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', id, 'label', label, 'pct', pct) order by id), '[]'::jsonb) from seat_pct),
    'duration', (select coalesce(jsonb_agg(jsonb_build_object(
                    'bucket', bucket, 'cnt', cnt) order by ord), '[]'::jsonb) from duration),
    'outcome', (select coalesce(jsonb_agg(jsonb_build_object(
                    'kind', kind, 'cnt', cnt) order by ord), '[]'::jsonb) from outcome)
  ) into out_json;

  return out_json;
end;
$$;

grant execute on function admin_stats(date, date) to authenticated;
