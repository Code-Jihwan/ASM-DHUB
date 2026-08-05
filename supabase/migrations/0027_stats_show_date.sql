-- 통계 화면이 '어느 날짜'를 보여주는지 함수가 직접 알려주게 한다.
--
-- 기존에는 기준 시각("20:00")만 내려서, 새벽에 보는 경우(당일=어제)와 저녁 8시 이후에
-- 보는 경우(당일=오늘)가 화면에서 구분되지 않았다. 보는 사람이 어느 날 숫자인지 알 수 없었다.
--
-- 그래서 세 가지를 추가한다.
--   day      : 화면이 '당일'로 보여 주는 날짜
--   prev_day : 운영 시작 전이라 어제로 물러났는지
--   full_day : 그 날을 운영 종료까지 다 본 것인지(중간까지가 아니라)
--
-- 계산 방식은 0026과 같다. 반환 필드만 늘었다.

------------------------------------------------------------------ 통계 조회
-- p_days: 조회할 일수(오늘 포함). 0이나 음수면 전체 기간.
create or replace function admin_stats(p_days int default 7)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ltz      text := policy.tz();
  open_t   time := policy.open_time();
  close_t  time := policy.close_time();
  seats_n  int;
  now_t    time;
  cut_time time;         -- 지금의 '하루 중 위치'. 과거 날짜도 여기까지만 잘라 본다.
  today_d  date;         -- 화면에서 '당일'로 보여 줄 운영일
  from_d   date;         -- null이면 전체 기간
  avail    numeric;      -- 하루에 좌석 1개가 이 시각까지 제공하는 초
  out_json jsonb;
