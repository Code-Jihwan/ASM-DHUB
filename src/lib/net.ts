import { headers } from "next/headers";
import { ipAllowed, normalizeIp, parseRules } from "./ipMatch";

/**
 * 센터 와이파이(=센터 공인 IP)에서 온 요청인지 서버에서 판별한다.
 * 브라우저는 와이파이 SSID를 읽을 수 없으므로, 요청의 공인 IP로 대신 판정한다.
 *
 * 허용 값은 환경변수 CENTER_IPS 에 나열한다. 단일 IP와 대역(CIDR)을 함께 쓸 수 있다.
 *   CENTER_IPS=115.22.60.18, 115.22.60.16/28
 * 구분자는 쉼표·공백·줄바꿈 아무거나 된다.
 * 비어 있으면 제한을 걸지 않는다(기능 off) — IP를 넣기 전까지는 어디서나 예약된다.
 *
 * 센터가 여러 회선으로 나가면 공인 IP가 하나가 아닐 수 있다. 그때 단일 IP만 등록해 두면
 * 다른 회선으로 나간 사람만 간헐적으로 차단된다. 대역으로 등록하면 그 문제가 사라진다.
 */

export async function getClientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  // Vercel은 이 헤더를 통째로 덮어써서 넘긴다(위조 방지). 맨 앞이 실제 클라이언트다.
  const raw = xff ? xff.split(",")[0] : (h.get("x-real-ip") ?? "");
  return normalizeIp(raw);
}

export type CenterCheck = {
  /** 센터에서 온 요청으로 볼 수 있는가 */
  allowed: boolean;
  /** CENTER_IPS가 설정돼 제한이 켜졌는가 */
  enforced: boolean;
  /** 감지된 공인 IP. 본인 IP라 화면에 보여 줘도 무방하며, 막혔을 때 원인 파악에 쓴다. */
  ip: string;
  /** IP 자체를 못 읽어 판정이 불가능했는가("센터 밖"과 구분하려고 따로 둔다) */
  unknown: boolean;
};

/** 지금 요청이 센터에서 온 것으로 봐도 되는가. enforced=false 면 제한이 꺼진 상태다. */
export async function isCenterRequest(): Promise<CenterCheck> {
  const rules = parseRules(process.env.CENTER_IPS);
  const ip = await getClientIp();

  if (rules.length === 0) return { allowed: true, enforced: false, ip, unknown: false };

  // IP를 못 읽으면 판정할 수 없다. Vercel에서는 헤더가 항상 오므로 사실상 나오지 않는 경로다.
  // 통과시키면 우회 구멍이 되므로 막되, 안내 문구는 "센터 밖"과 다르게 보여 준다.
  if (!ip) {
    console.warn("[wifi] 클라이언트 IP를 읽지 못해 판정 불가");
    return { allowed: false, enforced: true, ip: "", unknown: true };
  }

  const allowed = ipAllowed(rules, ip);
  if (!allowed) {
    // 막힌 요청만 남긴다. 눈에 안 보이는 문자까지 드러나도록 따옴표로 감싸 기록한다.
    console.warn(`[wifi] 차단: ip=${JSON.stringify(ip)} rules=${JSON.stringify(rules)}`);
  }
  return { allowed, enforced: true, ip, unknown: false };
}
