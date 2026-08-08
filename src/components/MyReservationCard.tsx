"use client";

import { useState } from "react";
import { Ban, CircleCheck, Coffee, Minus, Pencil, Plus, Timer } from "lucide-react";
import type { Reservation, Seat } from "@/lib/types";
import {
  addHours,
  addMinutes,
  awayMinutes,
  extendChoices,
  fmtDate,
  fmtMinutes,
  fmtTime,
  inExtendWindow,
  isSeatReturn,
  parseRange,
  POLICY,
} from "@/lib/policy";
import { PANEL } from "./ReservationPanel";

type Props = {
  reservation: Reservation;
  seat: Seat | undefined;
  now: Date;
  onExtend: (newEnd: Date) => Promise<void>;
  onCancel: () => Promise<void>;
  onChange: () => void;
  onAway: (away: boolean) => Promise<void>;
  busy: boolean;
};

const ACTION =
  "flex items-center justify-center gap-1.5 rounded-xl border border-neutral-200 bg-white " +
  "py-3 text-[13px] font-bold text-neutral-600 transition-all hover:border-neutral-900 " +
  "hover:text-neutral-900 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-40";

/**
 * 내 예약 하나를 다루는 패널. 예약 화면 우측, 시간 선택 패널이 있던 자리에 들어간다.
 * 연장 · 변경 · 취소 · 자리비움이 모두 여기 있다.
 */
