import { parseRules, normalizeIp, ipAllowed } from "../src/lib/ipMatch";

let pass = 0, fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got : ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); }
};

const CENTER = "115.22.60.18";

console.log("\n[1] 기존 동작 유지 — 단일 IP 정확 일치");
eq("등록 IP 통과", ipAllowed(["115.22.60.18"], CENTER), true);
eq("다른 IP 차단", ipAllowed(["115.22.60.18"], "1.2.3.4"), false);
eq("끝자리 다르면 차단", ipAllowed(["115.22.60.18"], "115.22.60.19"), false);
eq("빈 목록은 아무것도 통과 못함", ipAllowed([], CENTER), false);

console.log("[2] CIDR 대역");
eq("/28 안(.18)", ipAllowed(["115.22.60.16/28"], "115.22.60.18"), true);
eq("/28 안(.16 네트워크주소)", ipAllowed(["115.22.60.16/28"], "115.22.60.16"), true);
eq("/28 안(.31 끝)", ipAllowed(["115.22.60.16/28"], "115.22.60.31"), true);
eq("/28 밖(.15)", ipAllowed(["115.22.60.16/28"], "115.22.60.15"), false);
eq("/28 밖(.32)", ipAllowed(["115.22.60.16/28"], "115.22.60.32"), false);
eq("/32 는 단일 IP", ipAllowed(["115.22.60.18/32"], "115.22.60.18"), true);
eq("/32 다른 IP 차단", ipAllowed(["115.22.60.18/32"], "115.22.60.19"), false);
eq("/24 안", ipAllowed(["115.22.60.0/24"], "115.22.60.200"), true);
eq("/24 밖", ipAllowed(["115.22.60.0/24"], "115.22.61.1"), false);
eq("높은 옥텟(>2^31) /24 안", ipAllowed(["211.200.100.0/24"], "211.200.100.7"), true);
eq("높은 옥텟 /24 밖", ipAllowed(["211.200.100.0/24"], "211.200.101.7"), false);

console.log("[3] 잘못된 규칙은 조용히 무시(전원 통과 금지)");
eq("/33 무효", ipAllowed(["115.22.60.16/33"], "115.22.60.18"), false);
eq("/-1 무효", ipAllowed(["115.22.60.16/-1"], "115.22.60.18"), false);
eq("/abc 무효", ipAllowed(["115.22.60.16/abc"], "115.22.60.18"), false);
eq("빈 마스크 무효", ipAllowed(["115.22.60.16/"], "115.22.60.18"), false);
eq("쓰레기 값 무효", ipAllowed(["not-an-ip"], "115.22.60.18"), false);
eq("옥텟 초과 무효", ipAllowed(["115.22.60.999"], "115.22.60.18"), false);
eq("무효 규칙과 유효 규칙 혼재 시 유효한 쪽으로 통과", ipAllowed(["bad/99", CENTER], CENTER), true);

console.log("[4] /0 과 마스크 누락은 전면 거부(오타로 제한이 풀리면 안 됨)");
eq("/0 거부", ipAllowed(["0.0.0.0/0"], "8.8.8.8"), false);
eq("/0 거부(센터대역)", ipAllowed(["115.22.60.16/0"], "8.8.8.8"), false);
eq("/00 거부", ipAllowed(["115.22.60.16/00"], "8.8.8.8"), false);
eq("마스크 공백 거부", ipAllowed(["115.22.60.16/ "], "115.22.60.18"), false);
eq("마스크 3자리 거부", ipAllowed(["115.22.60.16/280"], "115.22.60.18"), false);
eq("/1 은 유효(광범위하지만 명시적)", ipAllowed(["0.0.0.0/1"], "8.8.8.8"), true);

console.log("[5] 표기 흔들림 흡수");
eq("선행 0", ipAllowed(["115.022.060.018"], CENTER), true);
eq("앞뒤 공백", ipAllowed([" 115.22.60.18 ".trim()], CENTER), true);
eq("IPv4-mapped 클라이언트", ipAllowed([CENTER], normalizeIp("::ffff:115.22.60.18")), true);
eq("IPv4-mapped 규칙", ipAllowed(["::ffff:115.22.60.18"], CENTER), true);

console.log("[6] 환경변수 파싱");
eq("단일", parseRules("115.22.60.18"), ["115.22.60.18"]);
eq("쉼표+공백", parseRules("115.22.60.18, 1.2.3.4"), ["115.22.60.18", "1.2.3.4"]);
eq("공백만", parseRules("115.22.60.18 1.2.3.4"), ["115.22.60.18", "1.2.3.4"]);
eq("줄바꿈", parseRules("115.22.60.18\n1.2.3.4"), ["115.22.60.18", "1.2.3.4"]);
eq("전각 쉼표", parseRules("115.22.60.18，1.2.3.4"), ["115.22.60.18", "1.2.3.4"]);
eq("제로폭 문자 제거", parseRules("115.22.60.18​"), ["115.22.60.18"]);
eq("BOM 제거", parseRules("﻿115.22.60.18"), ["115.22.60.18"]);
eq("빈 값", parseRules(""), []);
eq("undefined", parseRules(undefined), []);
eq("쉼표만", parseRules(",,,"), []);
eq("CIDR 포함", parseRules("115.22.60.16/28, 1.2.3.4"), ["115.22.60.16/28", "1.2.3.4"]);

console.log("[7] 실제 사고 시나리오 재현");
eq("제로폭 섞인 값도 이제 통과(과거엔 차단)", ipAllowed(parseRules("115.22.60​.18"), CENTER), true);
eq("전각 쉼표로 붙어있던 목록도 이제 분리", ipAllowed(parseRules("1.2.3.4，115.22.60.18"), CENTER), true);
eq("대역 등록 시 2번째 회선도 통과", ipAllowed(parseRules("115.22.60.16/28"), "115.22.60.20"), true);
eq("대역 등록해도 외부는 여전히 차단", ipAllowed(parseRules("115.22.60.16/28"), "121.55.1.9"), false);
eq("iCloud 릴레이 대역은 차단 유지", ipAllowed(parseRules("115.22.60.16/28"), "104.28.50.1"), false);

console.log(`\n결과: ${pass}개 통과, ${fail}개 실패`);
process.exit(fail === 0 ? 0 : 1);
