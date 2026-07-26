import { NextResponse } from "next/server";
import { isCenterRequest } from "@/lib/net";

// 클라이언트가 "센터 와이파이인가"를 화면에 반영하려고 부른다. 실제 예약 강제는 server action이 한다.
export const dynamic = "force-dynamic";

export async function GET() {
  const { allowed, enforced } = await isCenterRequest();
  return NextResponse.json({ allowed, enforced });
}