export function MyReservationCard({
  reservation,
  seat,
  now,
  onExtend,
  onCancel,
  onChange,
  onAway,
  busy,
}: Props) {
  const { start, end } = parseRange(reservation.period);
  const [picking, setPicking] = useState(false);
  const [extendMin, setExtendMin] = useState(0);

  const running = now >= start && now < end;
  // 10분 이상 쓰고 그만두면 '좌석 반납', 그 전이면 '예약 취소'. 동작은 같고 이름·안내만 다르다.
  const isReturn = isSeatReturn(start, now);
  const canExtend = !reservation.extended && inExtendWindow(end, now);
  const opensAt = addHours(end, -POLICY.extendWindowHours);
  const minsLeft = Math.max(0, Math.round((end.getTime() - now.getTime()) / 60000));

  const awaySince = reservation.away_since ? new Date(reservation.away_since) : null;
  const away = awaySince ? awayMinutes(awaySince, now) : null;
  const isAway = away !== null;
  // 자동 취소까지 남은 분. 자리비움 20분이 지나면 예약이 사라진다.
  const autoCancelIn = away !== null ? Math.max(0, POLICY.awayLimitMinutes - away) : null;

  // 자리비움 횟수 제한. 한 예약에서 awayMaxCount회까지만(복귀는 세지 않음). 서버에서도 강제한다.
  // 컬럼이 아직 없을 수 있는 배포 시점을 대비해 기본값 0으로 처리한다.
  const awayLeft = Math.max(0, POLICY.awayMaxCount - (reservation.away_count ?? 0));
  const awayExhausted = !isAway && awayLeft <= 0;

  const options = extendChoices(end);
  const extendStep = POLICY.slotMinutes;
  const extendMax = options.at(-1) ?? 0; // 연장 가능한 최대 분

  function openPicker() {
    // 기본값: 60분이 가능하면 60분, 아니면 가능한 최댓값.
    setExtendMin(options.includes(60) ? 60 : extendMax);
    setPicking(true);
  }

  return (
    <div className={PANEL}>
      <div
        className={
          "shrink-0 border-b p-6 " +
          (isAway
            ? "border-amber-100 bg-gradient-to-b from-amber-50 to-white"
            : "border-neutral-100 bg-gradient-to-b from-emerald-50/60 to-white")
        }
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-5xl font-black tracking-tight text-neutral-900 tabular-nums">
            {seat?.label ?? reservation.seat_id}
          </h3>
          <span
            className={
              "shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-bold " +
              (isAway
                ? "border-amber-200 bg-amber-100 text-amber-800"
                : running
                  ? "border-emerald-200/50 bg-emerald-50 text-emerald-700"
                  : "border-neutral-200 bg-neutral-50 text-neutral-500")
            }
          >
            {isAway ? "자리비움" : running ? "이용 중" : "예약됨"}
          </span>
        </div>

        <p className="mt-3 text-[15px] font-black tabular-nums text-neutral-900">
          {fmtTime(start)} – {fmtTime(end)}
        </p>
        <p className="mt-0.5 text-xs font-bold text-neutral-400">
          {fmtDate(start)}
          {running && ` · ${fmtMinutes(minsLeft)} 남음`}
          {reservation.extended && " · 연장함"}
          {away !== null && ` · 자리비움 ${fmtMinutes(away)}`}
        </p>
      </div>

      <div className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
        {canExtend && options.length > 0 && (
          <div className="mb-6">
            {!picking ? (
              <button
                type="button"
                onClick={openPicker}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 py-4 text-sm font-bold text-white transition-all hover:bg-black hover:shadow-lg active:scale-[0.98] disabled:opacity-50"
              >
                <Timer className="h-4 w-4" />
                연장하기
              </button>
            ) : (
              <div>
                <p className="mb-2.5 text-xs font-bold text-neutral-500">
                  얼마나 더 쓰시겠어요? 10분씩, 한 번만 연장할 수 있습니다.
                </p>
                <div className="mb-2.5 flex items-center gap-2 rounded-2xl border border-neutral-200 p-1.5">
                  <button
                    type="button"
                    onClick={() => setExtendMin((m) => Math.max(extendStep, m - extendStep))}
                    disabled={busy || extendMin <= extendStep}
                    aria-label="10분 줄이기"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-700 transition-all hover:bg-neutral-200 active:scale-95 disabled:opacity-30"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <div className="flex-1 text-center">
                    <div className="text-base font-black tabular-nums text-neutral-900">
                      +{fmtMinutes(extendMin)}
                    </div>
                    <div className="text-[11px] font-bold tabular-nums text-neutral-400">
                      {fmtTime(addMinutes(end, extendMin))}까지
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExtendMin((m) => Math.min(extendMax, m + extendStep))}
                    disabled={busy || extendMin + extendStep > extendMax}
                    aria-label="10분 늘리기"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-700 transition-all hover:bg-neutral-200 active:scale-95 disabled:opacity-30"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setPicking(false)}
                    disabled={busy}
                    className="rounded-xl border border-neutral-200 py-3 text-sm font-bold text-neutral-600 transition-all hover:border-neutral-900 hover:text-neutral-900 disabled:opacity-50"
                  >
                    닫기
                  </button>
                  <button
                    type="button"
                    disabled={busy || extendMin < POLICY.slotMinutes}
                    onClick={async () => {
                      await onExtend(addMinutes(end, extendMin));
                      setPicking(false);
                    }}
                    className="rounded-xl bg-neutral-900 py-3 text-sm font-bold text-white transition-all hover:bg-black active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400"
                  >
                    연장하기
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          {running && (
            <button
              type="button"
              onClick={() => onAway(away === null)}
              disabled={busy || awayExhausted}
              className={
                away === null
                  ? `${ACTION} col-span-2`
                  : "col-span-2 flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 py-3 text-[13px] font-bold text-white transition-all hover:bg-amber-600 disabled:opacity-50"
              }
            >
              <Coffee className="h-4 w-4" />
              {away === null
                ? awayExhausted
                  ? "자리비움 횟수 소진"
                  : `자리비움 (${awayLeft}회 남음)`
                : "복귀했어요"}
            </button>
          )}
          <button type="button" onClick={onChange} disabled={busy} className={ACTION}>
            <Pencil className="h-4 w-4" />
            자리 변경
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className={
              isReturn
                ? `${ACTION} hover:border-emerald-500 hover:text-emerald-700`
                : `${ACTION} hover:border-red-500 hover:text-red-600`
            }
          >
            {isReturn ? <CircleCheck className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
            {isReturn ? "좌석 반납" : "예약 취소"}
          </button>
        </div>

        {/* 자동 취소 안내. 자리비움 중이면 남은 시간을, 아니면 남은 횟수를 안내한다. */}
        {isAway ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] font-bold leading-relaxed text-amber-800">
            자리비움 중입니다. <b>{autoCancelIn}분</b> 안에 “복귀했어요”를 누르지 않으면 예약이
            자동으로 취소되고, 이 자리는 이후 {POLICY.cooldownMinutes}분간 다시 예약할 수 없습니다.
          </p>
        ) : awayExhausted ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] font-bold leading-relaxed text-amber-800">
            자리비움 {POLICY.awayMaxCount}회를 모두 사용해 더 이상 자리를 비울 수 없습니다. 오래
            자리를 비우실 예정이라면 예약을 취소해 주세요.
          </p>
        ) : (
          <p className="mt-3 text-[11px] font-medium leading-relaxed text-neutral-400">
            자리비움은 예약당 <b className="font-bold text-neutral-600">{POLICY.awayMaxCount}회</b>
            까지 쓸 수 있어요(<b className="font-bold text-neutral-600">{awayLeft}회 남음</b>). 비운 뒤{" "}
            {POLICY.awayLimitMinutes}분 안에 “복귀했어요”를 누르지 않으면 예약이 자동으로 취소되고,
            이 자리는 이후 {POLICY.cooldownMinutes}분간 다시 예약할 수 없습니다.
          </p>
        )}

        <div className="mt-auto space-y-2 border-t border-neutral-100 pt-6 text-[11px] font-medium leading-relaxed text-neutral-500">
          {reservation.extended ? (
            <p>연장을 사용했습니다. 더 쓰시려면 종료 후 새로 예약해 주세요.</p>
          ) : canExtend && options.length === 0 ? (
            <p>
              운영 종료({POLICY.closeHour}:00)까지 시간이 없어 연장할 수 없습니다. 이후는
              자유롭게 이용하세요.
            </p>
          ) : (
            !canExtend && (
              <p>
                연장은 종료 {POLICY.extendWindowHours}시간 전인{" "}
                <strong className="font-bold text-neutral-700">{fmtTime(opensAt)}</strong>부터 할
                수 있습니다.
              </p>
            )
          )}
          <p>예약은 한 번에 한 건입니다. 지금 예약이 끝나면 바로 다시 예약할 수 있어요.</p>
        </div>
      </div>
    </div>
  );
}
