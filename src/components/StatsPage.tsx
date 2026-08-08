"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { humanizeDbError } from "@/lib/errors";
import { useNow } from "@/lib/useNow";
import type { Stats, StatsBucket, StatsHour, StatsOutcome } from "@/lib/types";

const CARD = "rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm md:p-6";

/**
 * 차트 색. 눈대중이 아니라 대비·색약 검증을 통과한 값만 쓴다.
 * 예약 시간은 순서가 있어 한 색조의 밝음→어두움 램프(sequential), 종료 유형은 의미가 있어 상태색.
 * 색만으로 구분하지 않도록 수치를 늘 함께 적는다.
 */
const RAMP = ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#0d366b"];
// 예약 시간 분포: 슬라이스를 또렷이 구분하려 검증된 카테고리 5색을 버킷별로 고정한다.
// (버킷 하나가 비어도 색이 밀리지 않게 이름으로 매핑한다.)
const DUR_COLOR: Record<string, string> = {
  "30분 이하": "#2a78d6", // blue
  "~1시간": "#eb6834", // orange
  "~2시간": "#1baf7a", // aqua
  "~3시간": "#eda100", // yellow
  "3시간 초과": "#4a3aa7", // violet
};
// 좌석 히트맵: 저사용은 옅게, 고사용은 진하게. 셀 테두리로 옅은 칸도 또렷하게 구분한다.
const HEAT = ["#c3daf6", "#8fbdf0", "#4a8ee0", "#2160b6", "#0d366b"];
const BAR = "#3987e5"; // 시간대별 평균 막대
const TODAY = "#0f172a"; // 오늘 곡선
const OUTCOME_COLOR: Record<string, string> = {
  "정상 종료": "#0ca30c",
  "좌석 반납": "#2a78d6",
  "예약 취소": "#898781",
  "자리비움 자동취소": "#fab219",
};
const PROPER_USE = ["정상 종료", "좌석 반납"];
const GRID = "#e1e0d9";

/* ── 날짜 유틸 (모두 서버 시각 기준 Asia/Seoul) ──────────── */
const KST = { timeZone: "Asia/Seoul" } as const;
function ymd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", KST).format(d); // YYYY-MM-DD
}
function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(dt);
}
function fmtDot(iso: string): string {
  return iso.replaceAll("-", ".");
}

