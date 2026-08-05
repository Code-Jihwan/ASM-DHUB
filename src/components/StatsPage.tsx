"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, Clock, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { humanizeDbError } from "@/lib/errors";
import type { Stats, StatsBucket, StatsOutcome } from "@/lib/types";

const CARD = "rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm md:p-6";

/**
 * 차트 색. 눈대중으로 고르지 않고 대비·색약 검증을 통과한 값만 쓴다.
 * 이용 시간은 순서가 있는 값이라 한 색조의 밝음→어두움 램프(sequential)를 쓴다.
 * 종료 유형은 의미가 있는 값이라 상태색을 쓰고, 색만으로 구분하지 않도록 수치를 늘 함께 적는다.
 */
const RAMP = ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#0d366b"];
const OUTCOME_COLOR: Record<string, string> = {
  "정상 종료": "#0ca30c",
  "직접 취소": "#898781",
  "자리비움 자동취소": "#fab219",
};
const GRID = "#e1e0d9";
const GOOD_INK = "#006300";
const BAD_INK = "#d03b3b";

const RANGES = [
  { days: 7, label: "최근 7일" },
  { days: 30, label: "30일" },
  { days: 0, label: "전체" },
];

/** "2026-08-05" → "8월 5일(수)". 서버가 정한 날짜를 그대로 쓰므로 기기 시계와 무관하다. */
function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const w = "일월화수목금토"[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}월 ${d}일(${w})`;
}

/** 분을 "1시간 20분"처럼 읽기 좋게. */
function fmtMin(m: number | null): string {
  if (m === null) return "—";
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h}시간` : `${h}시간 ${rest}분`;
}

/** 평균 대비 당일 변화. 퍼센트포인트로 볼 지표(이용률)는 unit="%p". */
function delta(
  today: number | null,
  avg: number | null,
  unit: "%" | "%p",
): { text: string; up: boolean } | null {
  if (today === null || avg === null || avg === 0) return null;
  const d = unit === "%p" ? today - avg : ((today - avg) / avg) * 100;
  const r = Math.round(d * 10) / 10;
  if (r === 0) return null;
  return { text: `${r > 0 ? "+" : ""}${r}${unit}`, up: r > 0 };
}

function KpiCard({
  label,
  icon: Icon,
  today,
  avg,
  diff,
}: {
  label: string;
  icon: LucideIcon;
  today: string;
  avg: string;
  diff: { text: string; up: boolean } | null;
}) {
  return (
    <div className={CARD}>
      <div className="mb-3.5 flex items-center justify-between">
        <span className="text-[13px] font-bold tracking-wide text-neutral-500">{label}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-neutral-50">
          <Icon className="h-4 w-4 text-neutral-700" />
        </span>
      </div>
      {/* 오늘 값을 주인공으로 크게, 평균은 비교 기준으로 아래에. 값이 길어도 줄이 깨지지 않는다. */}
      <p className="whitespace-nowrap text-[26px] font-black leading-none tracking-tight text-neutral-900">
        {today}
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="whitespace-nowrap text-[12px] font-bold text-neutral-500">
          평균 {avg}
        </span>
        {diff && (
          <span
            className="whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-black tabular-nums"
            style={{
              color: diff.up ? GOOD_INK : BAD_INK,
              background: diff.up ? "#0ca30c1a" : "#d03b3b1a",
            }}
          >
            {diff.up ? "▲" : "▼"} {diff.text}
          </span>
        )}
      </div>
    </div>
  );
}

