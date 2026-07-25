"use client";

import { awayMinutes } from "@/lib/policy";
import type { SeatView } from "@/lib/types";

type Props = {
  seats: SeatView[];
  selected: number | null;
  onSelect: (id: number) => void;
  now: Date;
  disabled?: boolean;
  /** 관리자 화면에서는 예약 여부와 무관하게 모든 좌석을 누를 수 있다. */
  anySelectable?: boolean;
};

/** 한 줄 8석이 3 / 2 / 3 으로 갈리고 그 사이가 통로다. 통로 폭을 좁게 준다. */
const COLS = "repeat(3, 1fr) 0.45fr repeat(2, 1fr) 0.45fr repeat(3, 1fr)";
const SLOTS = [1, 2, 3, null, 4, 5, null, 6, 7, 8] as const;
const BLOCKS = [1, 2, 3];
const ROWS = [1, 2];

/**
 * 높이는 남는 공간을 나눠 갖는다(h-full). 화면이 아주 낮을 때만 min-h가 걸려
 * 좌석도 안쪽이 스크롤된다 — 글자가 뭉개지는 것보다 낫다.
 */
const TILE =
  "flex h-full min-h-[52px] flex-col items-center justify-center gap-1 rounded-[16px] border " +
  "px-1.5 text-center shadow-sm transition-all duration-200 ease-out";

function tileClass(s: SeatView, selected: boolean, clickable: boolean, away: boolean) {
  if (!s.active) {
    return `${TILE} cursor-not-allowed border-dashed border-neutral-200 bg-neutral-50 text-neutral-300`;
  }
  if (selected) {
    return `${TILE} z-10 scale-105 border-neutral-900 bg-neutral-900 text-white shadow-lg ring-2 ring-neutral-900/10`;
  }
  if (s.mine) {
    return `${TILE} cursor-default border-emerald-600 bg-emerald-600 text-white shadow-md`;
  }
  // 자리비움이면 시간과 무관하게 주황색. 남이 볼 때 "잠깐 비운 자리"임을 바로 알린다.
  if (away) {
    return `${TILE} cursor-not-allowed border-amber-400 bg-amber-100 text-amber-900`;
  }
  // 남이 사용 중인 자리. 못 앉는 자리임이 바로 보이게 소프트 레드로 칠한다.
  if (s.busy) {
    return `${TILE} cursor-not-allowed border-rose-200 bg-rose-100 text-rose-700`;
  }
  return (
    `${TILE} border-neutral-300 bg-white text-neutral-700 ` +
    (clickable
      ? "cursor-pointer hover:border-neutral-900 hover:text-neutral-900 hover:shadow-md"
      : "cursor-not-allowed opacity-60")
  );
}

export function SeatMap({
  seats,
  selected,
  onSelect,
  now,
  disabled,
  anySelectable,
}: Props) {
  const at = (block: number, row: number, col: number) =>
    seats.find((s) => s.block === block && s.seat_row === row && s.seat_col === col);

  return (
    <div className="scroll-thin h-full overflow-auto rounded-[24px] border border-neutral-200/60 bg-floor p-3 md:p-4">
      {/* 이름을 넣으려면 좌석이 어느 정도 커야 해서, 좁은 화면에서는 가로로 스크롤된다 */}
      <div className="mx-auto flex h-full min-w-[560px] max-w-6xl flex-col gap-3">
        {/* 창가 표시 */}
        <div className="flex shrink-0 items-center gap-4 px-2">
          <div className="h-[3px] flex-1 rounded-full bg-gradient-to-r from-transparent to-sky-200/70" />
          <span className="text-[13px] font-bold tracking-widest text-sky-500">창가</span>
          <div className="h-[3px] flex-1 rounded-full bg-gradient-to-l from-transparent to-sky-200/70" />
        </div>

        {/*
          남는 높이를 3개 블록이 나눠 갖는다. 그래야 화면 높이가 달라도 스크롤이 안 생긴다.
          블록 사이(gap-5)를 줄 사이(gap-2)보다 넓게 벌려 통로가 눈에 들어오게 한다.
        */}
        <div className="flex min-h-0 flex-1 flex-col gap-5">
          {BLOCKS.map((block) => (
            // 두 줄은 등을 맞댄 책상이라 붙여서 그린다.
            <div key={block} className="flex min-h-0 flex-1 flex-col gap-2">
              {ROWS.map((row) => (
                <div
                  key={row}
                  className="grid min-h-0 flex-1 gap-2"
                  style={{ gridTemplateColumns: COLS }}
                >
                  {SLOTS.map((col, i) => {
                    if (col === null) return <div key={`gap-${i}`} aria-hidden />;

                    const s = at(block, row, col);
                    if (!s) return <div key={`empty-${i}`} aria-hidden />;

                    const away = s.awaySince ? awayMinutes(s.awaySince, now) : null;
                    const isAway = away !== null;
                    const isSelected = selected === s.id;
                    const clickable =
                      s.active && !disabled && (anySelectable || (!s.busy && !s.mine));

                    const state = !s.active
                      ? "사용 불가"
                      : s.mine
                        ? "내 예약"
                        : s.busy
                          ? `${s.reserverName ?? "예약됨"}${away !== null ? ", 자리비움" : ""}`
                          : "예약 가능";

                    return (
                      <button
                        key={s.id}
                        type="button"
                        disabled={!clickable}
                        aria-pressed={isSelected}
                        aria-label={`${s.label}번 좌석 ${state}`}
                        onClick={() => clickable && onSelect(s.id)}
                        className={tileClass(s, isSelected, clickable, isAway)}
                      >
                        <span className="text-[19px] font-black leading-none tabular-nums">
                          {s.label}
                        </span>

                        {s.reserverName && (
                          <span
                            className={
                              "max-w-full truncate text-[13px] font-bold leading-none " +
                              (isSelected || s.mine
                                ? "text-white/80"
                                : isAway
                                  ? "text-amber-800"
                                  : "text-rose-700")
                            }
                          >
                            {s.reserverName}
                          </span>
                        )}

                        {away !== null && (
                          <span
                            className={
                              "max-w-full truncate text-[9px] font-bold leading-none " +
                              (isSelected || s.mine ? "text-white/70" : "text-amber-700")
                            }
                          >
                            자리비움 {away}분
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const LEGEND = [
  { c: "border-neutral-300 bg-white shadow-sm", t: "예약 가능" },
  { c: "border-rose-200 bg-rose-100", t: "사용 중" },
  { c: "border-amber-400 bg-amber-100", t: "자리비움" },
  { c: "border-emerald-600 bg-emerald-600", t: "내 예약" },
  { c: "border-neutral-900 bg-neutral-900 shadow-md", t: "선택됨" },
];

export function SeatLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-neutral-100 bg-neutral-50 px-4 py-2.5 text-[11px] font-bold text-neutral-500">
      {LEGEND.map((i) => (
        <span key={i.t} className="flex items-center gap-2">
          <span className={`h-3 w-3 shrink-0 rounded border ${i.c}`} />
          {i.t}
        </span>
      ))}
    </div>
  );
}
