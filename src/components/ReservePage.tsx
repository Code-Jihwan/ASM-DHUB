"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Clock,
  MessageSquareWarning,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { bookSeat, changeSeat } from "@/app/actions";
import { createClient } from "@/lib/supabase/client";
import { humanizeDbError } from "@/lib/errors";
import { useNow } from "@/lib/useNow";
import {
  addMinutes,
  awayMinutes,
  bookingStart,
  fmtTime,
  maxDurationMinutes,
  parseRange,
  POLICY,
  toRange,
} from "@/lib/policy";
import type { Occupancy, Reservation, Seat, SeatView } from "@/lib/types";
import { SeatLegend, SeatMap } from "./SeatMap";
import { OccupancyPanel, ReservationPanel } from "./ReservationPanel";
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
        <div className="truncate text-[22px] font-black tracking-tight">
          {value}
        </div>
      </div>
      <div
        className={`ml-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] ${
          active ? "bg-neutral-800" : "bg-neutral-50"
        }`}
      >
        <Icon
          className={`h-5 w-5 ${active ? "text-white" : "text-neutral-700"}`}
        />
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
  // 센터 와이파이 여부. onWifi: null=확인 중 / true=센터 / false=아님.
  // enforced: CENTER_IPS가 설정돼 제한이 켜졌는지(꺼져 있으면 상태 pill을 숨긴다).
  const [onWifi, setOnWifi] = useState<boolean | null>(null);
  const [wifiEnforced, setWifiEnforced] = useState(false);
  // 자리별 재예약 쿨다운이 끝나는 시각. seatId → until. 내가 방금 쓴 자리에만 걸린다.
  const [cooldowns, setCooldowns] = useState<Map<number, Date>>(new Map());
  // 좌석 잠금 상태(관리자가 점검용으로 잠글 수 있다). 실시간으로 반영한다.
  const [seatActive, setSeatActive] = useState<Map<number, boolean>>(
    () => new Map(seats.map((s) => [s.id, s.active])),
  );
  // 이미 자동 취소한 예약 id. 갱신 전 중복 호출을 막는다.
  const autoCancelledRef = useRef<Set<string>>(new Set());

  // 센터 와이파이(공인 IP)인지 서버에 물어 화면에 반영한다. 창에 다시 돌아올 때도 갱신.
  const checkWifi = useCallback(() => {
    fetch("/api/wifi", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        setOnWifi(Boolean(j.allowed));
        setWifiEnforced(Boolean(j.enforced));
      })
      .catch(() => setOnWifi(null));
  }, []);

  useEffect(() => {
    checkWifi();
    const onFocus = () => checkWifi();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [checkWifi]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // 예약 시작은 늘 "지금 이 분". 최대 이용 시간(2h) 앞의 예약만 알면 충분하다.
  const startBase = now ? bookingStart(now) : null;
  const winTo = startBase
    ? addMinutes(startBase, POLICY.maxBaseHours * 60)
    : null;

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
      .select(
        "seat_id, user_id, reserver_name, away_since, period, reservation_id, extended",
      )
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
      .order("created_at", { ascending: false })
      .limit(40)
      .then(({ data }) => {
        if (cancelled) return;
        const rows = (data ?? []) as Reservation[];
        const nowT = Date.now();
        // 지금 살아있는 내 예약(취소 안 됐고 아직 안 끝난 것)
        const live = rows.find(
          (r) =>
            r.status === "active" && parseRange(r.period).end.getTime() > nowT,
        );
        setMine(live ?? null);

        // 자리별 쿨다운: 내가 정상 종료했거나(연장 무관), 10분 이상 쓰고 취소한 자리.
        const cd = new Map<number, number>();
        for (const r of rows) {
          const { start, end } = parseRange(r.period);
          let ref: number | null = null;
          if (r.status === "active" && end.getTime() <= nowT) {
            ref = end.getTime(); // 정상 종료 시각
          } else if (r.status === "cancelled" && r.cancelled_at) {
            const cancelledAt = new Date(r.cancelled_at).getTime();
            if (
              cancelledAt - start.getTime() >=
              POLICY.cancelGraceMinutes * 60_000
            ) {
              ref = cancelledAt; // 10분 이상 점유 후 취소 → 취소 시점 기준
            }
          }
          if (ref === null) continue;
          const until = ref + POLICY.cooldownMinutes * 60_000;
          if (until > nowT)
            cd.set(r.seat_id, Math.max(cd.get(r.seat_id) ?? 0, until));
        }
        setCooldowns(
          new Map([...cd].map(([seat, until]) => [seat, new Date(until)])),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, userId, refreshKey]);

  // 좌석 잠금 상태를 받아 온다. 관리자가 점검용으로 잠그면 여기로 반영된다.
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("seat")
      .select("id, active")
      .then(({ data }) => {
        if (cancelled || !data) return;
        setSeatActive(
          new Map(data.map((r) => [r.id as number, r.active as boolean])),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, refreshKey]);

  useEffect(() => {
    const ch = supabase
      .channel("reservation-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reservation" },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "seat" },
        refresh,
      )
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
          Math.floor(
            (next.start.getTime() - startBase.getTime()) /
              60000 /
              POLICY.slotMinutes,
          ) * POLICY.slotMinutes;
        cap = Math.min(cap, untilNext);
      }
      return { occupiedNow: false, maxMin: cap };
    },
    [startBase, now, rows, changing, userId],
  );

  const { occupiedNow, maxMin } = seatCap(selected);
  const effectiveDuration = Math.min(durationMin, maxMin);

  // 사용 중인 좌석을 눌렀을 때 우측에 띄울 예약 정보(지금 그 자리를 덮고 있는 예약).
  const coveringRow =
    selected !== null && now
      ? rows.find(
          (r) =>
            r.seatId === selected &&
            r.start.getTime() <= now.getTime() &&
            r.end.getTime() > now.getTime(),
        )
      : undefined;

  // 자리 변경 중이면 기존 예약의 이용 구간. 그 시간에 빈 자리만 옮길 수 있다.
  const moveRange = changing && mine ? parseRange(mine.period) : null;

  // 좌석도가 비었는지 판정할 구간. 좌석을 고르면 그 이용 구간, 아니면 durationMin 기준.
  const windowLen =
    selected !== null
      ? Math.max(effectiveDuration, POLICY.slotMinutes)
      : durationMin;
  // 운영시간(08~20시) 밖이면 startBase가 null이지만, 좌석도는 계속 그려야 하므로
  // now를 기준 창으로 쓴다(예약은 어차피 disabled로 막힌다). 좌석만 보이고 클릭만 안 된다.
  const winBase = startBase ?? now;
  const mapFrom = moveRange ? moveRange.start : booking ? winBase : now;
  const mapTo = moveRange
    ? moveRange.end
    : booking
      ? winBase
        ? addMinutes(winBase, windowLen)
        : null
      : now
        ? addMinutes(now, 1)
        : null;

  const view: SeatView[] = useMemo(() => {
    if (!mapFrom || !mapTo) return [];
    return seats.map((s) => {
      const hit = rows.find(
        (r) => r.seatId === s.id && r.start < mapTo && r.end > mapFrom,
      );
      return {
        ...s,
        active: seatActive.get(s.id) ?? s.active,
        busy: hit !== undefined,
        mine: hit?.userId === userId,
        reserverName: hit?.name ?? null,
        awaySince: hit?.awaySince ?? null,
      };
    });
  }, [seats, rows, mapFrom, mapTo, userId, seatActive]);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3000);
  };

  // 자리비움 자동 취소(클라이언트). 자리를 비운 지 awayLimit 분이 지나면 내 예약을 취소한다.
  // 앱이 닫혀 있으면 못 도므로 서버 쪽 pg_cron(0012)이 최종 안전장치다.
  useEffect(() => {
    if (!mine?.away_since || !now) return;
    if (awayMinutes(new Date(mine.away_since), now) < POLICY.awayLimitMinutes)
      return;
    if (autoCancelledRef.current.has(mine.id)) return;
    autoCancelledRef.current.add(mine.id);
    supabase
      .from("reservation")
      .update({ status: "cancelled" })
      .eq("id", mine.id)
      .then(({ error }) => {
        if (!error) {
          refresh();
          flash(
            `자리비움 ${POLICY.awayLimitMinutes}분 초과로 예약이 자동 취소되었습니다. 이 자리는 ${POLICY.cooldownMinutes}분간 다시 예약할 수 없어요.`,
          );
        }
      });
  }, [mine, now, supabase, refresh]);

  function chooseSeat(id: number) {
    setSelected(id);
    setError(null);
  }

  async function submit() {
    if (selected === null) return;
    setBusy(true);
    setError(null);

    let error: string | undefined;
    if (changing) {
      // 자리 변경은 이용 시간을 그대로 둔 채 자리만 옮긴다(시간 재계산 없음).
      ({ error } = await changeSeat(mine!.id, selected));
    } else {
      if (effectiveDuration < POLICY.slotMinutes) {
        setBusy(false);
        return;
      }
      // 시작은 제출 시점 기준으로 다시 잡는다(렌더 사이 분이 넘어가면 지난 시간으로 거부됨).
      // 오픈 직전 유예 시간이면 08:00으로 당겨진다.
      const start = bookingStart(new Date());
      if (!start) {
        setBusy(false);
        setError("지금은 예약할 수 있는 시간이 아닙니다.");
        return;
      }
      const end = addMinutes(start, effectiveDuration);
      // 센터 와이파이 강제는 이 서버 액션 안에서 IP로 재검사한다(클라이언트 우회 방지).
      ({ error } = await bookSeat(selected, toRange(start, end)));
    }

    setBusy(false);

    if (error) {
      // 변경 실패 시 원래 예약은 DB에서 그대로 살아있다.
      setError(error);
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
    const { error } = await supabase.rpc("set_away", {
      p_id: mine.id,
      p_away: away,
    });
    setBusy(false);

    if (error) {
      setError(humanizeDbError(error));
      return;
    }
    refresh();
    flash(
      away
        ? `자리비움으로 표시했습니다. ${POLICY.awayLimitMinutes}분 안에 복귀하지 않으면 예약이 취소되고, 이 자리는 이후 ${POLICY.cooldownMinutes}분간 예약할 수 없어요.`
        : "복귀로 표시했습니다.",
    );
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

  // 센터 와이파이가 아니면 예약을 막는다(서버에서도 강제). 확인 중(null)엔 막지 않는다.
  const wifiBlocked = booking && onWifi === false;
  const wifiText =
    "센터 와이파이에 연결한 뒤 예약할 수 있습니다. 와이파이를 연결하고 다시 확인해 주세요.";

  // 지금이 운영 시간(08~20시) 밖이면 예약 자체를 받지 않는다. 그 외 시간은 자율 이용.
  // 자리 변경은 시간을 바꾸지 않으므로 운영 시간 잠금을 적용하지 않는다.
  const outsideHours = booking && !changing && startBase === null;
  const hoursText = `예약은 ${String(POLICY.displayOpenHour).padStart(2, "0")}–${String(POLICY.displayCloseHour).padStart(2, "0")}시에만 가능합니다. 그 외 시간은 예약 없이 자유롭게 이용하세요.`;

  const blocked = wifiBlocked || outsideHours;

  // 자리별 쿨다운: 고른 자리가 내가 방금 쓴 자리라면 그 자리에만 쿨다운이 걸린다(다른 자리는 즉시 가능).
  const selectedCooldown =
    selected !== null ? (cooldowns.get(selected) ?? null) : null;
  const seatCooldownActive =
    selectedCooldown !== null && now < selectedCooldown;

  // 고른 좌석을 지금 예약할 수 없는 경우의 안내 문구.
  // 자리 변경은 시간을 바꾸지 않으므로 시간 관련 잠금(운영시간·쿨다운 등)은 적용하지 않는다.
  const panelLocked = wifiBlocked
    ? wifiText
    : changing
      ? null
      : outsideHours
        ? hoursText
        : selected === null
          ? null
          : seatCooldownActive
            ? `방금 이용한 자리예요. ${fmtTime(selectedCooldown!)}부터 다시 예약할 수 있습니다. 다른 자리는 지금 바로 가능해요.`
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
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-baseline gap-0.5 rounded-[10px] bg-white/15 px-2.5 py-1.5 leading-none tabular-nums">
                  <span className="text-[16px] font-black">
                    {seats.find((s) => s.id === mine!.seat_id)?.label ??
                      mine!.seat_id}
                  </span>
                  <span className="text-[11px] font-bold text-white/60">
                    번
                  </span>
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-[10px] bg-white/10 px-3 py-1.5 text-[17px] font-black leading-none tabular-nums">
                  {fmtTime(mineRange.start)}
                  <span className="text-white/40">–</span>
                  {fmtTime(mineRange.end)}
                </span>
              </div>
            ) : (
              <span className="text-[20px] font-black text-neutral-500">
                없음
              </span>
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

      {wifiBlocked && (
        <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-3.5 text-sm font-bold text-red-700">
          <span className="flex items-center gap-2.5">
            <Wifi className="h-4 w-4 shrink-0" />
            {wifiText}
          </span>
          <button
            type="button"
            onClick={checkWifi}
            className="shrink-0 rounded-xl border border-red-300 bg-white px-3 py-1.5 text-xs font-bold text-red-600 transition-all hover:bg-red-100"
          >
            다시 확인
          </button>
        </div>
      )}

      {!wifiBlocked && outsideHours && (
        <div className="mb-4 flex shrink-0 items-center gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3.5 text-sm font-bold text-amber-800">
          <Clock className="h-4 w-4 shrink-0" />
          지금은 예약 시간이 아닙니다. {hoursText}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-4 md:gap-6 lg:flex-row">
        {/* min-w-0이 없으면 좌석도의 min-width가 섹션을 부풀려 우측 패널을 화면 밖으로 민다. */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm md:p-6">
          <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3 sm:flex-nowrap">
            <div className="flex shrink-0 items-center gap-2.5">
              <h2 className="text-2xl font-black tracking-tight text-neutral-900">
                D-HUB
              </h2>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1.5 text-[12px] font-bold tabular-nums text-neutral-500">
                <Clock className="h-3.5 w-3.5 text-neutral-400" />
                {String(POLICY.displayOpenHour).padStart(2, "0")}:00–
                {String(POLICY.displayCloseHour).padStart(2, "0")}:00
              </span>
              {/* 센터 와이파이 상태. 제한이 켜져 있을 때(CENTER_IPS 설정)만 보인다. */}
              {wifiEnforced &&
                (onWifi === false ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1.5 text-[12px] font-bold text-red-600">
                    <WifiOff className="h-3.5 w-3.5" />
                    센터 밖
                  </span>
                ) : onWifi ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[12px] font-bold text-emerald-700">
                    <Wifi className="h-3.5 w-3.5" />
                    센터 와이파이
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1.5 text-[12px] font-bold text-neutral-400">
                    <Wifi className="h-3.5 w-3.5" />
                    확인 중
                  </span>
                ))}
            </div>
            <div className="flex min-w-0 items-center gap-2.5">
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
              disabled={busy || !booking || blocked}
            />
          </div>
        </section>

        {!booking ? (
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
        ) : chosen && coveringRow ? (
          <OccupancyPanel
            seat={chosen}
            name={coveringRow.name}
            start={coveringRow.start}
            end={coveringRow.end}
            awayMin={
              coveringRow.awaySince
                ? awayMinutes(coveringRow.awaySince, now)
                : null
            }
            now={now}
          />
        ) : (
          <ReservationPanel
            seat={chosen}
            now={now}
            durationMin={effectiveDuration}
            maxMin={maxMin}
            onDuration={setDurationMin}
            onSubmit={submit}
            busy={busy}
            mode={changing ? "change" : "book"}
            moveStart={moveRange?.start}
            moveEnd={moveRange?.end}
            locked={panelLocked}
          />
        )}
      </div>

      {reporting && (
        <ReportDialog
          userId={userId}
          seats={seats}
          onClose={() => setReporting(false)}
        />
      )}

      {toast && (
        <div className="fixed bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-bold text-white shadow-lg md:bottom-8">
          {toast}
        </div>
      )}
    </>
  );
}
