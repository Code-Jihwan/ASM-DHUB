"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Armchair,
  CheckCircle2,
  ChevronLeft,
  MessageSquare,
  Search,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { humanizeDbError } from "@/lib/errors";
import { serverEpochMs } from "@/lib/useNow";
import type { Seat } from "@/lib/types";

type Props = {
  userId: string;
  seats: Seat[];
  onClose: () => void;
};

type Kind = "occupancy" | "facility" | "other";

/** 지금 그 좌석에 앉아 있는 사람. 신고 시점 스냅샷으로 report에 박아 둔다. */
type Occupant = { name: string; userId: string; reservationId: string };

const CATEGORIES: {
  kind: Kind;
  icon: LucideIcon;
  title: string;
  desc: string;
}[] = [
  {
    kind: "occupancy",
    icon: Armchair,
    title: "자리 이용 신고",
    desc: "예약했는데 안 비켜요 · 오래 비웠어요 · 무단 사용",
  },
  {
    kind: "facility",
    icon: Wrench,
    title: "좌석 · 시설 고장",
    desc: "모니터, 의자, 콘센트 등 고장",
  },
  {
    kind: "other",
    icon: MessageSquare,
    title: "기타 의견",
    desc: "좌석과 무관한 건의 · 개선 의견",
  },
];

/** 자리 이용 신고에서 사유를 빠르게 채우는 칩 */
const OCCUPANCY_REASONS = [
  "예약 시간이 끝났는데 자리를 비우지 않습니다.",
  "자리를 오래 비워 둔 채 돌아오지 않습니다.",
  "예약 없이 자리를 사용하고 있습니다.",
];

const FIELD =
  "w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm font-medium " +
  "text-neutral-900 outline-none transition-all placeholder:text-neutral-300 " +
  "focus:border-neutral-900 focus:shadow-sm";