/* ── 도넛 (합이 100%인 것에만) ──────────────────────────── */
function Donut({
  data,
  center,
  centerLabel,
}: {
  data: { label: string; pct: number; color: string }[];
  center: string;
  centerLabel: string;
}) {
  const R = 54;
  const SW = 15;
  const C = 2 * Math.PI * R;
  // 각진 끝(butt) + 조각 사이 적당한 간격. butt는 밖으로 삐져나오지 않아 간격이 그대로 보인다.
  // 아주 작은 조각도 최소 길이는 남긴다.
  const GAP = data.length > 1 ? 6 : 0;
  const segs = data.map((d, i) => {
    const before = (data.slice(0, i).reduce((s, x) => s + x.pct, 0) / 100) * C;
    const len = (d.pct / 100) * C;
    const dash = Math.max(3, len - GAP);
    // 남는 여백을 양쪽에 반씩 둬 조각을 제 구간 가운데에 놓는다.
    return { ...d, dash, offset: -(before + (len - dash) / 2) };
  });
  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 130 130" className="h-[140px] w-[140px] shrink-0" role="img">
        <g transform="translate(65 65) rotate(-90)">
          {segs.map((d) => (
            <circle
              key={d.label}
              r={R}
              fill="none"
              stroke={d.color}
              strokeWidth={SW}
              strokeLinecap="butt"
              strokeDasharray={`${d.dash} ${C}`}
              strokeDashoffset={d.offset}
            />
          ))}
        </g>
        <text x="65" y="62" textAnchor="middle" className="fill-neutral-900 text-[23px] font-black">
          {center}
        </text>
        <text x="65" y="79" textAnchor="middle" className="fill-neutral-400 text-[10px] font-bold">
          {centerLabel}
        </text>
      </svg>
      {/* 범례: 차트 오른쪽 세로 목록, 동그란 점 */}
      <ul className="min-w-0 flex-1 space-y-2">
        {data.map((d) => (
          <li key={d.label} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: d.color }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-neutral-700">
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

/* ── 시간대별 평균 좌석 점유율 (막대=평균, 곡선=오늘) ─────── */
function HourlyChart({ hourly, hasToday }: { hourly: StatsHour[]; hasToday: boolean }) {
  const maxV = Math.max(0, ...hourly.map((h) => Math.max(h.avg, h.today ?? 0)));
  const yMax = maxV <= 0 ? 10 : Math.max(10, Math.ceil(maxV / 10) * 10);

  const gutterL = 36;
  const colW = 46;
  const padX = 6;
  const topPad = 12;
  const plotH = 150;
  const xLabelH = 22;
  const W = gutterL + hourly.length * colW + 8;
  const H = topPad + plotH + xLabelH;
  const yTo = (v: number) => topPad + plotH * (1 - v / yMax);
  const cx = (i: number) => gutterL + i * colW + colW / 2;
  const ticks = [0, yMax / 2, yMax];

  const todayPts = hourly
    .map((h, i) => (h.today === null ? null : `${cx(i)},${yTo(h.today)}`))
    .filter((p): p is string => p !== null);

  return (
    <div className="scroll-thin overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full min-w-[520px]"
        role="img"
        aria-label="시간대별 평균 좌석 점유율"
      >
        {/* 눈금선 + Y축 % 라벨 */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={gutterL} x2={W} y1={yTo(t)} y2={yTo(t)} stroke={GRID} strokeWidth={1} />
            <text
              x={gutterL - 6}
              y={yTo(t) + 3}
              textAnchor="end"
              className="fill-neutral-400 text-[9px] font-bold"
            >
              {Math.round(t)}%
            </text>
          </g>
        ))}

        {/* 평균 막대 */}
        {hourly.map((h, i) => {
          const y = yTo(h.avg);
          return (
            <rect
              key={h.h}
              x={gutterL + i * colW + padX}
              y={y}
              width={colW - 2 * padX}
              height={Math.max(0, topPad + plotH - y)}
              rx={3}
              fill={BAR}
            >
              <title>
                {h.h}시 · 평균 {h.avg}%{h.today !== null ? ` · 오늘 ${h.today}%` : ""}
              </title>
            </rect>
          );
        })}

        {/* 오늘 곡선 + 점 */}
        {hasToday && todayPts.length > 0 && (
          <>
            <polyline
              points={todayPts.join(" ")}
              fill="none"
              stroke={TODAY}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {hourly.map((h, i) =>
              h.today === null ? null : (
                <circle key={h.h} cx={cx(i)} cy={yTo(h.today)} r={3} fill={TODAY} />
              ),
            )}
          </>
        )}

        {/* X축 시간 라벨 */}
        {hourly.map((h, i) => (
          <text
            key={h.h}
            x={cx(i)}
            y={topPad + plotH + 15}
            textAnchor="middle"
            className="fill-neutral-500 text-[9px] font-bold"
          >
            {h.h}시
          </text>
        ))}
      </svg>
    </div>
  );
}

/* ── 좌석 히트맵 ────────────────────────────────────────── */
const COLS = "repeat(3, 1fr) 0.45fr repeat(2, 1fr) 0.45fr repeat(3, 1fr)";
const SLOTS = [1, 2, 3, null, 4, 5, null, 6, 7, 8] as const;
function heatStep(pct: number, maxPct: number): number {
  const r = maxPct <= 0 ? 0 : pct / maxPct;
  if (r < 0.2) return 0;
  if (r < 0.4) return 1;
  if (r < 0.6) return 2;
  if (r < 0.8) return 3;
  return 4;
}
function heatInk(step: number) {
  return step <= 1
    ? { strong: "text-neutral-900", weak: "text-neutral-500" }
    : { strong: "text-white", weak: "text-white/80" };
}

/* ── 기간 컨트롤 ────────────────────────────────────────── */
const CHIP = "rounded-lg px-3 py-1.5 text-[12px] font-bold transition-all";
const DATE_INPUT =
  "rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[12px] font-bold text-neutral-700 tabular-nums focus:border-neutral-900 focus:outline-none";

export function StatsPage() {
  const supabase = useMemo(() => createClient(), []);
  const now = useNow();
  const today = now ? ymd(now) : null;

  // "" = 열림(전체). 둘 다 ""면 전체 기간.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const key = `${from}|${to}`;

  useEffect(() => {
    let cancelled = false;
    supabase
      .rpc("admin_stats", { p_from: from || null, p_to: to || null })
      .then(({ data: json, error: e }) => {
        if (cancelled) return;
        if (e) setError(humanizeDbError(e));
        else {
          setError(null);
          setData(json as Stats);
        }
        setLoadedKey(`${from}|${to}`);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, from, to]);

  const loading = loadedKey !== key;

  // 프리셋 적용 여부(강조용). 서버 오늘 기준으로 계산한다.
  const preset =
    from === "" && to === ""
      ? "all"
      : today && to === today && from === addDays(today, -6)
        ? "7"
        : today && to === today && from === addDays(today, -29)
          ? "30"
          : "custom";

  const applyPreset = (days: number | null) => {
    if (days === null) {
      setFrom("");
      setTo("");
    } else if (today) {
      setFrom(addDays(today, -(days - 1)));
      setTo(today);
    }
  };

  const durPct = toPct(data?.duration ?? []);
  const outPct = toPct(data?.outcome ?? []);
  const maxSeatPct = Math.max(0, ...(data?.seats_pct ?? []).map((s) => s.pct));
  const seatMap = useMemo(() => {
    const m = new Map<number, { label: string; pct: number }>();
    for (const s of data?.seats_pct ?? []) m.set(s.id, { label: s.label, pct: s.pct });
    return m;
  }, [data]);

  return (
    <div className="space-y-4 md:space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-neutral-900">시설 이용 분석</h1>
        <p className="mt-1 text-[13px] font-medium text-neutral-500">
          {data ? (
            <>
              {preset === "all" ? "전체 기간" : "선택 기간"}{" "}
              <b className="font-bold text-neutral-700">
                {fmtDot(data.from)} ~ {fmtDot(data.to)}
              </b>{" "}
              · 평균은 이용이 있었던 {data.days}일 기준
              {data.include_today && " · 오늘은 곡선으로 함께 표시"}
            </>
          ) : (
            "불러오는 중…"
          )}
        </p>
      </div>

      {/* 기간 선택 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5 rounded-xl border border-neutral-200 bg-white p-1">
          {[
            { k: "all", label: "전체", days: null as number | null },
            { k: "7", label: "최근 7일", days: 7 },
            { k: "30", label: "최근 30일", days: 30 },
          ].map((p) => (
            <button
              key={p.k}
              type="button"
              onClick={() => applyPreset(p.days)}
              disabled={p.days !== null && !today}
              aria-pressed={preset === p.k}
              className={`${CHIP} ${
                preset === p.k ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-100"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            aria-label="시작 날짜"
            className={DATE_INPUT}
            value={from}
            max={to || today || undefined}
            onChange={(e) => setFrom(e.target.value)}
          />
          <span className="text-[12px] font-bold text-neutral-400">~</span>
          <input
            type="date"
            aria-label="끝 날짜"
            className={DATE_INPUT}
            value={to}
            min={from || undefined}
            max={today || undefined}
            onChange={(e) => setTo(e.target.value)}
          />
          {preset === "custom" && (
            <button
              type="button"
              onClick={() => applyPreset(null)}
              className="text-[12px] font-bold text-neutral-400 underline underline-offset-2 hover:text-neutral-700"
            >
              초기화
            </button>
          )}
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
        <div className="grid gap-3 md:grid-cols-2 md:gap-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[220px] animate-pulse rounded-3xl bg-neutral-200/60" />
          ))}
        </div>
      ) : data ? (
        <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <div className="grid gap-3 md:grid-cols-2 md:gap-6">
            {/* 예약 시간 분포 */}
            <div className={CARD}>
              <h2 className="mb-1 text-[15px] font-black tracking-tight text-neutral-900">
                예약 시간 분포
              </h2>
              <p className="mb-4 text-[12px] font-medium text-neutral-500">
                프리셋(30분·1·2·3시간)이 실제 수요와 맞는지 확인
              </p>
              {data.duration.length === 0 ? (
                <p className="py-8 text-center text-sm font-bold text-neutral-400">
                  이 기간에 데이터가 없습니다.
                </p>
              ) : (
                <Donut
                  data={data.duration.map((d: StatsBucket, i) => ({
                    label: d.bucket,
                    pct: durPct[i],
                    color: DUR_COLOR[d.bucket] ?? RAMP[2],
                  }))}
                  center={`${data.duration.reduce((s, d) => s + d.cnt, 0)}건`}
                  centerLabel="전체"
                />
              )}
            </div>

            {/* 종료 유형 */}
            <div className={CARD}>
              <h2 className="mb-1 text-[15px] font-black tracking-tight text-neutral-900">종료 유형</h2>
              <p className="mb-4 text-[12px] font-medium text-neutral-500">
                자리비움 자동취소가 늘면 악용·노쇼 신호
              </p>
              {data.outcome.length === 0 ? (
                <p className="py-8 text-center text-sm font-bold text-neutral-400">
                  이 기간에 데이터가 없습니다.
                </p>
              ) : (
                <Donut
                  data={data.outcome.map((o: StatsOutcome, i) => ({
                    label: o.kind,
                    pct: outPct[i],
                    color: OUTCOME_COLOR[o.kind] ?? RAMP[2],
                  }))}
                  center={`${data.outcome.reduce(
                    (s, o, i) => (PROPER_USE.includes(o.kind) ? s + outPct[i] : s),
                    0,
                  )}%`}
                  centerLabel="정상 이용"
                />
              )}
            </div>
          </div>

          {/* 시간대별 평균 좌석 점유율 */}
          <div className={`${CARD} mt-3 md:mt-6`}>
            <h2 className="mb-1 text-[15px] font-black tracking-tight text-neutral-900">
              시간대별 평균 좌석 점유율
            </h2>
            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <p className="text-[12px] font-medium text-neutral-500">
                세로축은 전체 {data.seats}석 대비 % · 기간 평균
              </p>
              <span className="flex items-center gap-1.5 text-[11px] font-bold text-neutral-600">
                <span className="h-3 w-3 rounded-[3px]" style={{ background: BAR }} aria-hidden />
                평균
              </span>
              {data.include_today && (
                <span className="flex items-center gap-1.5 text-[11px] font-bold text-neutral-600">
                  <span className="h-[3px] w-4 rounded-full" style={{ background: TODAY }} aria-hidden />
                  오늘
                </span>
              )}
            </div>
            <HourlyChart hourly={data.hourly} hasToday={data.include_today} />
          </div>

          {/* 좌석별 이용률 */}
          <div className={`${CARD} mt-3 md:mt-6`}>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[15px] font-black tracking-tight text-neutral-900">
                좌석별 이용률
              </h2>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-neutral-400 tabular-nums">0%</span>
                {HEAT.map((c) => (
                  <span
                    key={c}
                    className="h-3 w-5 rounded-[3px] border border-black/5"
                    style={{ background: c }}
                  />
                ))}
                <span className="text-[10px] font-bold text-neutral-400 tabular-nums">
                  {maxSeatPct}%
                </span>
              </div>
            </div>
            <p className="mb-4 text-[12px] font-medium text-neutral-500">
              연수생들이 선호하는 좌석을 분석합니다.
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
                              className="flex h-[46px] flex-col items-center justify-center rounded-[10px] border border-black/5"
                              style={{ background: HEAT[step] }}
                            >
                              <span className={`text-[14px] font-black leading-none tabular-nums ${ink.strong}`}>
                                {s.label}
                              </span>
                              <span className={`mt-0.5 text-[10px] font-bold leading-none tabular-nums ${ink.weak}`}>
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
        </div>
      ) : null}
    </div>
  );
}
