-- 시설 이용 분석을 '날짜 범위' 기준으로 바꾼다.
--
-- 기존 admin_stats(p_days int)는 '오늘 vs 최근 N일 평균, 같은 시각까지'용이었다. 화면에서
-- 요약 카드(건수·인당 시간·이용률)를 걷어내고 차트 4개만 남기면서, 지표를 임의의 날짜
-- 범위로 집계하도록 다시 짠다. 기본값은 전체 기간(둘 다 null)이다.
--
-- 규칙:
--  · 범위 [from, to]. from null → 데이터가 있는 가장 이른 날, to null → 오늘.
--  · 평균(시간대별 점유율·좌석별 이용률)은 '완료된 날'만으로 낸다(오늘은 아직 안 끝나 제외).
--    그래야 오전에 봐도 평균이 낮게 왜곡되지 않는다.
--  · 도넛 2개(예약 시간 분포·종료 유형)는 범위 안의 예약을 그대로 센다(오늘 포함).
--  · to가 오늘 이상이면 '오늘' 곡선을 함께 얹는다(오늘 실제 점유율). 과거만 보면 오늘은 숨긴다.
--  · 점유율은 좌석 수 대비 %. 시간대별은 그 시간의 평균 동시 점유 좌석 ÷ 전체 좌석.

drop function if exists admin_stats(int);

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
  )

  select jsonb_build_object(
    'from', to_char(from_d, 'YYYY-MM-DD'),
    'to', to_char(to_d, 'YYYY-MM-DD'),
    'days', (select n from past_days),
    'seats', seats_n,
    'include_today', inc_today,
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
