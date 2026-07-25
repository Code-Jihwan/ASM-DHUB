"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Clock, MessageSquareWarning, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { humanizeDbError } from "@/lib/errors";
import { useNow } from "@/lib/useNow";
import {
  addMinutes,
  awayMinutes,
  floorMinute,
  fmtTime,
  maxDurationMinutes,
  parseRange,
  POLICY,
  toRange,
  withinBookingHours,
} from "@/lib/policy";
import type { Occupancy, Reservation, Seat, SeatView } from "@/lib/types";
import { SeatLegend, SeatMap } from "./SeatMap";
import { ReservationPanel } from "./ReservationPanel";
import { MyReservationCard } from "./MyReservationCard";
import { ReportDialog } from "./ReportDialog";

type Props = {
  seats: Seat[];
  userId: string;
};

/** 예약 한 건을 겹침 판정에 쓰기 좋게 펼친 형태 */
type Busy = {
  seatId: number;
  userId: string;
  name: string | null;
  start: Date;
  end: Date;
  awaySince: Date | null;
};

function StatCard({
  label,
  value,
  icon: Icon,
  active = false,
  className = "",
}: {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  active?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-between rounded-[20px] border px-5 py-4 transition-all duration-300 ${
        active
          ? "border-neutral-900 bg-neutral-900 text-white shadow-lg shadow-neutral-900/10"
          : "border-neutral-200 bg-white text-neutral-900 shadow-sm hover:shadow-md"
      } ${className}`}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p
          className={`mb-0.5 text-[13px] font-bold tracking-wider ${
            active ? "text-neutral-400" : "text-neutral-500"
          }`}
        >
          {label}
        </p>
        <div className="truncate text-[22px] font-black tracking-tight">{value}</div>
      </div>
      <div
        className={`ml-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] ${
          active ? "bg-neutral-800" : "bg-neutral-50"
        }`}
      >
        <Icon className={`h-5 w-5 ${active ? "text-white" : "text-neutral-700"}`} />
      </div>
    </div>
  );
}

export function ReservePage({ seats, userId }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const now = useNow();

  const [durationMin, setDurationMin] = useState(60);
  const [selected, setSelected] = useState<number | null>(null);
  const [occupancy, setOccupancy] = useState<Occupancy[]>([]);
  const [mine, setMine] = useState<Reservation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [changing, setChanging] = useState(false);
  const [reporting, setReporting] = useState(false);
  // 이미 자동 취소한 예약 id. 갱신 전 중복 호출을 막는다.
  const autoCancelledRef = useRef<Set<string>>(new Set());

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // 예약 시작은 늘 "지금 이 분". 최대 이용 시간(2h) 앞의 예약만 알면 충분하다.
  const startBase = now ? floorMinute(now) : null;
  const winTo = startBase ? addMinutes(startBase, POLICY.maxBaseHours * 60) : null;

  // now는 30초마다 새 객체가 되지만 창의 경계는 1분에 한 번만 움직인다.
  // 시각 값으로 의존성을 잡아 불필요한 재조회를 막는다.
  const fromMs = startBase?.getTime() ?? 0;
  const toMs = winTo?.getTime() ?? 0;

  // 지금부터 2시간 안의 예약을 한 번에 받아 좌석도·이용시간 계산에 함께 쓴다.
  useEffect(() => {
    if (!fromMs || !toMs) return;
    let cancelled = false;
    supabase
      .from("seat_occupancy")
      .select("seat_id, user_id, reserver_name, away_since, period, reservation_id, extended")
      .overlaps("period", toRange(new Date(fromMs), new Date(toMs)))
      .then(({ data }) => {
        if (!cancelled) setOccupancy((data ?? []) as Occupancy[]);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, fromMs, toMs, refreshKey]);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("reservation")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (cancelled) return;
        const live = (data ?? []).find((r) => parseRange(r.period as string).end > new Date());
        setMine((live as Reservation) ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, userId, refreshKey]);

  useEffect(() => {
    const ch = supabase
      .channel("reservation-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "reservation" }, refresh)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [supabase, refresh]);

  const rows: Busy[] = useMemo(
    () =>
      occupancy.map((o) => {
        const { start: s, end: e } = parseRange(o.period);
        return {
          seatId: o.seat_id,
          userId: o.user_id,
          name: o.reserver_name,
          start: s,
          end: e,
          awaySince: o.away_since ? new Date(o.away_since) : null,
        };
      }),
    [occupancy],
  );

  const hasLive = mine !== null;
  const booking = !hasLive || changing;

  /**
   * 한 좌석에서 지금부터 예약 가능한 최대 이용 시간(분).
   * 지금 점유 중이면 occupiedNow=true(예약 불가), 아니면 다음 예약 시작·정책 상한 중 작은 값.
   */
  const seatCap = useCallback(
    (seatId: number | null): { occupiedNow: boolean; maxMin: number } => {
      if (!startBase || !now) return { occupiedNow: false, maxMin: 0 };
      const policyMax = maxDurationMinutes(startBase);
      if (seatId === null) return { occupiedNow: false, maxMin: policyMax };

      // 변경 중이라면 내 기존 예약은 장애물이 아니다. DB도 한 트랜잭션에서 비켜준다.
      const seatRows = rows.filter(
        (r) => r.seatId === seatId && !(changing && r.userId === userId),
      );
      const t = now.getTime();
      if (seatRows.some((r) => r.start.getTime() <= t && r.end.getTime() > t)) {
        return { occupiedNow: true, maxMin: 0 };
      }
      const next = seatRows
        .filter((r) => r.start.getTime() > startBase.getTime())
        .sort((a, b) => a.start.getTime() - b.start.getTime())[0];
      let cap = policyMax;
      if (next) {
        const untilNext =
          Math.floor((next.start.getTime() - startBase.getTime()) / 60000 / POLICY.slotMinutes) *
          POLICY.slotMinutes;
        cap = Math.min(cap, untilNext);
      }
      return { occupiedNow: false, maxMin: cap };
    },
    [startBase, now, rows, changing, userId],
  );

  const { occupiedNow, maxMin } = seatCap(selected);
  const effectiveDuration = Math.min(durationMin, maxMin);

  // 좌석도가 비었는지 판정할 구간. 좌석을 고르면 그 이용 구간, 아니면 durationMin 기준.
  const windowLen = selected !== null ? Math.max(effectiveDuration, POLICY.slotMinutes) : durationMin;
  const mapFrom = booking ? startBase : now;
  const mapTo = booking
    ? startBase
      ? addMinutes(startBase, windowLen)
      : null
    : now
      ? addMinutes(now, 1)
      : null;

  const view: SeatView[] = useMemo(() => {
    if (!mapFrom || !mapTo) return [];
    return seats.map((s) => {
      const hit = rows.find((r) => r.seatId === s.id && r.start < mapTo && r.end > mapFrom);
      return {
        ...s,
        busy: hit !== undefined,
        mine: hit?.userId === userId,
        reserverName: hit?.name ?? null,
        awaySince: hit?.awaySince ?? null,
      };
    });
  }, [seats, rows, mapFrom, mapTo, userId]);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3000);
  };

  // 자리비움 자동 취소(클라이언트). 자리를 비운 지 awayLimit 분이 지나면 내 예약을 취소한다.
  // 앱이 닫혀 있으면 못 도므로 서버 쪽 pg_cron(0012)이 최종 안전장치다.
  useEffect(() => {
    if (!mine?.away_since || !now) return;
    if (awayMinutes(new Date(mine.away_since), now) < POLICY.awayLimitMinutes) return;
    if (autoCancelledRef.current.has(mine.id)) return;
    autoCancelledRef.current.add(mine.id);
    supabase
      .from("reservation")
      .update({ status: "cancelled" })
      .eq("id", mine.id)
      .then(({ error }) => {
        if (!error) {
          refresh();
          flash(`자리비움 ${POLICY.awayLimitMinutes}분 초과로 예약이 자동 취소되었습니다.`);
        }
      });
  }, [mine, now, supabase, refresh]);

  function chooseSeat(id: number) {
    setSelected(id);
    setError(null);
  }

  async function submit() {
    if (selected === null || effectiveDuration < POLICY.slotMinutes) return;
    setBusy(true);
    setError(null);

    // 시작은 제출 시점의 현재 분으로 다시 잡는다. 렌더 사이에 분이 넘어가면
    // 지난 시간으로 판정돼 DB가 거부하기 때문이다.
    const start = floorMinute(new Date());
    const end = addMinutes(start, effectiveDuration);

    const { error } = changing
      ? await supabase.rpc("change_reservation", {
          p_old_id: mine!.id,
          p_seat_id: selected,
          p_period: toRange(start, end),
        })
      : await supabase
          .from("reservation")
          .insert({ seat_id: selected, user_id: userId, period: toRange(start, end) });

    setBusy(false);

    if (error) {
      // 변경 실패 시 원래 예약은 DB에서 그대로 살아있다.
      setError(humanizeDbError(error));
      refresh();
      return;
    }

    const wasChanging = changing;
    setChanging(false);
    setSelected(null);
    refresh();
    flash(wasChanging ? "예약을 변경했습니다." : "예약이 완료됐습니다.");
  }

  function startChange() {
    setChanging(true);
    setSelected(null);
    setError(null);
  }

  async function extend(newEnd: Date) {
    if (!mine) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("extend_reservation", {
      p_id: mine.id,
      p_new_end: newEnd.toISOString(),
    });
    setBusy(false);

    if (error) {
      setError(humanizeDbError(error));
      refresh();
      return;
    }
    refresh();
    flash(`${fmtTime(newEnd)}까지 연장했습니다.`);
  }

  async function setAway(away: boolean) {
    if (!mine) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("set_away", { p_id: mine.id, p_away: away });
    setBusy(false);

    if (error) {
      setError(humanizeDbError(error));
      return;
    }
    refresh();
    flash(away ? "자리비움으로 표시했습니다." : "복귀로 표시했습니다.");
  }

  async function cancel() {
    if (!mine) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from("reservation")
      .update({ status: "cancelled" })
      .eq("id", mine.id);
    setBusy(false);

    if (error) {
      setError(humanizeDbError(error));
      return;
    }
    refresh();
    flash("예약을 취소했습니다.");
  }

  if (!now) {
    return (
      <div className="flex h-full flex-col gap-4 md:gap-6">
        <div className="grid shrink-0 grid-cols-2 gap-3 md:grid-cols-3 md:gap-6">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`h-[84px] animate-pulse rounded-[20px] bg-neutral-200/60 ${i === 2 ? "col-span-2 md:col-span-1" : ""}`}
            />
          ))}
        </div>
        <div className="min-h-[400px] flex-1 animate-pulse rounded-3xl bg-neutral-200/60" />
      </div>
    );
  }

  const chosen = seats.find((s) => s.id === selected);
  const freeCount = view.filter((s) => s.active && !s.busy).length;
  const mineRange = mine ? parseRange(mine.period) : null;

  // 지금이 운영 시간(08~20시) 밖이면 예약 자체를 받지 않는다. 그 외 시간은 자율 이용.
  const outsideHours = booking && !withinBookingHours(now);
  const hoursText = `예약은 ${String(POLICY.displayOpenHour).padStart(2, "0")}–${String(POLICY.displayCloseHour).padStart(2, "0")}시에만 가능합니다. 그 외 시간은 예약 없이 자유롭게 이용하세요.`;

  // 고른 좌석을 지금 예약할 수 없는 경우의 안내 문구.
  const panelLocked = outsideHours
    ? hoursText
    : selected === null
      ? null
      : occupiedNow
        ? "이 자리는 지금 사용 중입니다. 다른 자리를 골라 주세요."
        : maxMin < POLICY.slotMinutes
          ? "지금 이 자리는 남은 시간이 없습니다. 다른 자리를 고르거나 잠시 뒤 다시 시도하세요."
          : null;

  return (
    <>
      <div className="mb-4 grid shrink-0 grid-cols-2 gap-3 md:mb-6 md:grid-cols-3 md:gap-6">
        <StatCard label="총 좌석" value={seats.length} icon={Users} />
        <StatCard label="예약 가능" value={freeCount} icon={CheckCircle2} />
        <StatCard
          label="내 예약"
          className="col-span-2 md:col-span-1"
          active
          icon={Clock}
          value={
            mineRange ? (
              <div className="flex items-center gap-2.5">
                <div className="rounded-[8px] bg-white/15 px-2.5 py-1 text-[15px] font-black leading-none tabular-nums">
                  {seats.find((s) => s.id === mine!.seat_id)?.label ?? mine!.seat_id}
                </div>
                <span className="text-[20px] font-black tabular-nums">
                  {fmtTime(mineRange.start)} - {fmtTime(mineRange.end)}
                </span>
              </div>
            ) : (
              <span className="text-[20px] font-black text-neutral-500">없음</span>
            )
          }
        />
      </div>

      {changing && (
        <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-900 bg-neutral-900 px-5 py-3.5 text-white">
          <p className="text-sm font-bold">
            예약을 변경하는 중입니다. 새 자리와 시간을 고르세요.
          </p>
          <button
            type="button"
            onClick={() => {
              setChanging(false);
              setSelected(null);
            }}
            disabled={busy}
            className="shrink-0 text-sm font-bold text-neutral-400 underline underline-offset-2 hover:text-white disabled:opacity-50"
          >
            변경 취소
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mb-4 shrink-0 rounded-2xl border border-red-200 bg-red-50 px-5 py-3.5 text-sm font-bold text-red-700"
        >
          {error}
        </div>
      )}

      {outsideHours && (
        <div className="mb-4 flex shrink-0 items-center gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3.5 text-sm font-bold text-amber-800">
          <Clock className="h-4 w-4 shrink-0" />
          지금은 예약 시간이 아닙니다. {hoursText}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-4 md:gap-6 lg:flex-row">
        {/* min-w-0이 없으면 좌석도의 min-width가 섹션을 부풀려 우측 패널을 화면 밖으로 민다. */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm md:p-6">
          <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-black tracking-tight text-neutral-900">D-HUB</h2>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1.5 text-[12px] font-bold tabular-nums text-neutral-500">
                <Clock className="h-3.5 w-3.5 text-neutral-400" />
                {String(POLICY.displayOpenHour).padStart(2, "0")}:00–
                {String(POLICY.displayCloseHour).padStart(2, "0")}:00
              </span>
            </div>
            <div className="flex items-center gap-3">
              <SeatLegend />
              <button
                type="button"
                onClick={() => setReporting(true)}
                title="신고 · 의견 보내기"
                aria-label="신고 · 의견 보내기"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-500 text-white shadow-sm shadow-red-500/25 transition-all hover:bg-red-600 hover:shadow-md hover:shadow-red-500/30 active:scale-95"
              >
                <MessageSquareWarning className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="min-h-[480px] flex-1 lg:min-h-0">
            <SeatMap
              seats={view}
              selected={selected}
              onSelect={chooseSeat}
              now={now}
              disabled={busy || !booking || outsideHours}
            />
          </div>
        </section>

        {booking ? (
          <ReservationPanel
            seat={chosen}
            now={now}
            durationMin={effectiveDuration}
            maxMin={maxMin}
            onDuration={setDurationMin}
            onSubmit={submit}
            busy={busy}
            mode={changing ? "change" : "book"}
            locked={panelLocked}
          />
        ) : (
          <MyReservationCard
            reservation={mine!}
            seat={seats.find((s) => s.id === mine!.seat_id)}
            now={now}
            onExtend={extend}
            onCancel={cancel}
            onChange={startChange}
            onAway={setAway}
            busy={busy}
          />
        )}
      </div>

      {reporting && (
        <ReportDialog userId={userId} seats={seats} onClose={() => setReporting(false)} />
      )}

      {toast && (
        <div className="fixed bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-bold text-white shadow-lg md:bottom-8">
          {toast}
        </div>
      )}
    </>
  );
}
