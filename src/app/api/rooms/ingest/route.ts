import { NextResponse } from "next/server";
import { ingestExcel } from "@/lib/ingestMeetingRooms";

// 회의실 예약 현황 수신 엔드포인트(POST).
// 로컬 크론 스크립트 등이 SW마에스트로에서 받은 엑셀 원본을 여기로 POST 하면,
// 서버가 파싱해 회의실 스냅샷을 갱신한다. 세션이 아니라 x-ingest-secret 헤더로 보호.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = req.headers.get("x-ingest-secret");
  if (!process.env.ROOMS_INGEST_SECRET || secret !== process.env.ROOMS_INGEST_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ab = await req.arrayBuffer();
  if (ab.byteLength === 0) {
    return NextResponse.json({ error: "빈 요청 본문(엑셀 바이트가 필요합니다)" }, { status: 400 });
  }
  // 프록시(미들웨어)가 본문을 기본 10MB까지만 버퍼링하므로, 그 아래로 캡을 둔다(잘림 후 부분 저장 방지).
  if (ab.byteLength > 8_000_000) {
    return NextResponse.json({ error: "파일이 너무 큽니다(최대 8MB)" }, { status: 413 });
  }
  const fileName = req.headers.get("x-file-name") || "회의실 예약 현황.xls";

  try {
    const summary = await ingestExcel(ab, fileName);
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    // 로그인 세션 만료(HTML) 등으로 파싱 실패하면 여기서 400 으로 거부 → 오염 저장 방지.
    return NextResponse.json(
      { error: "파싱/저장 실패(예약 현황 엑셀이 맞는지 확인하세요)", detail: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
