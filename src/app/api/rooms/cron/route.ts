import { NextResponse } from "next/server";
import { ingestExcel } from "@/lib/ingestMeetingRooms";

// 회의실 예약 현황 자동 동기화(서버 크론). 맥 없이 Vercel Cron 이 이 라우트를 하루 5번 호출한다.
// SW마에스트로에서 '오늘'(KST) 엑셀을 직접 받아 → 파싱 → 스냅샷 갱신.
// Vercel Cron 은 CRON_SECRET 설정 시 Authorization: Bearer <CRON_SECRET> 를 보낸다 → 그걸로 보호.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MENU_NO = "100240";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cookie = process.env.SWM_COOKIE;
  if (!cookie) {
    return NextResponse.json({ error: "SWM_COOKIE 미설정" }, { status: 500 });
  }

  // '오늘'은 한국 시간 기준. (Vercel 은 UTC라 그냥 Date 를 쓰면 하루 밀릴 수 있다.)
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  const src =
    `https://www.swmaestro.ai/busan/bos/item/itemRent/downloadExcel.uxls` +
    `?menuNo=${MENU_NO}&sdate=${today}&edate=${today}&searchStat=&searchCnd=1&searchWrd=&pageIndex=1`;

  let ab: ArrayBuffer;
  try {
    const res = await fetch(src, {
      headers: { cookie, "user-agent": "Mozilla/5.0" },
      redirect: "manual", // 세션 만료 리다이렉트를 따라가지 않고 그대로 받아 아래서 걸러낸다.
      cache: "no-store",
    });
    ab = await res.arrayBuffer();
  } catch (e) {
    return NextResponse.json(
      { error: "SW마에스트로 다운로드 실패", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  // 로그인 세션이 만료되면 엑셀 대신 HTML(로그인/리다이렉트)이 온다.
  // 엑셀 매직바이트(PK=50 4b / OLE2=d0 cf)가 아니면 저장하지 않고 실패로 남긴다(오염 방지).
  const sig = new Uint8Array(ab.slice(0, 2));
  const isXls = (sig[0] === 0x50 && sig[1] === 0x4b) || (sig[0] === 0xd0 && sig[1] === 0xcf);
  if (!isXls) {
    return NextResponse.json(
      { error: "엑셀이 아님 — SW마에스트로 로그인 세션 만료 추정. SWM_COOKIE 갱신 필요.", bytes: ab.byteLength },
      { status: 502 },
    );
  }

  try {
    const summary = await ingestExcel(ab, `회의실 예약 현황_${today}.xls`);
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    return NextResponse.json(
      { error: "파싱/저장 실패", detail: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