begin
  if not is_admin() then
    raise exception '관리자만 볼 수 있습니다';
  end if;

  select count(*) into seats_n from seat;
  now_t := (now() at time zone ltz)::time;

  -- 운영 시작(08:00) 전에 열면 오늘은 아직 아무 일도 없다. 그때는 방금 끝난 어제를
  -- '당일'로 보고 하루 전체를 보여 준다. 그러지 않으면 밤에는 화면이 통째로 빈다.
  if now_t < open_t then
    today_d  := (now() at time zone ltz)::date - 1;
    cut_time := close_t;
  else
    today_d  := (now() at time zone ltz)::date;
    cut_time := least(now_t, close_t);   -- 운영 종료 후에는 하루 전체
  end if;

  from_d := case when coalesce(p_days, 0) <= 0 then null else today_d - (p_days - 1) end;

  -- 좌석 1개가 이 시각까지 제공한 초. 운영 시작~기준 시각.
  avail := greatest(0, extract(epoch from (cut_time - open_t)));

  with base as (
    select
      r.seat_id,
      r.user_id,
      r.status,
      r.away_since,
      lower(r.period) as s,
      (lower(r.period) at time zone ltz)::date as d,
      -- 예약한 길이(분). 프리셋이 수요와 맞는지 보는 데 쓴다.
      (extract(epoch from (upper(r.period) - lower(r.period))) / 60)::int as planned_min,
      -- 실제 점유가 끝난 시각. 취소했으면 그때까지, 아직 진행 중이면 지금까지.
      least(coalesce(r.cancelled_at, upper(r.period)), upper(r.period), now()) as e
    from reservation r
    where (lower(r.period) at time zone ltz)::date <= today_d
      and (from_d is null or (lower(r.period) at time zone ltz)::date >= from_d)
  ),
  marked as (
    select b.*,
      ((b.d::timestamp) + cut_time) at time zone ltz as day_cut
    from base b
  ),
  -- 같은 시각까지로 자른 실제 점유 초. 그 시각 이후에 시작한 예약은 제외한다.
  occ as (
    select m.*,
      greatest(0, extract(epoch from (least(m.e, m.day_cut) - m.s)))::numeric as secs
    from marked m
    where m.s <= m.day_cut
  ),
  all_days as (
    select count(distinct d)::numeric as n from occ
  ),
  -- 하루 단위로 먼저 집계한다. 여러 날을 한꺼번에 합쳐 나누면 '인당 시간'이
  -- 날수만큼 부풀려지므로, 반드시 하루씩 구한 뒤 그 값들을 평균한다.
  per_day as (
    select d,
      count(*)::numeric                                              as cnt,
      count(*) filter (where secs < 1800)::numeric                   as short,
      coalesce(sum(secs) filter (where secs >= 1800), 0)::numeric     as secs_e,
      count(distinct user_id) filter (where secs >= 1800)::numeric    as users_e,
      coalesce(sum(secs), 0)::numeric                                as secs_all
    from occ
    group by d
  ),
  t as (select * from per_day where d = today_d),
  -- 평균의 분모는 '이용이 있었던 날'. 휴일·주말이 자동으로 빠진다. 당일은 제외해
  -- 평균이 비교 기준으로 남게 한다.
  p as (
    select
      count(*)::numeric                as n_days,
      avg(cnt)                         as cnt,
      avg(short)                       as short,
      avg(secs_all)                    as secs_all,
      avg(secs_e / nullif(users_e, 0)) as per_user_secs
    from per_day where d < today_d
  ),
  -- 시간대별. 여기서는 day_cut으로 자르지 않는다. '평소 하루의 모양'을 보여 주고
  -- 당일은 e가 이미 now()로 잘려 있어 저절로 현재까지만 그려진다.
  hours as (
    select generate_series(
      extract(hour from open_t)::int,
      extract(hour from close_t)::int - 1
    ) as h
  ),
  hourly_raw as (
    select hs.h, b.d,
      sum(greatest(0, extract(epoch from (
        least(b.e, ((b.d::timestamp) + make_interval(hours => hs.h + 1)) at time zone ltz)
        - greatest(b.s, ((b.d::timestamp) + make_interval(hours => hs.h)) at time zone ltz)
      ))))::numeric as secs
    from base b cross join hours hs
    group by hs.h, b.d
  ),
  hourly as (
    select hs.h,
      -- 평균 동시 점유 좌석 수 = 그 시간대 점유 초 / 3600
      round(coalesce(avg(hr.secs) filter (where hr.d < today_d), 0) / 3600, 1) as avg_seats,
      -- 아직 끝나지 않은 시간대는 당일 값을 비운다(부분 집계로 낮아 보이는 것을 막는다).
      case
        when ((today_d::timestamp) + make_interval(hours => hs.h + 1)) at time zone ltz > now()
          then null
        else round(coalesce(max(hr.secs) filter (where hr.d = today_d), 0) / 3600, 1)
      end as today_seats
    from hours hs
    left join hourly_raw hr on hr.h = hs.h
    group by hs.h
  ),
  seat_pct as (
    select s.id, s.label,
      case
        when avail = 0 or (select n from all_days) = 0 then 0
        else round(
          coalesce(sum(o.secs), 0) / (avail * (select n from all_days)) * 100
        )::int
      end as pct
    from seat s
    left join occ o on o.seat_id = s.id
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
    from occ
    group by 1, 2
  ),
  outcome as (
    select
      case
        when status = 'active' then '정상 종료'
        when away_since is not null then '자리비움 자동취소'
        else '직접 취소'
      end as kind,
      case
        when status = 'active' then 1
        when away_since is not null then 3
        else 2
      end as ord,
      count(*)::int as cnt
    from occ
    group by 1, 2
  )
  select jsonb_build_object(
    'cutoff', to_char(cut_time, 'HH24:MI'),
    -- 어느 날짜를 '당일'로 보여 주는지. 화면이 날짜를 그대로 적을 수 있게 함께 내린다.
    'day', to_char(today_d, 'YYYY-MM-DD'),
    'prev_day', now_t < open_t,
    'full_day', cut_time >= close_t,
    'days', (select n_days from p),
    'seats', seats_n,
    'today', jsonb_build_object(
      'count',    coalesce((select cnt from t), 0),
      'short',    coalesce((select short from t), 0),
      'minutes',  (select round(secs_e / nullif(users_e, 0) / 60) from t),
      'util',     case when avail = 0 then null
                       else (select round(secs_all / (avail * seats_n) * 100) from t) end
    ),
    'avg', jsonb_build_object(
      'count',    (select round(cnt, 1) from p),
      'short',    (select round(short, 1) from p),
      'minutes',  (select round(per_user_secs / 60) from p),
      'util',     case when avail = 0 then null
                       else (select round(secs_all / (avail * seats_n) * 100) from p) end
    ),
    'hourly',   (select coalesce(jsonb_agg(jsonb_build_object(
                  'h', h, 'avg', avg_seats, 'today', today_seats) order by h), '[]'::jsonb) from hourly),
    'seats_pct',(select coalesce(jsonb_agg(jsonb_build_object(
                  'id', id, 'label', label, 'pct', pct) order by id), '[]'::jsonb) from seat_pct),
    'duration', (select coalesce(jsonb_agg(jsonb_build_object(
                  'bucket', bucket, 'cnt', cnt) order by ord), '[]'::jsonb) from duration),
    'outcome',  (select coalesce(jsonb_agg(jsonb_build_object(
                  'kind', kind, 'cnt', cnt) order by ord), '[]'::jsonb) from outcome)
  ) into out_json;

  return out_json;
end;
$$;

grant execute on function admin_stats(int) to authenticated;
