"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Lock, LockOpen, Plus, Search, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { humanizeDbError } from "@/lib/errors";
import { useNow } from "@/lib/useNow";
import { fmtDate, fmtTime, parseRange } from "@/lib/policy";
import type { Occupancy, Seat, SeatHistoryRow, SeatView } from "@/lib/types";
import { SeatLegend, SeatMap } from "./SeatMap";

type Props = { seats: Seat[]; userId: string };

type AdminUser = {
  user_id: string;
  name: string;
  team: string;
  is_admin: boolean;
  email: string;
  created_at: string;
};

type Report = {
  id: string;
  seat_id: number | null;
  message: string;
  resolved: boolean;
  created_at: string;
  kind: "occupancy" | "facility" | "other";
  reported_name: string | null;
  reporter_id: string;
};

type RosterRow = {
  id: number;
  team: string;
  name: string;
  claimed: boolean;
  claimed_email: string | null;
  claimed_at: string | null;
};

const REPORT_KIND = {
  occupancy: { label: "자리 이용", style: "bg-red-100 text-red-700" },
  facility: { label: "시설 고장", style: "bg-amber-100 text-amber-700" },
  other: { label: "기타 의견", style: "bg-neutral-200 text-neutral-600" },
} as const;

/** 이력 한 건을 지금 기준으로 분류한다. */
function bucketOf(row: SeatHistoryRow, now: Date) {
  const { start, end } = parseRange(row.period);
  if (row.status === "cancelled") return "cancelled" as const;
  if (end <= now) return "past" as const;
  if (start <= now) return "current" as const;
  return "upcoming" as const;
}

const BUCKET_STYLE = {
  current: "border-emerald-200 bg-emerald-50",
  upcoming: "border-neutral-900/10 bg-neutral-50",
  past: "border-neutral-200 bg-white",
  cancelled: "border-neutral-100 bg-neutral-50/60",
} as const;

const BUCKET_LABEL = {
  current: "사용 중",
  upcoming: "예정",
  past: "지난 이용",
  cancelled: "취소됨",
} as const;

const CARD =
  "rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm md:p-6";
const EMPTY =
  "rounded-2xl border border-dashed border-neutral-200 px-4 py-10 text-center text-sm font-bold text-neutral-400";

