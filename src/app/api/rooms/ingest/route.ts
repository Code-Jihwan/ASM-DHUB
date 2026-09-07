import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { parseRows, type ParseResult } from "@/lib/meetingRooms";

// 회의실 예약 현황 자동 수신 엔드포인트.
// 크론(또는 스크립트)이 SW마에스트로에서 받은 엑셀 원본을 여기로 POST 하면,
// 서버가 파싱해 회의실 스냅샷(meeting_room_snapshot)을 통째로 갱신한다.
// 세션이 아니라 x-ingest-secret 헤더로 보호하고, 쓰기는 service_role 로 한다(RLS 우회).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = req.headers.get("x-ingest-secret");
  if (!process.env.ROOMS_INGEST_SECRET || secret !== process.env.ROOMS_INGEST_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    const missing: string[] = [];
    if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
    if (!serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    return NextResponse.json({ error: "missing env", missing }, { status: 500 });
  }

  // 원본 엑셀 바이트를 받는다.
  const ab = await req.arrayBuffer();
  if (ab.byteLength === 0) {
    return NextResponse.json({ error: "빈 요청 본문(엑셀 바이트가 필요합니다)" }, { status: 400 });
  }
  // 프록시(미들웨어)가 본문을 기본 10MB까지만 버퍼링하므로, 그 아래로 캡을 둔다(잘림 후 부분 저장 방지).
  if (ab.byteLength > 8_000_000) {
    return NextResponse.json({ error: "파일이 너무 큽니다(최대 8MB)" }, { status: 413 });
  }
  const fileName = req.headers.get("x-file-name") || "회의실 예약 현황.xls";

  // 서버에서 파싱. 로그인 세션이 만료돼 HTML 등이 오면 헤더를 못 찾아 400으로 거부된다(오염 저장 방지).
  let parsed: ParseResult;
  try {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(Buffer.from(ab), { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error("시트를 찾을 수 없습니다");
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "" });
    parsed = parseRows(rows, fileName);
  } catch (e) {
    return NextResponse.json(
      { error: "파싱 실패(예약 현황 엑셀이 맞는지 확인하세요)", detail: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  // 스냅샷 크기 방어(RPC 경로의 검증 대체). 하루치 18F 스냅샷은 원래 수십 KB 수준이다.
  if (JSON.stringify(parsed).length > 1_000_000) {
    return NextResponse.json({ error: "파싱 결과가 비정상적으로 큽니다" }, { status: 400 });
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error } = await supabase.from("meeting_room_snapshot").upsert({
    id: 1,
    data: parsed,
    uploaded_by: null,
    uploaded_by_name: "자동 동기화 (SW마에스트로)",
    uploaded_at: new Date().toISOString(),
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    date: parsed.dateStr,
    bookings: parsed.bookings.length, // 18F 예약완료 건수
    cancelled: parsed.cancelledCount,
    ignored: parsed.ignoredCount, // 18F 외라 제외
  });
}
