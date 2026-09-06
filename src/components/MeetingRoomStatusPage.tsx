"use client";

import { useEffect, useRef, useState } from "react";
import { FileSpreadsheet, RefreshCw, Upload } from "lucide-react";

/**
 * 회의실 예약 현황 (관리자 전용, 조회 전용).
 * 관리자가 공식 시스템에서 내려받은 "회의실 예약 현황" 엑셀(.xls/.xlsx)을 올리면,
 * 그 내용을 파싱해 18F 회의실 7개(M1·M2·M3 / A1~A4)의 하루 일정을 배치도·타임라인으로 보여준다.
 * 예약 생성/수정은 없다. 데이터는 브라우저 안에서만 쓰이고 저장하지 않는다.
 *
 * 디자인: design_handoff_meeting_room_status (Wanted 토큰, 하이파이). 축만 09~24시로 조정.
 */

// ── 축(시간대) ─────────────────────────────────────────────
const DS = 9; // 시작 09시
const DE = 24; // 끝 24시
const SPAN = DE - DS; // 15시간
const STEP = 3; // 눈금 간격 → 09 12 15 18 21 24
const ACCENT = "#0066FF";

type Booking = {
  roomId: string;
  start: number; // 소수 시간
  end: number;
  title: string;
  who: string; // 예약자 이름
  people: string; // 예약인원
};

type RoomDef = { id: string; space: string; meta: string; row: "top" | "col" | "extra" };

type ParseResult = {
  fileName: string;
  dateStr: string; // YYYY-MM-DD (주 날짜)
  dateLabel: string; // 2026. 09. 04 (금)
  monthDay: string; // 9월 4일
  weekday: string; // 금
  bookings: Booking[];
  rooms: RoomDef[]; // 알려진 7개 + 엑셀에만 있는 추가 방
  cancelledCount: number;
  skippedCount: number;
  multiDate: boolean;
};