export function ReportDialog({ userId, seats, onClose }: Props) {
  const supabase = useMemo(() => createClient(), []);

  const [kind, setKind] = useState<Kind | null>(null);
  const [seatId, setSeatId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [occupancy, setOccupancy] = useState<Map<number, Occupant>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // 사용 중인 좌석과 그 예약자. 자리 이용 신고에서 대상을 지목하는 데 쓴다.
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("seat_occupancy")
      .select("seat_id, reserver_name, user_id, reservation_id, period")
      .then(({ data }) => {
        if (cancelled) return;
        const now = serverEpochMs();
        const map = new Map<number, Occupant>();
        for (const o of data ?? []) {
          // 지금 실제로 앉아 있는(시작~종료 사이) 예약만. 미래 예약은 제외.
          const raw = String(o.period);
          const startStr = raw.slice(1).split(",")[0].replace(/"/g, "");
          const start = new Date(startStr).getTime();
          if (start <= now && !map.has(o.seat_id as number)) {
            map.set(o.seat_id as number, {
              name: (o.reserver_name as string) ?? "예약자",
              userId: o.user_id as string,
              reservationId: o.reservation_id as string,
            });
          }
        }
        setOccupancy(map);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const needsSeat = kind === "occupancy" || kind === "facility";

  // 좌석 목록. 자리 이용 신고는 사용 중인 좌석을 위로 올린다.
  const seatList = useMemo(() => {
    const q = query.trim();
    let list = seats.filter((s) => !q || s.label.includes(q) || String(s.id).includes(q));
    if (kind === "occupancy") {
      list = [...list].sort((a, b) => {
        const oa = occupancy.has(a.id) ? 0 : 1;
        const ob = occupancy.has(b.id) ? 0 : 1;
        return oa - ob || a.id - b.id;
      });
    }
    return list;
  }, [seats, query, kind, occupancy]);

  const selectedSeat = seats.find((s) => s.id === seatId);
  const canSubmit =
    message.trim().length > 0 && (!needsSeat || seatId !== null) && !busy;

  function chooseKind(k: Kind) {
    setKind(k);
    setSeatId(null);
    setQuery("");
    setMessage("");
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !kind) return;

    setBusy(true);
    setError(null);

    const occ = kind === "occupancy" && seatId !== null ? occupancy.get(seatId) : undefined;

    const { error } = await supabase.from("report").insert({
      reporter_id: userId,
      kind,
      seat_id: needsSeat ? seatId : null,
      message: message.trim(),
      reported_user_id: occ?.userId ?? null,
      reported_name: occ?.name ?? null,
      reservation_id: occ?.reservationId ?? null,
    });

    setBusy(false);
    if (error) {
      setError(humanizeDbError(error));
      return;
    }
    setDone(true);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-neutral-900/40 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-title"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-xl">
        {done ? (
          <div className="p-6 text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[20px] border border-emerald-100 bg-emerald-50">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            </div>
            <h2 id="report-title" className="text-xl font-black text-neutral-900">
              접수했습니다
            </h2>
            <p className="mt-2 text-sm font-medium text-neutral-500">
              보내주신 내용은 운영자가 확인합니다. 감사합니다.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-6 w-full rounded-xl bg-neutral-900 py-4 text-sm font-bold text-white transition-all hover:bg-black active:scale-[0.98]"
            >
              닫기
            </button>
          </div>
        ) : (
          <>
            {/* 헤더 */}
            <div className="flex items-center gap-2 border-b border-neutral-100 px-6 py-5">
              {kind && (
                <button
                  type="button"
                  onClick={() => setKind(null)}
                  aria-label="유형 다시 선택"
                  className="-ml-2 flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
              )}
              <div>
                <h2 id="report-title" className="text-lg font-black tracking-tight text-neutral-900">
                  신고 · 의견 보내기
                </h2>
                {!kind && (
                  <p className="mt-0.5 text-[13px] font-medium text-neutral-500">
                    어떤 내용인지 먼저 골라 주세요.
                  </p>
                )}
              </div>
            </div>

            {/* 1단계: 유형 선택 */}
            {!kind ? (
              <div className="flex flex-col gap-2.5 overflow-y-auto p-6">
                {CATEGORIES.map(({ kind: k, icon: Icon, title, desc }) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => chooseKind(k)}
                    className="flex items-center gap-4 rounded-2xl border border-neutral-200 p-4 text-left transition-all hover:border-neutral-900 hover:shadow-sm active:scale-[0.99]"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-700">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-neutral-900">{title}</span>
                      <span className="mt-0.5 block text-[12px] font-medium leading-snug text-neutral-500">
                        {desc}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              /* 2단계: 대상 + 사유 */
              <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
                <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5">
                  {needsSeat && (
                    <>
                      <label className="mb-2 block text-xs font-bold text-neutral-500">
                        {kind === "occupancy" ? "어느 자리인가요?" : "고장난 좌석"}
                        {selectedSeat && (
                          <span className="ml-1.5 font-black text-neutral-900">
                            {selectedSeat.label}번 선택됨
                          </span>
                        )}
                      </label>

                      <div className="relative mb-2">
                        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-300" />
                        <input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="좌석 번호 검색"
                          inputMode="numeric"
                          className={`${FIELD} pl-10`}
                        />
                      </div>

                      <div className="scroll-thin max-h-52 overflow-y-auto rounded-xl border border-neutral-100">
                        {seatList.length === 0 ? (
                          <p className="px-4 py-6 text-center text-sm font-medium text-neutral-400">
                            해당 좌석이 없습니다.
                          </p>
                        ) : (
                          <ul className="divide-y divide-neutral-100">
                            {seatList.map((s) => {
                              const occ = occupancy.get(s.id);
                              const active = seatId === s.id;
                              return (
                                <li key={s.id}>
                                  <button
                                    type="button"
                                    onClick={() => setSeatId(s.id)}
                                    className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors ${
                                      active ? "bg-neutral-900 text-white" : "hover:bg-neutral-50"
                                    }`}
                                  >
                                    <span className="flex items-center gap-2.5">
                                      <span
                                        className={`text-sm font-black tabular-nums ${active ? "text-white" : "text-neutral-900"}`}
                                      >
                                        {s.label}번
                                      </span>
                                      {occ && (
                                        <span
                                          className={`text-[13px] font-bold ${active ? "text-white/80" : "text-neutral-500"}`}
                                        >
                                          {occ.name}
                                        </span>
                                      )}
                                    </span>
                                    {occ ? (
                                      <span
                                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                          active
                                            ? "bg-white/20 text-white"
                                            : "bg-amber-100 text-amber-700"
                                        }`}
                                      >
                                        사용 중
                                      </span>
                                    ) : (
                                      <span
                                        className={`shrink-0 text-[10px] font-bold ${active ? "text-white/60" : "text-neutral-300"}`}
                                      >
                                        빈자리
                                      </span>
                                    )}
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    </>
                  )}

                  {kind === "occupancy" && (
                    <div className="mt-5">
                      <p className="mb-2 text-xs font-bold text-neutral-500">사유 (눌러서 채우기)</p>
                      <div className="flex flex-col gap-1.5">
                        {OCCUPANCY_REASONS.map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => setMessage(r)}
                            className={`rounded-xl border px-3.5 py-2.5 text-left text-[13px] font-medium transition-all ${
                              message === r
                                ? "border-neutral-900 bg-neutral-50 text-neutral-900"
                                : "border-neutral-200 text-neutral-600 hover:border-neutral-400"
                            }`}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <label
                    htmlFor="report-message"
                    className="mb-2 mt-5 block text-xs font-bold text-neutral-500"
                  >
                    {kind === "other" ? "내용" : "자세한 내용 (선택)"}
                  </label>
                  <textarea
                    id="report-message"
                    required
                    rows={3}
                    maxLength={1000}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={
                      kind === "facility"
                        ? "어디가 어떻게 고장났는지 알려주세요."
                        : kind === "other"
                          ? "개선 의견이나 건의를 자유롭게 적어주세요."
                          : "상황을 더 자세히 적어주세요."
                    }
                    className={`${FIELD} resize-none`}
                  />
                  <p className="mt-1 text-right text-xs font-bold text-neutral-400 tabular-nums">
                    {message.length}/1000
                  </p>

                  {error && (
                    <p role="alert" className="mt-2 text-sm font-bold text-red-600">
                      {error}
                    </p>
                  )}
                </div>

                {/* 고정 푸터 */}
                <div className="flex gap-2.5 border-t border-neutral-100 px-6 py-4">
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 rounded-xl border border-neutral-200 py-3.5 text-sm font-bold text-neutral-600 transition-all hover:border-neutral-900 hover:text-neutral-900"
                  >
                    닫기
                  </button>
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="flex-1 rounded-xl bg-neutral-900 py-3.5 text-sm font-bold text-white transition-all hover:bg-black active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400"
                  >
                    {busy ? "보내는 중…" : "보내기"}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
