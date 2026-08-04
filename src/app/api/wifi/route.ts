import { NextResponse } from "next/server";
import { isCenterRequest } from "@/lib/net";

// 클라이언트가 "센터 와이파이인가"를 화면에 반영하려고 부른다. 실제 예약 강제는 server action이 한다.
export const dynamic = "force-dynamic";

export async function GET() {
  const { allowed, enforced, ip, unknown } = await isCenterRequest();
  // ip는 요청자 본인의 공인 IP다. 막혔을 때 원인을 바로 알 수 있게 함께 내려준다.
  // 허용 목록(CENTER_IPS)은 절대 내려보내지 않는다.
  return NextResponse.json({ allowed, enforced, ip, unknown });
}