// 18F 회의실(고정). 리스트/배치도 순서 = 이 순서.
const KNOWN_ROOMS: RoomDef[] = [
  { id: "M1", space: "SPACE M", meta: "6인실", row: "top" },
  { id: "M2", space: "SPACE M", meta: "6인실", row: "top" },
  { id: "M3", space: "SPACE M", meta: "6인실", row: "top" },
  { id: "A4", space: "SPACE A", meta: "4인실", row: "col" },
  { id: "A3", space: "SPACE A", meta: "4인실", row: "col" },
  { id: "A2", space: "SPACE A", meta: "4인실", row: "col" },
  { id: "A1", space: "SPACE A", meta: "4인실", row: "col" },
];
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
function hm(t: number) {
  const h = Math.floor(t);
  const m = Math.round((t - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function dur(t: number) {
  const h = Math.floor(t);
  const m = Math.round((t - h) * 60);
  if (h && m) return `${h}시간 ${m}분`;
  if (h) return `${h}시간`;
  return `${m}분`;
}
function pct(t: number) {
  return ((clamp(t, DS, DE) - DS) / SPAN) * 100;
}

/** "2026-09-04 20:00 - 23:29" → {date, start, end} (분 :29/:59는 30/정시로 보정) */
function parseTimeCell(raw: string): { date: string; start: number; end: number } | null {
  const m = raw.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s*[-~]\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, sh, sm, eh0, em0] = m;
  let eh = Number(eh0);
  let em = Number(em0);
  if (em === 29) em = 30;
  else if (em === 59) {
    eh += 1;
    em = 0;
  }
  const start = Number(sh) + Number(sm) / 60;
  const end = eh + em / 60;
  if (!(end > start)) return null;
  return { date: `${y}-${mo}-${d}`, start, end };
}

async function parseWorkbook(file: File): Promise<ParseResult> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("빈 파일이거나 시트를 찾을 수 없습니다.");
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "" });

  const headerIdx = rows.findIndex(
    (r) =>
      r.some((c) => String(c).includes("예약시간")) && r.some((c) => String(c).includes("회의실")),
  );
  if (headerIdx < 0) {
    throw new Error("형식을 알 수 없습니다. '회의실'·'예약시간' 열이 있는 예약 현황 엑셀인지 확인해 주세요.");
  }
  const header = rows[headerIdx].map((c) => String(c).trim());
  const findIncl = (want: string) => header.findIndex((h) => h.includes(want));
  const ci = {
    room: header.findIndex((h) => h === "회의실"),
    who: findIncl("이름"),
    title: findIncl("예약명"),
    people: findIncl("예약인원"),
    time: findIncl("예약시간"),
    status: findIncl("예약상태"),
  };
  if (ci.room < 0 || ci.time < 0) {
    throw new Error("'회의실' 또는 '예약시간' 열을 찾지 못했습니다.");
  }

  const bookings: Booking[] = [];
  const dates = new Map<string, number>();
  let cancelledCount = 0;
  let skippedCount = 0;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const timeRaw = String(row[ci.time] ?? "").trim();
    if (!timeRaw) continue;
    const status = ci.status >= 0 ? String(row[ci.status] ?? "").trim() : "";
    if (status.includes("취소")) {
      cancelledCount++;
      continue;
    }
    const t = parseTimeCell(timeRaw);
    if (!t) {
      skippedCount++;
      continue;
    }
    dates.set(t.date, (dates.get(t.date) ?? 0) + 1);
    const roomId =
      String(row[ci.room] ?? "")
        .replace(/^SPACE\s*/i, "")
        .trim()
        .toUpperCase() || "?";
    bookings.push({
      roomId,
      start: t.start,
      end: t.end,
      title: (ci.title >= 0 ? String(row[ci.title] ?? "").trim() : "") || "(제목 없음)",
      who: ci.who >= 0 ? String(row[ci.who] ?? "").trim() : "",
      people: ci.people >= 0 ? String(row[ci.people] ?? "").trim() : "",
    });
  }

  if (bookings.length === 0 && cancelledCount === 0) {
    throw new Error("예약 데이터를 한 건도 읽지 못했습니다. 파일을 확인해 주세요.");
  }

  // 주 날짜 = 가장 많이 나온 날짜
  let dateStr = "";
  let max = -1;
  for (const [d, n] of dates) {
    if (n > max) {
      max = n;
      dateStr = d;
    }
  }
  if (!dateStr) dateStr = new Date().toISOString().slice(0, 10);
  const [yy, mm, dd] = dateStr.split("-").map(Number);
  const dateObj = new Date(yy, mm - 1, dd);
  const weekday = WEEKDAYS[dateObj.getDay()];
  const dateLabel = `${yy}. ${String(mm).padStart(2, "0")}. ${String(dd).padStart(2, "0")} (${weekday})`;
  const monthDay = `${mm}월 ${dd}일`;

  // 엑셀에만 있는(배치도에 없는) 방은 목록 하단에 추가
  const knownIds = new Set(KNOWN_ROOMS.map((r) => r.id));
  const extraIds = [...new Set(bookings.map((b) => b.roomId))].filter((id) => !knownIds.has(id));
  const rooms: RoomDef[] = [
    ...KNOWN_ROOMS,
    ...extraIds.map((id) => ({ id, space: "", meta: "", row: "extra" as const })),
  ];

  return {
    fileName: file.name,
    dateStr,
    dateLabel,
    monthDay,
    weekday,
    bookings,
    rooms,
    cancelledCount,
    skippedCount,
    multiDate: dates.size > 1,
  };
}

