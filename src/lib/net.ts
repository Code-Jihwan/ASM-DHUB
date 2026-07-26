import { headers } from "next/headers";

/**
 * 센터 와이파이(=센터 공인 IP)에서 온 요청인지 서버에서 판별한다.
 * 브라우저는 와이파이 SSID를 읽을 수 없으므로, 요청의 공인 IP로 대신 판정한다.
 *
 * 허용 IP는 환경변수 CENTER_IPS 에 쉼표로 나열한다. 예:  CENTER_IPS=211.1.2.3,2001:db8::1
 * 비어 있으면 제한을 걸지 않는다(기능 off) — IP를 넣기 전까지는 어디서나 예약된다.
 */
function centerIps(): string[] {
  return (process.env.CENTER_IPS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function getClientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  // Vercel: "실제클라이언트IP, 프록시…" 형태. 맨 앞이 클라이언트다.
  if (xff) return xff.split(",")[0].trim();
  return h.get("x-real-ip") ?? "";
}

/** 지금 요청이 센터에서 온 것으로 봐도 되는가. enforced=false 면 제한이 꺼진 상태다. */
export async function isCenterRequest(): Promise<{ allowed: boolean; enforced: boolean }> {
  const allow = centerIps();
  if (allow.length === 0) return { allowed: true, enforced: false };
  const ip = await getClientIp();
  return { allowed: allow.includes(ip), enforced: true };
}
