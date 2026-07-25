"use client";

import { Clock, Info, Minus, MonitorDot, Plus } from "lucide-react";
import { addMinutes, DURATION_PRESETS, floorMinute, fmtMinutes, fmtTime, POLICY } from "@/lib/policy";
import type { Seat } from "@/lib/types";

type Props = {
  seat: Seat | undefined;
  now: Date;
  /** 선택한 이용 시간(분) */
  durationMin: number;
  /** 이 좌석에서 지금부터 예약 가능한 최대 이용 시간(분). 정책 상한과 다음 예약까지 남은 시간 중 작은 값. */
  maxMin: number;
  onDuration: (m: number) => void;
  onSubmit: () => void;
  busy: boolean;
  mode: "book" | "change";
  /** 예약을 받을 수 없으면 이유를 넣는다. 넣으면 예약 UI 대신 이 문구가 나온다. */
  locked?: string | null;
};

export const PANEL =
  "flex w-full shrink-0 flex-col overflow-hidden rounded-3xl border border-neutral-200 " +
  "bg-white shadow-sm lg:h-full lg:min-h-0 lg:w-[280px] xl:w-[320px]";

function PanelMessage({
  title,
  body,
  tone = "neutral",
}: {
  title: string;
  body: React.ReactNode;
  tone?: "neutral" | "emerald";
}) {
  return (
    <div className={`${PANEL} items-center justify-center p-8 text-center`}>
      <div
        className={
          "mb-6 flex h-20 w-20 items-center justify-center rounded-[24px] border " +
          (tone === "emerald" ? "border-emerald-100 bg-emerald-50" : "border-neutral-100 bg-neutral-50")
        }
      >
        <MonitorDot className={`h-10 w-10 ${tone === "emerald" ? "text-emerald-400" : "text-neutral-300"}`} />
      </div>
      <p className="mb-2 text-xl font-black text-neutral-900">{title}</p>
      <p className="text-sm font-medium leading-relaxed text-neutral-500">{body}</p>
    </div>
  );
}

/**
 * "지금부터 몇 분" 예약 패널.
 * 시작은 늘 현재 분(floorMinute). +30/60/90/120분 프리셋과 10분 단위 드롭다운으로 이용 시간을 고른다.
 * 최대 이용 시간(maxMin)은 부모가 정책 상한과 좌석의 다음 예약까지 남은 시간을 합쳐 넘겨준다.
 */
export function ReservationPanel({
  seat,
  now,
  durationMin,
  maxMin,
  onDuration,
  onSubmit,
  busy,
  mode,
  locked,
}: Props) {
  if (!seat) {
    return (
      <PanelMessage
        title="좌석을 선택해주세요"
        body={
          <>
            예약할 좌석을 클릭하시면
            <br />
            이용 시간을 선택하실 수 있습니다.
          </>
        }
      />
    );
  }

  if (locked) {
    return <PanelMessage title={`${seat.label}번 자리`} body={locked} tone="emerald" />;
  }

  const start = floorMinute(now);
  const step = POLICY.slotMinutes;

  const presets = DURATION_PRESETS.filter((m) => m <= maxMin);
  const end = addMinutes(start, durationMin);
  const canSubmit = durationMin > 0 && durationMin <= maxMin && !busy;

  // 세부 조정 스테퍼 경계
  const canDec = durationMin > step;
  const canInc = durationMin + step <= maxMin;

  return (
    <div className={PANEL}>
      <div className="shrink-0 border-b border-neutral-100 bg-gradient-to-b from-neutral-50/50 to-white px-6 py-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[42px] font-black leading-none tracking-tight text-neutral-900 tabular-nums">
            {seat.label}
          </h3>
          <span className="shrink-0 rounded-full border border-green-200/50 bg-green-50 px-3 py-1.5 text-[11px] font-bold text-green-700">
            예약 가능
          </span>
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {/* 시작: 지금 고정 */}
        <div className="mb-5 flex items-center justify-between rounded-2xl border border-neutral-100 bg-neutral-50 px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-bold text-neutral-500">
            <Clock className="h-4 w-4 text-neutral-400" />
            시작 시간
          </span>
          <span className="text-base font-black tabular-nums text-neutral-900">{fmtTime(start)}</span>
        </div>

        <p className="mb-2 text-xs font-bold text-neutral-500">얼마나 쓰실 건가요?</p>

        {/* 프리셋 */}
        <div className="grid grid-cols-2 gap-2.5">
          {presets.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onDuration(m)}
              className={`rounded-xl border py-3 text-sm font-bold tabular-nums transition-all ${
                durationMin === m
                  ? "scale-[1.02] border-neutral-900 bg-neutral-900 text-white shadow-md"
                  : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-900 hover:text-neutral-900"
              }`}
            >
              {fmtMinutes(m)}
            </button>
          ))}
        </div>

        {/* 10분 단위 미세 조정 스테퍼 */}
        <p className="mb-2 mt-5 text-xs font-bold text-neutral-500">10분씩 세부 조정</p>
        <div className="flex items-center gap-2 rounded-2xl border border-neutral-200 p-1.5">
          <button
            type="button"
            onClick={() => onDuration(durationMin - step)}
            disabled={!canDec}
            aria-label="10분 줄이기"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-700 transition-all hover:bg-neutral-200 active:scale-95 disabled:opacity-30"
          >
            <Minus className="h-4 w-4" />
          </button>
          <div className="flex-1 text-center">
            <div className="text-base font-black tabular-nums text-neutral-900">
              {fmtMinutes(durationMin)}
            </div>
            <div className="text-[11px] font-bold tabular-nums text-neutral-400">
              {fmtTime(end)}까지
            </div>
          </div>
          <button
            type="button"
            onClick={() => onDuration(durationMin + step)}
            disabled={!canInc}
            aria-label="10분 늘리기"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-700 transition-all hover:bg-neutral-200 active:scale-95 disabled:opacity-30"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="shrink-0 border-t border-neutral-100 px-6 pb-6 pt-5">
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-neutral-100 bg-neutral-50 p-3.5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
          <p className="text-[11px] font-medium leading-relaxed text-neutral-500">
            {seat.label}번 자리를 지금 {fmtTime(start)}부터 <b className="font-bold text-neutral-700">{fmtTime(end)}</b>까지
            사용합니다. 종료 {POLICY.extendWindowHours}시간 전부터 최대 {POLICY.maxExtendHours}시간 한 번 연장할 수 있습니다.
          </p>
        </div>

        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm font-bold text-neutral-500">총 이용 시간</span>
          <span className="text-xl font-black tracking-tight text-neutral-900">{fmtMinutes(durationMin)}</span>
        </div>

        <button
          type="button"
          disabled={!canSubmit}
          onClick={onSubmit}
          className={`w-full rounded-xl py-4 text-sm font-bold transition-all active:scale-[0.98] ${
            canSubmit
              ? "bg-neutral-900 text-white hover:bg-black hover:shadow-lg"
              : "cursor-not-allowed bg-neutral-100 text-neutral-400"
          }`}
        >
          {busy ? "처리 중…" : mode === "change" ? "이 자리로 변경하기" : "예약 확정하기"}
        </button>
      </div>
    </div>
  );
}
