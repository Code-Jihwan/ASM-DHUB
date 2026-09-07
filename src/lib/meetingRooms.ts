// 회의실 예약 현황: 엑셀 파싱 + 타입/상수/포맷(순수 로직).
// 저장/조회는 서버(DB)로 하며 그 부분은 meetingRoomStore.ts 가 담당한다.

// ── 축(시간대) ─────────────────────────────────────────────
export const DS = 9; // 시작 09시
export const DE = 24; // 끝 24시
export const SPAN = DE - DS; // 15시간
export const STEP = 3; // 눈금 간격 → 09 12 15 18 21 24
export const ACCENT = "#0066FF";

export type Booking = {
  roomId: string;
  start: number; // 소수 시간
  end: number;
  title: string;
  who: string; // 예약자 이름
  people: string; // 예약인원
};

export type RoomDef = { id: string; space: string; meta: string; row: "top" | "col" | "extra" };

export type ParseResult = {
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

// 18F 회의실(고정). 리스트/배치도 순서 = 이 순서. M1~M3, A1~A4 오름차순으로 맞춘다.
export const KNOWN_ROOMS: RoomDef[] = [
  { id: "M1", space: "SPACE M", meta: "6인실", row: "top" },
  { id: "M2", space: "SPACE M", meta: "6인실", row: "top" },
  { id: "M3", space: "SPACE M", meta: "6인실", row: "top" },
  { id: "A1", space: "SPACE A", meta: "4인실", row: "col" },
  { id: "A2", space: "SPACE A", meta: "4인실", row: "col" },
  { id: "A3", space: "SPACE A", meta: "4인실", row: "col" },
  { id: "A4", space: "SPACE A", meta: "4인실", row: "col" },
];
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// ── 포맷 helper ────────────────────────────────────────────
export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
export function hm(t: number) {
  const h = Math.floor(t);
  const m = Math.round((t - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
export function dur(t: number) {
  const h = Math.floor(t);
  const m = Math.round((t - h) * 60);
  if (h && m) return `${h}시간 ${m}분`;
  if (h) return `${h}시간`;
  return `${m}분`;
}
export function pct(t: number) {
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

/** 업로드된 엑셀(.xls/.xlsx)을 파싱한다. xlsx는 무거워서 호출 시점에만 동적 로드. */
export async function parseWorkbook(file: File): Promise<ParseResult> {
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

  // 예약이 0건인 파일도 정상으로 본다(그날 예약이 아예 없을 수 있음).
  // 형식(회의실·예약시간 열)은 위 헤더 검사에서 이미 확인했으므로 여기서 막지 않는다.

  // 주 날짜 = 예약에서 가장 많이 나온 날짜. 예약이 없으면 파일명(…YYYYMMDD…), 그것도 없으면 오늘.
  let dateStr = "";
  let max = -1;
  for (const [d, n] of dates) {
    if (n > max) {
      max = n;
      dateStr = d;
    }
  }
  if (!dateStr) {
    const fromName = file.name.match(/(\d{4})[-.]?(\d{2})[-.]?(\d{2})/);
    if (fromName) {
      dateStr = `${fromName[1]}-${fromName[2]}-${fromName[3]}`;
    } else {
      const t = new Date();
      dateStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(
        t.getDate(),
      ).padStart(2, "0")}`;
    }
  }
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