export function AdminPage({ seats, userId }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const now = useNow();

  const [selected, setSelected] = useState<number | null>(null);
  // 어느 좌석의 이력인지 함께 담아, 로딩 여부를 별도 상태 없이 판별한다.
  const [history, setHistory] = useState<{
    seatId: number;
    rows: SeatHistoryRow[];
  } | null>(null);
  const [occupancy, setOccupancy] = useState<Occupancy[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [reportFilter, setReportFilter] = useState<"all" | Report["kind"]>(
    "all",
  );
  const [reportStatus, setReportStatus] = useState<"pending" | "done">("pending"); // 처리전 / 처리함
  const [reportPage, setReportPage] = useState(1); // 신고 목록 페이지(1부터)
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [userQuery, setUserQuery] = useState("");
  const [savingUser, setSavingUser] = useState<string | null>(null);
  // 좌석 잠금 상태. props(서버 렌더)를 기본값으로, 잠금/해제 시 갱신한다.
  const [seatActive, setSeatActive] = useState<Map<number, boolean>>(
    () => new Map(seats.map((s) => [s.id, s.active])),
  );
  const [savingSeat, setSavingSeat] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false); // 좌석 이력에서 취소 건을 함께 볼지
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // 연수생 명단
  const [roster, setRoster] = useState<RosterRow[] | null>(null);
  const [rosterQuery, setRosterQuery] = useState("");
  const [newTeam, setNewTeam] = useState("");
  const [newName, setNewName] = useState("");
  const [rosterBusy, setRosterBusy] = useState(false);

  // 좌석도에 현재 사용 현황을 그린다.
  const fetchOccupancy = useCallback(async () => {
    const { data } = await supabase
      .from("seat_occupancy")
      .select(
        "seat_id, user_id, reserver_name, away_since, period, reservation_id, extended",
      );
    return (data ?? []) as Occupancy[];
  }, [supabase]);

  const fetchReports = useCallback(async () => {
    const { data } = await supabase
      .from("report")
      .select(
        "id, seat_id, message, resolved, created_at, kind, reported_name, reporter_id",
      )
      .order("created_at", { ascending: false })
      .limit(50);
    return (data ?? []) as Report[];
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    fetchOccupancy().then((rows) => {
      if (!cancelled) setOccupancy(rows);
    });
    fetchReports().then((rows) => {
      if (!cancelled) setReports(rows);
    });
    supabase
      .from("seat")
      .select("id, active")
      .then(({ data }) => {
        if (cancelled || !data) return;
        setSeatActive(
          new Map(data.map((r) => [r.id as number, r.active as boolean])),
        );
      });
    supabase.rpc("admin_list_profiles").then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        setError(humanizeDbError(error));
        setUsers([]);
        return;
      }
      setUsers((data ?? []) as AdminUser[]);
    });
    supabase.rpc("admin_list_roster").then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        // 명단 기능(마이그레이션 0018/0019) 미적용 환경에서도 나머지 화면은 동작하게 둔다.
        setRoster([]);
        return;
      }
      setRoster((data ?? []) as RosterRow[]);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchOccupancy, fetchReports, supabase, reloadKey]);

  async function addRoster(e: React.FormEvent) {
    e.preventDefault();
    const team = newTeam.trim();
    const name = newName.trim();
    if (!team || !name) return;
    setRosterBusy(true);
    setError(null);
    setNotice(null);
    const { error } = await supabase.from("roster").insert({ team, name });
    setRosterBusy(false);
    if (error) {
      setError(
        error.code === "23505"
          ? "이미 명단에 있는 팀·이름입니다."
          : humanizeDbError(error),
      );
      return;
    }
    setNewName("");
    setNotice(`명단에 추가했습니다: ${team} · ${name}`);
    setReloadKey((k) => k + 1);
  }

  async function deleteRoster(r: RosterRow) {
    if (!window.confirm(`명단에서 삭제할까요?\n${r.team} · ${r.name}`)) return;
    setError(null);
    setNotice(null);
    const { error } = await supabase.from("roster").delete().eq("id", r.id);
    if (error) {
      setError(humanizeDbError(error));
      return;
    }
    setReloadKey((k) => k + 1);
  }

  async function resetRosterClaim(r: RosterRow) {
    if (
      !window.confirm(
        `이 명단의 가입 연결을 해제할까요?\n${r.team} · ${r.name}\n해제하면 다른 계정으로 다시 가입할 수 있게 됩니다.`,
      )
    )
      return;
    setError(null);
    setNotice(null);
    const { error } = await supabase
      .from("roster")
      .update({ claimed_by: null, claimed_at: null })
      .eq("id", r.id);
    if (error) {
      setError(humanizeDbError(error));
      return;
    }
    setNotice(`잠금을 해제했습니다: ${r.team} · ${r.name}`);
    setReloadKey((k) => k + 1);
  }

  async function toggleAdmin(u: AdminUser) {
    setSavingUser(u.user_id);
    setError(null);
    const { error } = await supabase.rpc("set_admin", {
      p_user_id: u.user_id,
      p_is_admin: !u.is_admin,
    });
    setSavingUser(null);
    if (error) {
      setError(humanizeDbError(error));
      return;
    }
    setReloadKey((k) => k + 1);
  }

  useEffect(() => {
    if (selected === null) return;
    const seatId = selected;
    let cancelled = false;
    supabase
      .rpc("admin_seat_history", { p_seat_id: seatId })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setError(humanizeDbError(error));
          return;
        }
        setHistory({ seatId, rows: (data ?? []) as SeatHistoryRow[] });
      });
    return () => {
      cancelled = true;
    };
  }, [selected, supabase]);

  const loading = selected !== null && history?.seatId !== selected;
  const rows = history?.seatId === selected ? history.rows : null;

  const view: SeatView[] = useMemo(() => {
    const byId = new Map(occupancy.map((o) => [o.seat_id, o]));
    return seats.map((s) => {
      const o = byId.get(s.id);
      return {
        ...s,
        active: seatActive.get(s.id) ?? s.active,
        busy: o !== undefined,
        mine: o?.user_id === userId,
        reserverName: o?.reserver_name ?? null,
        awaySince: o?.away_since ? new Date(o.away_since) : null,
      };
    });
  }, [seats, occupancy, userId, seatActive]);

  // 좌석 점검 잠금/해제. 잠글 때는 그 자리의 진행 중·예정 예약이 함께 취소된다.
  async function toggleSeatLock(seatId: number, currentlyActive: boolean) {
    if (currentlyActive) {
      const ok = window.confirm(
        "이 자리를 점검용으로 잠급니다.\n진행 중이거나 예정된 이 자리의 예약이 있으면 함께 취소됩니다.\n계속할까요?",
      );
      if (!ok) return;
    }
    setSavingSeat(true);
    setError(null);
    setNotice(null);
    const { data, error } = await supabase.rpc("admin_set_seat_active", {
      p_seat_id: seatId,
      p_active: !currentlyActive,
    });
    setSavingSeat(false);
    if (error) {
      setError(humanizeDbError(error));
      return;
    }
    setSeatActive((prev) => new Map(prev).set(seatId, !currentlyActive));
    const label = seats.find((s) => s.id === seatId)?.label ?? seatId;
    if (currentlyActive) {
      const cancelled = (data as number) ?? 0;
      setNotice(
        `${label}번 자리를 잠갔습니다.` +
          (cancelled > 0 ? ` 예약 ${cancelled}건을 함께 취소했습니다.` : ""),
      );
    } else {
      setNotice(`${label}번 자리 잠금을 해제했습니다.`);
    }
    setReloadKey((k) => k + 1); // 사용 현황·이력 다시 불러오기
  }

  async function resolveReport(id: string) {
    const { error } = await supabase
      .from("report")
      .update({ resolved: true })
      .eq("id", id);
    if (error) {
      setError(humanizeDbError(error));
      return;
    }
    setReloadKey((k) => k + 1);
  }

  if (!now) {
    return (
      <div className="h-[600px] animate-pulse rounded-3xl bg-neutral-200/60" />
    );
  }

  const seat = seats.find((s) => s.id === selected);
  const seatIsActive = seat ? (seatActive.get(seat.id) ?? seat.active) : true;
  const openReports = reports.filter((r) => !r.resolved);

  // 유형별 미처리 건수. 필터 탭의 배지로 쓴다.
  const openByKind = {
    all: openReports.length,
    occupancy: openReports.filter((r) => r.kind === "occupancy").length,
    facility: openReports.filter((r) => r.kind === "facility").length,
    other: openReports.filter((r) => r.kind === "other").length,
  };
  const shownReports = reports
    .filter((r) => reportFilter === "all" || r.kind === reportFilter)
    .filter((r) => (reportStatus === "done" ? r.resolved : !r.resolved));

  // 신고 목록 페이지네이션: 5개씩.
  const REPORT_PAGE_SIZE = 5;
  const totalReportPages = Math.max(1, Math.ceil(shownReports.length / REPORT_PAGE_SIZE));
  const reportPageSafe = Math.min(reportPage, totalReportPages);
  const pageReports = shownReports.slice(
    (reportPageSafe - 1) * REPORT_PAGE_SIZE,
    reportPageSafe * REPORT_PAGE_SIZE,
  );

  // 신고자 이름은 관리자만 볼 수 있는 사용자 목록에서 찾는다.
  const nameById = new Map((users ?? []).map((u) => [u.user_id, u.name]));

  const REPORT_TABS = [
    { key: "all" as const, label: "전체" },
    { key: "occupancy" as const, label: REPORT_KIND.occupancy.label },
    { key: "facility" as const, label: REPORT_KIND.facility.label },
    { key: "other" as const, label: REPORT_KIND.other.label },
  ];

  const q = userQuery.trim().toLowerCase();
  const shownUsers = (users ?? []).filter(
    (u) =>
      !q ||
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.team.toLowerCase().includes(q),
  );
  const adminCount = (users ?? []).filter((u) => u.is_admin).length;

  const rq = rosterQuery.trim().toLowerCase();
  const shownRoster = (roster ?? []).filter(
    (r) => !rq || r.name.toLowerCase().includes(rq) || r.team.toLowerCase().includes(rq),
  );
  const rosterClaimed = (roster ?? []).filter((r) => r.claimed).length;

  return (
    <div className="flex flex-col gap-5 md:gap-6">
      <header>
        <h1 className="text-[28px] font-black tracking-tighter text-neutral-900">
          관리자
        </h1>
        <p className="mt-1 text-sm font-bold text-neutral-500">
          좌석을 누르면 그 자리의 이용 이력이 나옵니다.
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 px-5 py-3.5 text-sm font-bold text-red-700"
        >
          {error}
        </div>
      )}

      {notice && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3.5 text-sm font-bold text-emerald-700">
          {notice}
        </div>
      )}

      <div className="flex flex-col gap-5 md:gap-6 lg:flex-row">
        <section className={`${CARD} flex min-w-0 flex-1 flex-col`}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-black tracking-tight text-neutral-900">
              D-HUB({seats.length}석) 현황
            </h2>
            <SeatLegend />
          </div>
          <div className="h-[480px]">
            <SeatMap
              seats={view}
              selected={selected}
              onSelect={setSelected}
              now={now}
              anySelectable
            />
          </div>
        </section>

        <aside className={`${CARD} flex w-full shrink-0 flex-col lg:w-[340px]`}>
          <div className="mb-4 flex items-start justify-between gap-2">
            <h2 className="text-lg font-black tracking-tight text-neutral-900">
              {seat ? `${seat.label}번 자리` : "좌석"}
              {seat && !seatIsActive && (
                <span className="ml-2 rounded-md bg-neutral-200 px-1.5 py-0.5 text-[11px] font-bold text-neutral-600 align-middle">
                  점검 중
                </span>
              )}
            </h2>
            {seat && (
              <button
                type="button"
                onClick={() => toggleSeatLock(seat.id, seatIsActive)}
                disabled={savingSeat}
                className={
                  "flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-40 " +
                  (seatIsActive
                    ? "border border-neutral-200 text-neutral-600 hover:border-red-500 hover:text-red-600"
                    : "bg-neutral-900 text-white hover:bg-black")
                }
              >
                {seatIsActive ? (
                  <>
                    <Lock className="h-3.5 w-3.5" />
                    예약 잠금
                  </>
                ) : (
                  <>
                    <LockOpen className="h-3.5 w-3.5" />
                    잠금 해제
                  </>
                )}
              </button>
            )}
          </div>

          {!seat && <p className={EMPTY}>도면에서 좌석을 선택하세요.</p>}

          {seat && loading && (
            <div className="h-24 animate-pulse rounded-2xl bg-neutral-100" />
          )}

          {(() => {
            if (!seat || loading || !rows) return null;
            const cancelledCount = rows.filter(
              (r) => r.status === "cancelled",
            ).length;
            const shownRows = showCancelled
              ? rows
              : rows.filter((r) => r.status !== "cancelled");
            return (
              <>
                {cancelledCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowCancelled((v) => !v)}
                    className="mb-3 self-start rounded-lg border border-neutral-200 px-2.5 py-1 text-[12px] font-bold text-neutral-500 transition-all hover:border-neutral-400 hover:text-neutral-700"
                  >
                    {showCancelled
                      ? "취소 건 숨기기"
                      : `취소 보기 (${cancelledCount})`}
                  </button>
                )}
                {shownRows.length === 0 ? (
                  <p className={EMPTY}>
                    {rows.length === 0
                      ? "아직 이 자리를 쓴 기록이 없습니다."
                      : "정상 예약 기록이 없습니다."}
                  </p>
                ) : (
                  <ul className="scroll-thin flex max-h-[420px] flex-col gap-2 overflow-y-auto">
                    {shownRows.map((row) => {
                      const { start, end } = parseRange(row.period);
                      const bucket = bucketOf(row, now);
                      return (
                        <li
                          key={row.reservation_id}
                          className={`rounded-2xl border p-4 ${BUCKET_STYLE[bucket]}`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[11px] font-bold tracking-wider text-neutral-500">
                              {BUCKET_LABEL[bucket]}
                            </span>
                            {row.extended && (
                              <span className="rounded-md bg-neutral-200 px-1.5 py-0.5 text-[10px] font-bold text-neutral-700">
                                연장함
                              </span>
                            )}
                            {row.away_since && bucket === "current" && (
                              <span className="rounded-md bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                자리비움
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-[15px] font-black text-neutral-900">
                            {row.name ?? "(탈퇴한 사용자)"}
                            {row.team && (
                              <span className="ml-2 text-[13px] font-bold text-neutral-400">
                                {row.team}
                              </span>
                            )}
                          </p>
                          <p className="text-[13px] font-bold tabular-nums text-neutral-500">
                            {fmtDate(start)} {fmtTime(start)} – {fmtTime(end)}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            );
          })()}
        </aside>
      </div>

      <section className={CARD}>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-black tracking-tight text-neutral-900">
          신고 · 의견
          {openReports.length > 0 && (
            <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white tabular-nums">
              {openReports.length}
            </span>
          )}
        </h2>

        {/* 유형별 필터 탭 */}
        <div className="mb-4 flex flex-wrap gap-2">
          {REPORT_TABS.map(({ key, label }) => {
            const active = reportFilter === key;
            const count = openByKind[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setReportFilter(key);
                  setReportPage(1);
                }}
                className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-bold transition-all ${
                  active
                    ? "bg-neutral-900 text-white"
                    : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
                }`}
              >
                {label}
                {count > 0 && (
                  <span
                    className={`rounded-full px-1.5 text-[10px] font-bold tabular-nums ${
                      active
                        ? "bg-white/20 text-white"
                        : "bg-red-500 text-white"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}

          {/* 처리 상태 필터: 처리전 / 처리함 */}
          <div className="ml-auto flex items-center gap-1 rounded-full bg-neutral-100 p-1">
            {(
              [
                { key: "pending", label: "처리전" },
                { key: "done", label: "처리함" },
              ] as const
            ).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setReportStatus(key);
                  setReportPage(1);
                }}
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-bold transition-all ${
                  reportStatus === key
                    ? key === "done"
                      ? "bg-emerald-600 text-white shadow-sm" // 처리함 = 완료 느낌의 초록
                      : "bg-white text-neutral-900 shadow-sm"
                    : "text-neutral-500 hover:text-neutral-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {reports.length === 0 ? (
          <p className={EMPTY}>접수된 내용이 없습니다.</p>
        ) : shownReports.length === 0 ? (
          <p className={EMPTY}>
            {reportStatus === "done" ? "처리된 신고가 없습니다." : "처리할 신고가 없습니다."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pageReports.map((r) => {
              const s = seats.find((x) => x.id === r.seat_id);
              return (
                <li
                  key={r.id}
                  className={
                    "rounded-2xl border p-4 " +
                    (r.resolved
                      ? "border-neutral-100 bg-neutral-50/60"
                      : "border-amber-200 bg-amber-50")
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${REPORT_KIND[r.kind].style}`}
                        >
                          {REPORT_KIND[r.kind].label}
                        </span>
                        {s && (
                          <span className="rounded-md bg-neutral-200 px-1.5 py-0.5 text-[10px] font-bold text-neutral-600 tabular-nums">
                            {s.label}번
                          </span>
                        )}
                        {r.reported_name && (
                          <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                            대상: {r.reported_name}
                          </span>
                        )}
                      </div>
                      <p className="mt-1.5 whitespace-pre-wrap text-sm font-medium text-neutral-800">
                        {r.message}
                      </p>
                      <p className="mt-1 text-[11px] font-bold text-neutral-400">
                        신고자 {nameById.get(r.reporter_id) ?? "(알 수 없음)"} ·{" "}
                        {fmtDate(new Date(r.created_at))}{" "}
                        {fmtTime(new Date(r.created_at))}
                      </p>
                    </div>
                    {r.resolved ? (
                      <span className="flex shrink-0 items-center gap-1.5 text-xs font-bold text-emerald-600">
                        <CheckCircle2 className="h-5 w-5" />
                        처리됨
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => resolveReport(r.id)}
                        className="flex shrink-0 items-center gap-1.5 rounded-xl border border-emerald-500 bg-white px-3.5 py-2 text-xs font-bold text-emerald-600 shadow-sm transition-all hover:bg-emerald-500 hover:text-white"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        처리 완료
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {shownReports.length > 0 && totalReportPages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-1.5">
            {Array.from({ length: totalReportPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setReportPage(p)}
                aria-current={p === reportPageSafe ? "page" : undefined}
                className={`h-9 min-w-9 rounded-xl px-3 text-sm font-bold tabular-nums transition-all ${
                  p === reportPageSafe
                    ? "bg-neutral-900 text-white"
                    : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className={CARD}>
        <h2 className="mb-1 flex items-center gap-2 text-lg font-black tracking-tight text-neutral-900">
          사용자 · 관리자 권한
          <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-bold text-neutral-600 tabular-nums">
            {users === null ? "—" : `${users.length}명`}
          </span>
        </h2>
        <p className="mb-4 text-[13px] font-medium text-neutral-500">
          로그인한 사용자를 관리자로 지정하거나 해제합니다. 관리자 {adminCount}
          명.
        </p>

        <div className="relative mb-4 max-w-sm">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-300" />
          <input
            value={userQuery}
            onChange={(e) => setUserQuery(e.target.value)}
            placeholder="이름 · 이메일 · 팀 검색"
            className="w-full rounded-xl border border-neutral-200 bg-white py-2.5 pl-10 pr-4 text-sm font-bold text-neutral-900 outline-none transition-all placeholder:font-medium placeholder:text-neutral-300 focus:border-neutral-900"
          />
        </div>

        {users === null ? (
          <div className="h-24 animate-pulse rounded-2xl bg-neutral-100" />
        ) : shownUsers.length === 0 ? (
          <p className={EMPTY}>해당하는 사용자가 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {shownUsers.map((u) => {
              const isMe = u.user_id === userId;
              return (
                <li
                  key={u.user_id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 p-3.5"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-sm font-black text-white">
                      {u.name.slice(0, 1)}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-black text-neutral-900">
                          {u.name}
                        </span>
                        {u.is_admin && (
                          <span className="shrink-0 rounded-md bg-neutral-900 px-1.5 py-0.5 text-[10px] font-bold text-white">
                            관리자
                          </span>
                        )}
                        {isMe && (
                          <span className="shrink-0 rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] font-bold text-neutral-500">
                            나
                          </span>
                        )}
                      </div>
                      <p className="truncate text-[12px] font-bold text-neutral-400">
                        {u.team} · {u.email}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => toggleAdmin(u)}
                    disabled={savingUser === u.user_id || (isMe && u.is_admin)}
                    title={
                      isMe && u.is_admin
                        ? "본인 권한은 스스로 해제할 수 없습니다"
                        : undefined
                    }
                    className={
                      "flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-40 " +
                      (u.is_admin
                        ? "border border-neutral-200 text-neutral-600 hover:border-red-500 hover:text-red-600"
                        : "bg-neutral-900 text-white hover:bg-black")
                    }
                  >
                    {u.is_admin ? (
                      <>
                        <ShieldOff className="h-3.5 w-3.5" />
                        관리자 해제
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="h-3.5 w-3.5" />
                        관리자 지정
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={CARD}>
        <h2 className="mb-1 flex items-center gap-2 text-lg font-black tracking-tight text-neutral-900">
          연수생 명단
          <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-bold text-neutral-600 tabular-nums">
            {roster === null ? "—" : `${roster.length}명`}
          </span>
        </h2>
        <p className="mb-4 text-[13px] font-medium text-neutral-500">
          명단에 있는 사람만 가입할 수 있습니다. 한 명단은 한 계정에만 연결됩니다.
          {roster !== null && (
            <>
              {" "}
              가입 {rosterClaimed} · 미가입 {roster.length - rosterClaimed}.
            </>
          )}
        </p>

        {/* 추가 */}
        <form onSubmit={addRoster} className="mb-4 flex flex-wrap gap-2">
          <input
            value={newTeam}
            onChange={(e) => setNewTeam(e.target.value)}
            placeholder="팀명"
            maxLength={40}
            className="w-32 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm font-bold text-neutral-900 outline-none transition-all placeholder:font-medium placeholder:text-neutral-300 focus:border-neutral-900"
          />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="이름"
            maxLength={40}
            className="w-32 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm font-bold text-neutral-900 outline-none transition-all placeholder:font-medium placeholder:text-neutral-300 focus:border-neutral-900"
          />
          <button
            type="submit"
            disabled={rosterBusy || !newTeam.trim() || !newName.trim()}
            className="flex items-center gap-1.5 rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-bold text-white transition-all hover:bg-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="h-4 w-4" />
            추가
          </button>
        </form>

        <div className="relative mb-4 max-w-sm">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-300" />
          <input
            value={rosterQuery}
            onChange={(e) => setRosterQuery(e.target.value)}
            placeholder="이름 · 팀 검색"
            className="w-full rounded-xl border border-neutral-200 bg-white py-2.5 pl-10 pr-4 text-sm font-bold text-neutral-900 outline-none transition-all placeholder:font-medium placeholder:text-neutral-300 focus:border-neutral-900"
          />
        </div>

        {roster === null ? (
          <div className="h-24 animate-pulse rounded-2xl bg-neutral-100" />
        ) : roster.length === 0 ? (
          <p className={EMPTY}>
            아직 명단이 없습니다. 위에서 추가하거나 SQL로 한 번에 넣으세요.
          </p>
        ) : shownRoster.length === 0 ? (
          <p className={EMPTY}>해당하는 명단이 없습니다.</p>
        ) : (
          <ul className="scroll-thin flex max-h-[520px] flex-col gap-2 overflow-y-auto">
            {shownRoster.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 p-3.5"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-black text-neutral-900">{r.name}</span>
                    <span className="shrink-0 rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] font-bold text-neutral-500">
                      {r.team}
                    </span>
                    {r.claimed ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                        <CheckCircle2 className="h-3 w-3" />
                        가입됨
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] font-bold text-neutral-400">
                        미가입
                      </span>
                    )}
                  </div>
                  {r.claimed_email && (
                    <p className="mt-0.5 truncate text-[11px] font-bold text-neutral-400">
                      {r.claimed_email}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {r.claimed && (
                    <button
                      type="button"
                      onClick={() => resetRosterClaim(r)}
                      title="가입 연결 해제"
                      className="flex items-center gap-1 rounded-xl border border-neutral-200 px-2.5 py-2 text-xs font-bold text-neutral-600 transition-all hover:border-amber-500 hover:text-amber-600"
                    >
                      <LockOpen className="h-3.5 w-3.5" />
                      잠금 해제
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => deleteRoster(r)}
                    title="명단에서 삭제"
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 text-neutral-400 transition-all hover:border-red-500 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
