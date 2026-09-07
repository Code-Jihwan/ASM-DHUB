import { createClient } from "@supabase/supabase-js";
import { parseRows } from "./meetingRooms";

// 서버 전용: 엑셀 바이트를 파싱해 회의실 스냅샷을 갱신한다(service_role, RLS 우회).
// /api/rooms/ingest(POST 수신)와 /api/rooms/cron(서버 fetch) 이 공유한다.
// 파싱 실패·크기 초과·DB 오류는 throw 하며, 호출 라우트가 상태코드로 매핑한다.

export type IngestSummary = {
  date: string;
  bookings: number; // 18F 예약완료 건수(주 날짜)
  cancelled: number;
  ignored: number; // 18F 외라 제외
  multiDate: boolean;
};

export async function ingestExcel(bytes: ArrayBuffer | Buffer, fileName: string): Promise<IngestSummary> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("서버 환경변수(NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)가 없습니다");
  }

  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("시트를 찾을 수 없습니다");
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "" });
  const parsed = parseRows(rows, fileName); // 헤더 없으면 throw(로그인 HTML 등 오염 저장 방지)

  // 스냅샷 크기 방어. 하루치 18F 스냅샷은 원래 수십 KB 수준이다.
  if (JSON.stringify(parsed).length > 1_000_000) {
    throw new Error("파싱 결과가 비정상적으로 큽니다");
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error } = await supabase.from("meeting_room_snapshot").upsert({
    id: 1,
    data: parsed,
    uploaded_by: null,
    uploaded_by_name: "자동 동기화 (SW마에스트로)",
    uploaded_at: new Date().toISOString(),
  });
  if (error) throw new Error(`DB 저장 실패: ${error.message}`);

  return {
    date: parsed.dateStr,
    bookings: parsed.bookings.length,
    cancelled: parsed.cancelledCount,
    ignored: parsed.ignoredCount,
    multiDate: parsed.multiDate,
  };
}