// ── 컴포넌트 ─────────────────────────────────────────────
export function MeetingRoomStatusPage() {
  const [data, setData] = useState<ParseResult | null>(null);
  const [selId, setSelId] = useState<string>("M2");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const fileRef = useRef<HTMLInputElement>(null);

  // 현재 시각 20초마다 갱신(오늘 데이터일 때만 실제로 쓰임)
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 20000);
    return () => clearInterval(t);
  }, []);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const result = await parseWorkbook(file);
      setData(result);
      // 기본 선택: 예약이 있는 첫 방, 없으면 M2
      const withBooking = result.rooms.find((r) => result.bookings.some((b) => b.roomId === r.id));
      setSelId(withBooking?.id ?? "M2");
    } catch (e) {
      setError(e instanceof Error ? e.message : "파일을 읽는 중 문제가 생겼습니다.");
      setData(null);
    } finally {
      setBusy(false);
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
    e.target.value = ""; // 같은 파일 다시 선택 가능하게
  }

  // ── 업로드 화면 ──
  if (!data) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 18, color: "#171719" }}>
        <PageHeader chips={null} />
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void handleFile(f);
          }}
          style={{
            background: "#FFFFFF",
            border: `1.5px dashed ${dragOver ? ACCENT : "#D6D8DD"}`,
            borderRadius: 16,
            padding: "56px 28px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
            textAlign: "center",
            transition: "border-color 160ms ease-out, background 160ms ease-out",
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: "#EAF2FF",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <FileSpreadsheet size={26} color={ACCENT} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em" }}>
              회의실 예약 현황 엑셀을 올려 주세요
            </div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#6B6E76", lineHeight: 1.6 }}>
              공식 시스템에서 내려받은 예약 현황 파일(.xls / .xlsx)을 그대로 올리면 됩니다.
              <br />
              <span style={{ color: "#8E9199" }}>
                필요한 열: 회의실 · 이름 · 회의실 예약명 · 예약시간 · 예약상태
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: ACCENT,
              color: "#FFFFFF",
              border: "none",
              borderRadius: 10,
              padding: "12px 20px",
              fontSize: 14,
              fontWeight: 700,
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            <Upload size={16} />
            {busy ? "읽는 중…" : "엑셀 파일 선택"}
          </button>
          <div style={{ fontSize: 12, fontWeight: 500, color: "#A2A5AC" }}>
            여기로 파일을 끌어다 놓아도 됩니다. 올린 파일은 저장하지 않고 화면에만 사용합니다.
          </div>
          {error && (
            <div
              style={{
                marginTop: 4,
                background: "#FFF0EB",
                border: "1px solid #FBD6C9",
                color: "#B33F1E",
                borderRadius: 10,
                padding: "10px 14px",
                fontSize: 13,
                fontWeight: 600,
                maxWidth: 460,
              }}
            >
              {error}
            </div>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={onInputChange}
          hidden
        />
      </div>
    );
  }

  // ── 로드 완료: 파생 상태 계산 ──
  const now = new Date(nowMs);
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
  const isToday = data.dateStr === todayStr;
  const clock = now.getHours() + now.getMinutes() / 60;

  const bookingsOf = (roomId: string) =>
    data.bookings.filter((b) => b.roomId === roomId).sort((a, b) => a.start - b.start);
  const isLive = (b: Booking) => isToday && clock >= b.start && clock < b.end;
  const isPast = (b: Booking) => isToday && clock >= b.end;
  const inUseRoom = (roomId: string) => bookingsOf(roomId).some(isLive);

  const sel = data.rooms.find((r) => r.id === selId) ?? data.rooms[0];
  const selBookings = bookingsOf(sel.id);
  const totalConfirmed = data.bookings.length;

  const select = (id: string) => setSelId(id);
  const onKeyActivate = (id: string) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      select(id);
    }
  };

  // 헤더 칩
  const chips = (
    <>
      <Chip>18F 회의실</Chip>
      <Chip tabular>{data.dateLabel}</Chip>
      {isToday ? (
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "#FFFFFF",
            background: ACCENT,
            borderRadius: 8,
            padding: "8px 12px",
            letterSpacing: "0.06em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {hm(Math.floor(clock) + Math.round((clock - Math.floor(clock)) * 60) / 60)} 기준
        </div>
      ) : (
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "#8E9199",
            background: "#F1F2F3",
            borderRadius: 8,
            padding: "8px 12px",
            letterSpacing: "0.02em",
          }}
        >
          다른 날짜 데이터
        </div>
      )}
    </>
  );

  const freeCount = isToday
    ? `${data.rooms.filter((r) => !inUseRoom(r.id)).length}개 이용 가능`
    : `예약 ${totalConfirmed}건`;
  const freeCountColor = isToday ? "#00A939" : "#6B6E76";

  // 우측 헤드라인/요약
  const cur = isToday ? selBookings.find((b) => clock >= b.start && clock < b.end) : undefined;
  const next = isToday ? selBookings.find((b) => b.start > clock) : undefined;
  let headline: string;
  let headSub: string;
  if (!isToday) {
    headline = selBookings.length ? `예약 ${selBookings.length}건` : "예약 없음";
    headSub = selBookings.length ? `${data.monthDay} 기준` : "이 날 등록된 일정이 없습니다";
  } else if (cur) {
    headline = "이용 중";
    headSub = `${hm(cur.end)} 종료 · ${cur.title}`;
  } else if (next) {
    headline = `${dur(Math.max(0, next.start - Math.max(clock, DS)))} 이용 가능`;
    headSub = `다음 일정 ${hm(next.start)}`;
  } else {
    headline = "종일 이용 가능";
    headSub = "남은 일정 없음";
  }

  const statusText = isToday ? (cur ? "이용 중" : "이용 가능") : `${selBookings.length}건`;
  const statusColor = isToday ? (cur ? "#FF6B4F" : "#00A939") : "#171719";
  const nextText = isToday
    ? next
      ? hm(next.start)
      : "없음"
    : selBookings.length
      ? hm(selBookings[0].start)
      : "-";

  // 타임라인 눈금
  const hours: number[] = [];
  for (let h = DS; h <= DE; h += STEP) hours.push(h);

  // 미니바 축 라벨(시작/중간/끝)
  const axisMid = Math.round((DS + DE) / 2);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, color: "#171719" }}>
      <PageHeader chips={chips} />

      {/* 툴바: 파일/보정 안내 + 다른 파일 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          fontSize: 12,
          fontWeight: 600,
          color: "#6B6E76",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <FileSpreadsheet size={14} color="#8E9199" />
          <span style={{ color: "#46474C" }}>{data.fileName}</span>
          <span style={{ color: "#C4C8CF" }}>·</span>
          <span>예약완료 {totalConfirmed}건</span>
          {data.cancelledCount > 0 && <span>· 취소 {data.cancelledCount}건 제외</span>}
          {data.skippedCount > 0 && <span>· 형식오류 {data.skippedCount}건 제외</span>}
          {data.multiDate && <span style={{ color: "#B33F1E" }}>· 여러 날짜 포함(주 날짜 기준 표시)</span>}
        </div>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "#FFFFFF",
            border: "1px solid #E8E9EB",
            borderRadius: 8,
            padding: "7px 11px",
            fontSize: 12,
            fontWeight: 700,
            color: "#46474C",
            cursor: "pointer",
          }}
        >
          <RefreshCw size={13} />
          다른 파일 올리기
        </button>
      </div>

      {/* 본문 2열 */}
      <div style={{ display: "flex", gap: 18, alignItems: "stretch", flexWrap: "wrap" }}>
        {/* 좌측 패널 */}
        <div
          style={{
            flex: "0 1 356px",
            minWidth: 300,
            background: "#FFFFFF",
            border: "1px solid #E8E9EB",
            borderRadius: 16,
            padding: 18,
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.01em" }}>회의실</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: freeCountColor }}>{freeCount}</div>
          </div>

          {/* 18F 배치도 */}
          <div
            style={{
              background: "#F7F8FA",
              borderRadius: 12,
              padding: 12,
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              gap: 9,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#46474C", letterSpacing: "0.14em" }}>
                18F LAYOUT
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#6B6E76" }}>{sel.id} 위치</div>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "66px minmax(0, 1fr)",
                gridTemplateRows: "34px minmax(0, 1fr)",
                gap: 6,
              }}
            >
              <div style={{ gridArea: "1 / 1 / 3 / 2", display: "flex", flexDirection: "column", gap: 5 }}>
                {data.rooms
                  .filter((r) => r.row === "col")
                  .map((r) => (
                    <MapTile
                      key={r.id}
                      room={r}
                      on={r.id === sel.id}
                      inUse={inUseRoom(r.id)}
                      hovered={hover === `tile:${r.id}`}
                      onHover={(v) => setHover(v ? `tile:${r.id}` : null)}
                      onSelect={() => select(r.id)}
                      onKeyActivate={onKeyActivate(r.id)}
                    />
                  ))}
              </div>
              <div
                style={{
                  gridArea: "1 / 2 / 2 / 3",
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: 5,
                }}
              >
                {data.rooms
                  .filter((r) => r.row === "top")
                  .map((r) => (
                    <MapTile
                      key={r.id}
                      room={r}
                      on={r.id === sel.id}
                      inUse={inUseRoom(r.id)}
                      hovered={hover === `tile:${r.id}`}
                      onHover={(v) => setHover(v ? `tile:${r.id}` : null)}
                      onSelect={() => select(r.id)}
                      onKeyActivate={onKeyActivate(r.id)}
                    />
                  ))}
              </div>
              <div
                style={{
                  gridArea: "2 / 2 / 3 / 3",
                  position: "relative",
                  background: "#EEF0F3",
                  borderRadius: 8,
                  boxSizing: "border-box",
                  overflow: "hidden",
                  minHeight: 74,
                }}
              >
                <svg
                  viewBox="0 0 200 110"
                  preserveAspectRatio="xMidYMid meet"
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                >
                  <path
                    d="M36 44 C 22 76, 76 88, 100 58 C 124 28, 178 40, 164 72"
                    fill="none"
                    stroke="#C4C8CF"
                    strokeWidth="11"
                    strokeLinecap="round"
                  />
                </svg>
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    transform: "translateX(-50%)",
                    bottom: 6,
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#FFFFFF",
                    background: "#6B6E76",
                    borderRadius: 5,
                    padding: "3px 7px",
                    letterSpacing: "0.06em",
                  }}
                >
                  입구
                </div>
              </div>
            </div>
          </div>

          {/* 회의실 리스트 */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            {data.rooms.map((r) => {
              const on = r.id === sel.id;
              const rb = bookingsOf(r.id);
              const inUse = inUseRoom(r.id);
              const hovered = hover === `row:${r.id}`;
              const pillBg = on ? "#FFFFFF" : isToday ? (inUse ? "#FFEDE8" : "#E7F8EC") : "#EEF0F3";
              const pillFg = on ? "#0052CC" : isToday ? (inUse ? "#B33F1E" : "#00701F") : "#46474C";
              const pillText = isToday ? (inUse ? "이용 중" : "이용 가능") : `${rb.length}건`;
              return (
                <div
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => select(r.id)}
                  onKeyDown={onKeyActivate(r.id)}
                  onMouseEnter={() => setHover(`row:${r.id}`)}
                  onMouseLeave={() => setHover(null)}
                  style={{
                    boxSizing: "border-box",
                    cursor: "pointer",
                    padding: "13px 14px",
                    borderRadius: 12,
                    background: on ? ACCENT : hovered ? "#EFF1F4" : "#F7F8FA",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    boxShadow: on ? "0 8px 20px rgba(0,102,255,0.20)" : "none",
                    transition: "background 160ms ease-out, box-shadow 200ms ease-out",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div
                      style={{
                        fontSize: 17,
                        fontWeight: 700,
                        letterSpacing: "-0.02em",
                        lineHeight: 1,
                        color: on ? "#FFFFFF" : "#171719",
                      }}
                    >
                      {r.id}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: "0.01em",
                        color: on ? "#FFFFFF" : "#6B6E76",
                      }}
                    >
                      {r.meta || "회의실"}
                    </div>
                    <div style={{ flex: 1 }} />
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: "0.02em",
                        padding: "4px 8px",
                        borderRadius: 5,
                        background: pillBg,
                        color: pillFg,
                      }}
                    >
                      {pillText}
                    </div>
                  </div>
                  <div
                    style={{
                      position: "relative",
                      height: 6,
                      borderRadius: 3,
                      background: on ? "rgba(255,255,255,0.26)" : "#E4E6EA",
                      overflow: "hidden",
                    }}
                  >
                    {rb.map((b, i) => (
                      <div
                        key={i}
                        style={{
                          position: "absolute",
                          top: 0,
                          bottom: 0,
                          left: `${pct(b.start)}%`,
                          width: `${Math.max(0, pct(b.end) - pct(b.start))}%`,
                          background: on ? "#FFFFFF" : isPast(b) ? "#C4C8CF" : ACCENT,
                          borderRadius: 3,
                        }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 11,
              fontWeight: 600,
              color: "#6B6E76",
              letterSpacing: "0.1em",
            }}
          >
            <div>{String(DS).padStart(2, "0")}</div>
            <div>{String(axisMid).padStart(2, "0")}</div>
            <div>{String(DE).padStart(2, "0")}</div>
          </div>
        </div>

        {/* 우측 상세 패널 */}
        <div
          style={{
            flex: "1 1 420px",
            minWidth: 300,
            background: "#FFFFFF",
            border: "1px solid #E8E9EB",
            borderRadius: 16,
            padding: "26px 28px 20px",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          {/* 룸 헤더 */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 20,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ fontSize: 38, fontWeight: 700, color: ACCENT, letterSpacing: "-0.04em", lineHeight: 1 }}>
                {sel.id}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em" }}>
                  {sel.space || "회의실"}
                </div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "#8E9199" }}>{sel.meta || "—"}</div>
              </div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#6B6E76", letterSpacing: "0.12em", paddingTop: 6 }}>
              {data.monthDay} {isToday ? "· 오늘" : `(${data.weekday})`}
            </div>
          </div>

          {/* 요약 3칸 */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
              gap: 1,
              background: "#EDEEF0",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            <SummaryCell label="STATUS" value={statusText} valueColor={statusColor} />
            <SummaryCell label="NEXT" value={nextText} />
            <SummaryCell label="TOTAL" value={`${selBookings.length}건`} />
          </div>

          {/* 헤드라인 + 타임라인 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 23, fontWeight: 700, color: ACCENT, letterSpacing: "-0.03em" }}>
                {headline}
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, color: "#8E9199" }}>{headSub}</div>
            </div>

            <div style={{ position: "relative", paddingTop: 22 }}>
              <div style={{ position: "relative", height: 16 }}>
                {hours.map((h) => (
                  <div
                    key={h}
                    style={{
                      position: "absolute",
                      left: `${pct(h)}%`,
                      transform: h === DS ? "none" : h === DE ? "translateX(-100%)" : "translateX(-50%)",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#6B6E76",
                      letterSpacing: "0.08em",
                    }}
                  >
                    {String(h).padStart(2, "0")}
                  </div>
                ))}
              </div>
              {isToday && clock >= DS && clock <= DE && (
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: `${pct(clock)}%`,
                    transform: "translateX(-50%)",
                    fontSize: 11,
                    fontWeight: 700,
                    color: ACCENT,
                    background: "#FFFFFF",
                    padding: "0 4px",
                    letterSpacing: "0.04em",
                    whiteSpace: "nowrap",
                  }}
                >
                  {hm(Math.floor(clock) + Math.round((clock - Math.floor(clock)) * 60) / 60)}
                </div>
              )}
              <div
                style={{
                  position: "relative",
                  height: 58,
                  background: "#F4F6F8",
                  borderRadius: 10,
                  overflow: "hidden",
                }}
              >
                {hours.map((h) => (
                  <div
                    key={h}
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      left: `${pct(h)}%`,
                      width: 1,
                      background: h === DS || h === DE ? "transparent" : "#E7EAEE",
                    }}
                  />
                ))}
                {isToday && clock >= DS && clock <= DE && (
                  <div
                    style={{
                      position: "absolute",
                      left: `${pct(clock)}%`,
                      top: 0,
                      bottom: 0,
                      width: 2,
                      marginLeft: -1,
                      background: ACCENT,
                      opacity: 0.9,
                    }}
                  />
                )}
                {selBookings.map((b, i) => {
                  const live = isLive(b);
                  const past = isPast(b);
                  const bg = live ? ACCENT : past ? "#E5E7EA" : "#D2E4FF";
                  const fg = live ? "#FFFFFF" : past ? "#5F6269" : "#0B4FBF";
                  const width = Math.max(0, pct(b.end) - pct(b.start));
                  const showTime = (b.end - b.start) / SPAN >= 0.16;
                  return (
                    <div
                      key={i}
                      title={`${hm(b.start)}–${hm(b.end)} ${b.title}${b.who ? ` · ${b.who}` : ""}`}
                      style={{
                        position: "absolute",
                        top: 6,
                        bottom: 6,
                        left: `${pct(b.start)}%`,
                        width: `${width}%`,
                        background: bg,
                        borderRadius: 8,
                        padding: "0 10px",
                        boxSizing: "border-box",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        gap: 2,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: fg,
                          letterSpacing: "-0.01em",
                          whiteSpace: "nowrap",
                          textOverflow: "ellipsis",
                          overflow: "hidden",
                        }}
                      >
                        {b.title}
                      </div>
                      {showTime && (
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            color: fg,
                            opacity: 0.72,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {hm(b.start)}–{hm(b.end)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 일정 리스트 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#6B6E76", letterSpacing: "0.14em" }}>
              {isToday ? "오늘 일정" : "예약 일정"}
            </div>
            {selBookings.map((b, i) => {
              const live = isLive(b);
              const past = isPast(b);
              const tag = !isToday ? "예약" : live ? "진행 중" : past ? "종료" : "예정";
              const tagBg = !isToday ? "#EAF2FF" : live ? ACCENT : past ? "#F1F2F3" : "#EAF2FF";
              const tagFg = !isToday ? "#0B4FBF" : live ? "#FFFFFF" : past ? "#5F6269" : "#0B4FBF";
              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "11px 2px",
                    borderTop: "1px solid #F1F2F3",
                    flexWrap: "wrap",
                    opacity: past ? 0.72 : 1,
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      letterSpacing: "0.01em",
                      fontVariantNumeric: "tabular-nums",
                      minWidth: 104,
                    }}
                  >
                    {hm(b.start)} – {hm(b.end)}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em", flex: 1 }}>
                    {b.title}
                  </div>
                  {(b.who || b.people) && (
                    <div style={{ fontSize: 12, fontWeight: 500, color: "#8E9199" }}>
                      {b.who}
                      {b.who && b.people ? " · " : ""}
                      {b.people ? `${b.people}명` : ""}
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.04em",
                      padding: "4px 8px",
                      borderRadius: 6,
                      background: tagBg,
                      color: tagFg,
                    }}
                  >
                    {tag}
                  </div>
                </div>
              );
            })}
            {selBookings.length === 0 && (
              <div style={{ padding: "20px 0", fontSize: 13, fontWeight: 500, color: "#6B6E76" }}>
                {isToday ? "오늘 등록된 일정이 없습니다." : "이 회의실에 등록된 일정이 없습니다."}
              </div>
            )}
          </div>

          <div
            style={{
              marginTop: "auto",
              paddingTop: 16,
              borderTop: "1px solid #F1F2F3",
              fontSize: 12,
              fontWeight: 600,
              color: ACCENT,
              letterSpacing: "0.01em",
            }}
          >
            예약 현황 조회 전용 · 예약은 공식 회의실 예약 시스템에서 진행하세요
          </div>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={onInputChange}
        hidden
      />
    </div>
  );
}

// ── 하위 조각 ─────────────────────────────────────────────
function PageHeader({ chips }: { chips: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 20,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#6B6E76", letterSpacing: "0.2em" }}>
          MEETING ROOM
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>회의실 예약 현황</div>
      </div>
      {chips && <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>{chips}</div>}
    </div>
  );
}

function Chip({ children, tabular }: { children: React.ReactNode; tabular?: boolean }) {
  return (
    <div
      style={{
        fontSize: 12,
        fontWeight: 600,
        color: "#46474C",
        background: "#FFFFFF",
        border: "1px solid #E8E9EB",
        borderRadius: 8,
        padding: "7px 11px",
        letterSpacing: "0.04em",
        fontVariantNumeric: tabular ? "tabular-nums" : "normal",
      }}
    >
      {children}
    </div>
  );
}

function SummaryCell({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ background: "#FFFFFF", padding: "15px 18px", display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#6B6E76", letterSpacing: "0.14em" }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em", color: valueColor ?? "#171719" }}>
        {value}
      </div>
    </div>
  );
}

function MapTile({
  room,
  on,
  inUse,
  hovered,
  onHover,
  onSelect,
  onKeyActivate,
}: {
  room: RoomDef;
  on: boolean;
  inUse: boolean;
  hovered: boolean;
  onHover: (v: boolean) => void;
  onSelect: () => void;
  onKeyActivate: (e: React.KeyboardEvent) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={onKeyActivate}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      style={{
        flex: 1,
        minHeight: 34,
        boxSizing: "border-box",
        cursor: "pointer",
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "-0.01em",
        background: on ? ACCENT : inUse ? "#FFF0EB" : "#FFFFFF",
        color: on ? "#FFFFFF" : "#171719",
        boxShadow: on
          ? "0 4px 12px rgba(0,102,255,0.24)"
          : hovered
            ? "inset 0 0 0 1px #B9BCC2"
            : inUse
              ? "inset 0 0 0 1px #FBD6C9"
              : "inset 0 0 0 1px #E4E6EA",
        transition: "background 160ms ease-out, box-shadow 200ms ease-out",
      }}
    >
      {room.id}
    </div>
  );
}
