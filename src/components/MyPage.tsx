"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageSquareWarning } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useNow } from "@/lib/useNow";
import { fmtDate, fmtMinutes, fmtTime, parseRange } from "@/lib/policy";
import type { Reservation, Seat } from "@/lib/types";
import { ReportDialog } from "./ReportDialog";

type Props = {
  seats: Seat[];
  userId: string;
  name: string;
  team: string;
  email: string;
};

const CARD = "rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm md:p-6";
const EMPTY =
  "rounded-2xl border border-dashed border-neutral-200 px-4 py-10 text-center text-sm font-bold text-neutral-400";

/** 예약 한 건을 지금 기준으로 분류한다. */
function bucketOf(r: Reservation, now: Date) {
  const { start, end } = parseRange(r.period);
  if (r.status === "cancelled") return "cancelled" as const;
  if (end <= now) return "past" as const;
  if (start <= now) return "current" as const;
  return "upcoming" as const;
}

const BUCKET = {
  current: { label: "이용 중", style: "border-emerald-200 bg-emerald-50" },
  upcoming: { label: "예정", style: "border-neutral-900/10 bg-neutral-50" },
  past: { label: "지난 이용", style: "border-neutral-200 bg-white" },
  cancelled: { label: "취소됨", style: "border-neutral-100 bg-neutral-50/60" },
} as const;

export function MyPage({ seats, userId, name, team, email }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const now = useNow();

  const [rows, setRows] = useState<Reservation[] | null>(null);
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("reservation")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30)
      .then(({ data }) => {
        if (!cancelled) setRows((data ?? []) as Reservation[]);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, userId]);

  const labelOf = (seatId: number) =>
    seats.find((s) => s.id === seatId)?.label ?? String(seatId);

  // 취소하지 않은 예약의 실제 경과 시간(분). 취소한 예약은 이용으로 치지 않는다.
  const usedMinutes =
    rows && now
      ? rows
          .filter((r) => r.status === "active" && parseRange(r.period).start <= now)
          .reduce((sum, r) => {
            const { start, end } = parseRange(r.period);
            return sum + (Math.min(end.getTime(), now.getTime()) - start.getTime()) / 60_000;
          }, 0)
      : 0;

  return (
    <div className="flex flex-col gap-5 md:gap-6">
      <header>
        <h1 className="text-[28px] font-black tracking-tighter text-neutral-900">마이페이지</h1>
        <p className="mt-1 text-sm font-bold text-neutral-500">
          등록한 정보와 지금까지의 이용 내역입니다.
        </p>
      </header>

      <div className="grid gap-5 md:gap-6 lg:grid-cols-[340px_1fr]">
        <section className={`${CARD} h-fit`}>
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[20px] bg-neutral-900 text-2xl font-black text-white">
              {name.slice(0, 1)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xl font-black tracking-tight text-neutral-900">
                {name}
              </p>
              <p className="truncate text-sm font-bold text-neutral-500">{team}</p>
            </div>
          </div>

          <dl className="mt-6 flex flex-col gap-3 border-t border-neutral-100 pt-5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="font-bold text-neutral-400">계정</dt>
              <dd className="truncate font-bold text-neutral-700">{email}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="font-bold text-neutral-400">누적 이용</dt>
              <dd className="font-black tabular-nums text-neutral-900">
                {rows === null ? "—" : fmtMinutes(Math.round(usedMinutes))}
              </dd>
            </div>
          </dl>

          <p className="mt-3 text-[11px] font-medium leading-relaxed text-neutral-400">
            취소한 예약은 이용 시간에 포함되지 않습니다.
          </p>

          <p className="mt-4 border-t border-neutral-100 pt-4 text-[11px] font-medium leading-relaxed text-neutral-400">
            이름과 팀을 바꾸려면 운영자에게 알려 주세요.
          </p>

          <button
            type="button"
            onClick={() => setReporting(true)}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-neutral-200 py-3.5 text-[13px] font-bold text-neutral-600 transition-all hover:border-neutral-900 hover:text-neutral-900"
          >
            <MessageSquareWarning className="h-4 w-4" />
            신고 · 의견 보내기
          </button>
        </section>

        <section className={CARD}>
          <h2 className="mb-4 text-lg font-black tracking-tight text-neutral-900">이용 내역</h2>

          {rows === null || !now ? (
            <div className="h-24 animate-pulse rounded-2xl bg-neutral-100" />
          ) : rows.length === 0 ? (
            <p className={EMPTY}>아직 예약한 기록이 없습니다.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {rows.map((r) => {
                const { start, end } = parseRange(r.period);
                const b = BUCKET[bucketOf(r, now)];
                return (
                  <li key={r.id} className={`rounded-2xl border p-4 ${b.style}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-bold tracking-wider text-neutral-500">
                        {b.label}
                      </span>
                      {r.extended && (
                        <span className="rounded-md bg-neutral-200 px-1.5 py-0.5 text-[10px] font-bold text-neutral-700">
                          연장함
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[15px] font-black text-neutral-900 tabular-nums">
                      {labelOf(r.seat_id)}번 자리
                    </p>
                    <p className="text-[13px] font-bold tabular-nums text-neutral-500">
                      {fmtDate(start)} {fmtTime(start)} – {fmtTime(end)}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {reporting && (
        <ReportDialog userId={userId} seats={seats} onClose={() => setReporting(false)} />
      )}
    </div>
  );
}