/** 부분이 전체를 이루는 값에만 쓴다. 세그먼트마다 수치를 직접 적어 색만으로 읽지 않게 한다. */
function Donut({
  data,
  center,
  centerLabel,
}: {
  data: { label: string; pct: number; color: string }[];
  center: string;
  centerLabel: string;
}) {
  const R = 56;
  const SW = 18;
  const C = 2 * Math.PI * R;
  const GAP = 3;
  // 세그먼트 시작 위치는 앞 조각들의 합이다. 누적 변수를 굴리지 않고 그때그때 더해 구한다.
  const segs = data.map((d, i) => {
    const before = data.slice(0, i).reduce((s, x) => s + x.pct, 0);
    const len = (d.pct / 100) * C;
    return { ...d, dash: Math.max(0, len - GAP), offset: -(before / 100) * C };
  });
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 140 140" className="h-[140px] w-[140px] shrink-0" role="img">
        <g transform="translate(70 70) rotate(-90)">
          <circle r={R} fill="none" stroke={GRID} strokeWidth={SW} />
          {segs.map((d) => (
            <circle
              key={d.label}
              r={R}
              fill="none"
              stroke={d.color}
              strokeWidth={SW}
              strokeDasharray={`${d.dash} ${C - d.dash}`}
              strokeDashoffset={d.offset}
            />
          ))}
        </g>
        <text
          x="70"
          y="66"
          textAnchor="middle"
          className="fill-neutral-900 text-[22px] font-black"
        >
          {center}
        </text>
        <text x="70" y="84" textAnchor="middle" className="fill-neutral-400 text-[10px] font-bold">
          {centerLabel}
        </text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-2">
        {data.map((d) => (
          <li key={d.label} className="flex items-center gap-2.5">
            <span
              className="h-3 w-3 shrink-0 rounded-[3px]"
              style={{ background: d.color }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-neutral-600">
              {d.label}
            </span>
            <span className="shrink-0 text-[13px] font-black tabular-nums text-neutral-900">
              {d.pct}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function toPct(rows: { cnt: number }[]): number[] {
  const total = rows.reduce((s, r) => s + r.cnt, 0);
  return total === 0 ? rows.map(() => 0) : rows.map((r) => Math.round((r.cnt / total) * 100));
}

/** 좌석도와 같은 배치. 3석 / 2석 / 3석 그룹 사이가 통로다. */
const COLS = "repeat(3, 1fr) 0.45fr repeat(2, 1fr) 0.45fr repeat(3, 1fr)";
const SLOTS = [1, 2, 3, null, 4, 5, null, 6, 7, 8] as const;

/**
 * 색 단계는 그 기간에 가장 많이 쓰인 자리를 기준으로 나눈다.
 * 0~100% 고정으로 나누면 전체 이용률이 낮은 기간에는 48석이 죄다 같은 색이 되어
 * "어느 자리가 덜 쓰이는지"를 볼 수 없다. 대신 범례에 실제 최댓값을 적어 오해를 막는다.
 */
function heatStep(pct: number, maxPct: number): number {
  const r = maxPct <= 0 ? 0 : pct / maxPct;
  if (r < 0.2) return 0;
  if (r < 0.4) return 1;
  if (r < 0.6) return 2;
  if (r < 0.8) return 3;
  return 4;
}
/** 밝은 두 단계 위에서는 흰 글씨가 읽히지 않으므로 검정으로 뒤집는다. */
function heatInk(step: number) {
  return step < 2
    ? { strong: "text-neutral-900", weak: "text-neutral-700" }
    : { strong: "text-white", weak: "text-white/75" };
}

export function StatsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 어느 기간의 결과를 들고 있는지. loading을 따로 두지 않고 이 값으로 판단해,
  // effect 안에서 곧바로 setState 하지 않는다(불필요한 연쇄 렌더 방지).
  const [loadedFor, setLoadedFor] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.rpc("admin_stats", { p_days: days }).then(({ data: json, error: e }) => {
      if (cancelled) return;
      if (e) {
        setError(humanizeDbError(e));
      } else {
        setError(null);
        setData(json as Stats);
      }
      setLoadedFor(days);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, days]);

  const loading = loadedFor !== days;

  const seatMap = useMemo(() => {
    const m = new Map<number, { label: string; pct: number }>();
    for (const s of data?.seats_pct ?? []) m.set(s.id, { label: s.label, pct: s.pct });
    return m;
  }, [data]);

  const durPct = toPct(data?.duration ?? []);
  const outPct = toPct(data?.outcome ?? []);
  // 당일 값이 평균보다 크면 표시선이 그래프 밖으로 나가므로 둘 다 넣어 최댓값을 잡는다.
  const hourMax = Math.max(
    1,
    ...(data?.hourly ?? []).flatMap((x) => [x.avg, x.today ?? 0]),
  );
  const maxSeatPct = Math.max(0, ...(data?.seats_pct ?? []).map((s) => s.pct));

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-neutral-900">시설 이용 분석</h1>
          <p className="mt-1 text-[13px] font-medium text-neutral-500">
            {data ? (
              <>
                <b className="font-bold text-neutral-800">
                  {data.prev_day ? "어제" : "오늘"} {fmtDay(data.day)}
                </b>{" "}
                {data.full_day ? "하루 전체" : `${data.cutoff}까지`}
                {data.prev_day && " · 오늘은 아직 시작 전이라 어제를 보여줍니다"}
                {!data.full_day && (
                  <>
                    {" "}
                    · 평균도 <b className="font-bold text-neutral-700">같은 시각까지</b> 잘라
                    비교합니다
                  </>
                )}
                {" · "}
                평균은 이용이 있었던 {data.days}일 기준
              </>
            ) : (
              "불러오는 중…"
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5 rounded-xl border border-neutral-200 bg-white p-1">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              onClick={() => setDays(r.days)}
              aria-pressed={days === r.days}
              className={
                "rounded-lg px-3 py-1.5 text-[12px] font-bold transition-all " +
                (days === r.days
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-500 hover:bg-neutral-100")
              }
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 px-5 py-3.5 text-sm font-bold text-red-700"
        >
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="space-y-4 md:space-y-6">
          <div className="grid gap-3 md:grid-cols-3 md:gap-6">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[132px] animate-pulse rounded-3xl bg-neutral-200/60" />
            ))}
          </div>
          <div className="h-[260px] animate-pulse rounded-3xl bg-neutral-200/60" />
        </div>
      ) : data ? (
        <>
          <div className="grid gap-3 md:grid-cols-3 md:gap-6">
            <KpiCard
              label="예약 건수"
              icon={Users}
              today={data.today.count === null ? "—" : `${data.today.count}건`}
              avg={data.avg.count === null ? "—" : `${data.avg.count}건`}
              diff={delta(data.today.count, data.avg.count, "%")}
            />
            <KpiCard
              label="인당 이용 시간"
              icon={Clock}
              today={fmtMin(data.today.minutes)}
              avg={fmtMin(data.avg.minutes)}
              diff={delta(data.today.minutes, data.avg.minutes, "%")}
            />
            <KpiCard
              label="좌석 이용률"
              icon={BarChart3}
              today={data.today.util === null ? "—" : `${data.today.util}%`}
              avg={data.avg.util === null ? "—" : `${data.avg.util}%`}
              diff={delta(data.today.util, data.avg.util, "%p")}
            />
          </div>

          <p className="text-[12px] font-medium text-neutral-500">
            인당 이용 시간은 <b className="font-bold text-neutral-700">실제 점유 30분 이상</b>인
            건만 평균에 넣습니다.
            {data.today.short !== null && data.today.short > 0 && (
              <>
                {" "}
                {data.prev_day ? "어제" : "오늘"} {data.today.count}건 중{" "}
                <b className="font-bold text-neutral-700">{data.today.short}건</b>이 30분
                미만(노쇼·조기 이탈)으로 제외됐습니다.
              </>
            )}
          </p>

          <div className="grid gap-3 md:grid-cols-2 md:gap-6">
            <div className={CARD}>
              <h2 className="mb-1 text-[15px] font-black tracking-tight text-neutral-900">
                예약 시간 분포
              </h2>
              <p className="mb-4 text-[12px] font-medium text-neutral-500">
                프리셋(30분·1·2·3시간)이 실제 수요와 맞는지 확인
              </p>
              {data.duration.length === 0 ? (
                <p className="py-8 text-center text-sm font-bold text-neutral-400">
                  아직 데이터가 없습니다.
                </p>
              ) : (
                <Donut
                  data={data.duration.map((d: StatsBucket, i) => ({
                    label: d.bucket,
                    pct: durPct[i],
                    color: RAMP[i] ?? RAMP[RAMP.length - 1],
                  }))}
                  center={`${data.duration.reduce((s, d) => s + d.cnt, 0)}건`}
                  centerLabel="전체"
                />
              )}
            </div>

            <div className={CARD}>
              <h2 className="mb-1 text-[15px] font-black tracking-tight text-neutral-900">
                종료 유형
              </h2>
              <p className="mb-4 text-[12px] font-medium text-neutral-500">
                자리비움 자동취소가 늘면 악용·노쇼 신호
              </p>
              {data.outcome.length === 0 ? (
                <p className="py-8 text-center text-sm font-bold text-neutral-400">
                  아직 데이터가 없습니다.
                </p>
              ) : (
                <Donut
                  data={data.outcome.map((o: StatsOutcome, i) => ({
                    label: o.kind,
                    pct: outPct[i],
                    color: OUTCOME_COLOR[o.kind] ?? RAMP[2],
                  }))}
                  center={`${outPct[data.outcome.findIndex((o) => o.kind === "정상 종료")] ?? 0}%`}
                  centerLabel="정상 종료"
                />
              )}
            </div>
          </div>

          <div className={CARD}>
            <h2 className="mb-1 text-[15px] font-black tracking-tight text-neutral-900">
              시간대별 평균 점유 좌석
            </h2>
            <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <p className="text-[12px] font-medium text-neutral-500">{data.seats}석 기준</p>
              <span className="flex items-center gap-1.5 text-[11px] font-bold text-neutral-600">
                <span
                  className="h-3 w-3 rounded-[3px]"
                  style={{ background: RAMP[1] }}
                  aria-hidden
                />
                평균
              </span>
              <span className="flex items-center gap-1.5 text-[11px] font-bold text-neutral-600">
                <span className="h-[3px] w-4 rounded-full bg-neutral-900" aria-hidden />
                오늘
              </span>
              <span className="flex items-center gap-1.5 text-[11px] font-bold text-neutral-400">
                <span className="h-3 w-3 rounded-[3px] bg-neutral-200" aria-hidden />
                아직 지나지 않음
              </span>
            </div>
            <div className="flex h-[150px] items-end gap-1.5">
              {data.hourly.map(({ h, avg, today }) => {
                const future = today === null;
                return (
                  <div key={h} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                    <div className="relative flex h-[110px] w-full items-end">
                      <div
                        className="w-full rounded-t-[4px]"
                        style={{
                          height: `${(avg / hourMax) * 100}%`,
                          background: RAMP[1],
                          opacity: future ? 0.28 : 1,
                        }}
                        title={`${h}시 평균 ${avg}석`}
                      />
                      {!future && (
                        <div
                          className="absolute inset-x-0"
                          style={{ bottom: `${(today / hourMax) * 100}%` }}
                          title={`${h}시 오늘 ${today}석`}
                        >
                          <div className="h-[3px] w-full rounded-full bg-neutral-900" />
                        </div>
                      )}
                    </div>
                    <span
                      className={
                        "text-[10px] font-bold tabular-nums " +
                        (future ? "text-neutral-300" : "text-neutral-500")
                      }
                    >
                      {h}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className={CARD}>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[15px] font-black tracking-tight text-neutral-900">
                좌석별 이용률
              </h2>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-neutral-400 tabular-nums">0%</span>
                {RAMP.map((c) => (
                  <span key={c} className="h-3 w-5 rounded-[3px]" style={{ background: c }} />
                ))}
                <span className="text-[10px] font-bold text-neutral-400 tabular-nums">
                  {maxSeatPct}%
                </span>
              </div>
            </div>
            <p className="mb-4 text-[12px] font-medium text-neutral-500">
              잘 안 쓰이는 자리를 찾아 원인을 확인합니다(출입문 인접·통로·설비 상태)
            </p>
            <div className="scroll-thin overflow-x-auto">
              <div className="min-w-[560px] space-y-4 rounded-[20px] bg-floor p-3">
                <div className="flex items-center gap-4 px-1">
                  <div className="h-[3px] flex-1 rounded-full bg-gradient-to-r from-transparent to-sky-200/70" />
                  <span className="text-[11px] font-bold tracking-widest text-sky-500">창가</span>
                  <div className="h-[3px] flex-1 rounded-full bg-gradient-to-l from-transparent to-sky-200/70" />
                </div>
                {[1, 2, 3].map((block) => (
                  <div key={block} className="space-y-1.5">
                    {[1, 2].map((row) => (
                      <div key={row} className="grid gap-1.5" style={{ gridTemplateColumns: COLS }}>
                        {SLOTS.map((col, i) => {
                          if (col === null) return <div key={`g${i}`} aria-hidden />;
                          const id = (block - 1) * 16 + (row - 1) * 8 + col;
                          const s = seatMap.get(id);
                          if (!s) return <div key={`e${i}`} aria-hidden />;
                          const step = heatStep(s.pct, maxSeatPct);
                          const ink = heatInk(step);
                          return (
                            <div
                              key={id}
                              title={`${s.label}번 · 이용률 ${s.pct}%`}
                              className="flex h-[42px] flex-col items-center justify-center rounded-[10px]"
                              style={{ background: RAMP[step] }}
                            >
                              <span
                                className={`text-[13px] font-black leading-none tabular-nums ${ink.strong}`}
                              >
                                {s.label}
                              </span>
                              <span
                                className={`text-[9px] font-bold leading-none tabular-nums ${ink.weak}`}
                              >
                                {s.pct}%
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ))}
                <div className="flex justify-between px-1">
                  <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[10px] font-bold text-neutral-600">
                    출입문
                  </span>
                  <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[10px] font-bold text-neutral-600">
                    출입문
                  </span>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
