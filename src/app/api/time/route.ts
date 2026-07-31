import { NextResponse } from "next/server";

// 클라이언트가 서버 시각에 자기 시계를 맞추려고 부른다(기기 시계가 틀려도 서버 기준으로 동작).
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ now: Date.now() });
}
