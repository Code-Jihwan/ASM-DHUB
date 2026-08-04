/**
 * 공인 IP 허용 판정에 쓰는 순수 로직. next/headers 같은 런타임 의존이 없어 단독으로 검증할 수 있다.
 * 판정이 틀리면 전원 차단이나 전원 통과로 이어지므로, 여기 함수들은 테스트로 고정해 둔다.
 */

/** 허용 규칙 목록으로 파싱. 눈에 안 보이는 문자와 전각 쉼표까지 걸러 낸다(복붙 사고 방지). */
export function parseRules(raw: string | undefined): string[] {
  return (raw ?? "")
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, "")
    .split(/[,\uFF0C\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** "::ffff:1.2.3.4"(IPv4-mapped) 표기를 순수 IPv4로 되돌리고 소문자로 맞춘다. */
export function normalizeIp(raw: string): string {
  const ip = raw.trim().toLowerCase();
  const m = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  return m ? m[1] : ip;
}

/** IPv4 문자열을 32비트 정수로. IPv4가 아니면 null. 선행 0(115.022.060.018)도 받아 준다. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out = out * 256 + n;
  }
  return out;
}

/** 규칙 하나(단일 IP 또는 CIDR)가 이 IP를 포함하는가. */
export function ruleMatches(rule: string, ip: string): boolean {
  const slash = rule.indexOf("/");

  if (slash === -1) {
    const a = ipv4ToInt(normalizeIp(rule));
    const b = ipv4ToInt(ip);
    // IPv4끼리는 수치로 비교해 표기 차이(선행 0 등)를 흡수한다. 그 외(IPv6)는 문자열 비교.
    if (a !== null && b !== null) return a === b;
    return normalizeIp(rule) === ip;
  }

  // CIDR. 현재 서비스는 IPv4 전용(도메인에 AAAA 레코드가 없다)이라 IPv4 대역만 계산한다.
  const net = ipv4ToInt(normalizeIp(rule.slice(0, slash)));
  const addr = ipv4ToInt(ip);
  if (net === null || addr === null) return false;

  // 마스크는 숫자만 허용한다. "115.22.60.16/" 처럼 비어 있으면 Number("")가 0이 되어
  // /0(전 세계 허용)으로 새는데, 오타 하나로 제한이 통째로 풀리면 안 된다.
  // /0 자체도 막는다. 제한을 끄려면 CENTER_IPS를 비우는 정식 경로가 따로 있다.
  const maskStr = rule.slice(slash + 1);
  if (!/^\d{1,2}$/.test(maskStr)) return false;
  const bits = Number(maskStr);
  if (bits < 1 || bits > 32) return false;

  const mask = (-1 << (32 - bits)) >>> 0;
  return ((net & mask) >>> 0) === ((addr & mask) >>> 0);
}

/** 규칙 목록 중 하나라도 이 IP를 포함하는가. */
export function ipAllowed(rules: string[], ip: string): boolean {
  return rules.some((r) => ruleMatches(r, ip));
}
