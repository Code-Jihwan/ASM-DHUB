"use client";

import { useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { POLICY } from "@/lib/policy";

const OPEN = String(POLICY.displayOpenHour).padStart(2, "0");
const CLOSE = String(POLICY.displayCloseHour).padStart(2, "0");

// 부산 실제 지형(amCharts KR-26 지오데이터를 등거리 투영). viewBox 0 0 1000 837.
// halftone 점 패턴으로 채워 배경 지도로 쓴다.
const BUSAN_PATH =
  "M996.6,119.9 977.5,126.6 970.7,132.2 964.7,143.1 956.8,164.9 957.2,171.1 963.4,192.2 962.2,200.3 946.8,250.2 928.3,249.0 929.5,259.8 926.1,268.7 910.4,266.7 907.2,271.4 911.0,280.2 919.5,283.2 933.3,280.2 941.2,275.5 946.8,285.9 947.8,310.4 932.7,341.7 922.3,360.1 917.7,375.3 904.4,374.6 899.8,365.7 894.4,369.2 893.8,381.5 884.3,394.3 901.0,423.7 899.4,433.8 889.7,433.8 892.1,444.2 887.1,448.3 889.3,460.6 878.7,466.0 872.1,456.4 867.0,459.9 866.4,468.7 860.8,472.2 839.5,474.9 834.5,484.5 836.7,493.3 834.5,508.3 827.3,522.1 811.2,525.5 803.4,537.1 786.1,532.4 777.7,524.8 768.2,524.0 755.4,526.0 749.1,530.9 744.7,543.9 740.9,543.9 724.6,537.8 716.2,525.5 710.2,520.6 708.0,537.8 696.3,539.8 682.3,536.3 673.4,542.5 668.4,554.0 674.4,557.5 674.4,572.5 670.0,573.9 660.6,583.5 662.2,588.2 678.4,587.0 682.3,590.4 684.5,600.5 693.5,622.4 696.3,635.4 692.3,653.8 688.5,658.0 692.3,676.4 685.1,677.7 665.6,664.6 650.5,664.6 648.3,675.0 644.3,675.7 624.8,671.5 626.0,653.8 618.6,650.4 618.2,663.4 590.7,664.6 576.8,658.0 572.4,652.3 574.6,634.6 581.2,631.2 581.2,615.5 566.2,606.1 556.7,616.9 553.9,623.1 545.7,629.2 538.3,627.3 528.2,633.9 521.6,646.2 526.6,654.6 517.8,666.8 497.1,681.8 492.1,691.4 487.6,729.5 476.4,725.6 470.4,731.7 476.4,743.3 479.2,757.5 484.8,762.5 474.2,771.3 467.0,787.0 460.1,774.7 459.7,758.3 450.3,743.3 444.7,717.2 446.3,710.6 423.4,714.5 431.8,767.1 438.4,789.7 442.9,797.1 435.6,808.7 422.8,806.0 422.8,795.9 419.6,774.7 406.7,765.9 398.9,767.1 392.6,781.4 406.1,784.8 402.3,793.7 403.3,802.8 393.3,797.8 378.8,799.8 393.3,817.0 383.8,819.7 373.8,835.5 368.1,837.4 365.3,827.1 371.6,810.1 370.4,799.8 365.9,799.8 354.9,791.7 349.3,776.7 337.4,720.7 337.4,709.9 343.6,699.5 346.5,689.2 349.3,655.8 337.0,654.6 333.0,666.1 329.6,691.4 319.1,700.3 305.1,707.6 301.9,694.1 302.3,682.6 309.5,654.6 312.3,648.4 303.5,646.2 299.5,664.1 289.0,689.2 266.1,698.8 262.1,704.9 261.7,723.4 226.6,723.4 226.6,707.2 237.0,663.4 237.0,642.3 248.2,626.5 225.9,618.4 224.7,636.9 215.9,650.4 213.7,697.6 208.7,704.9 205.3,723.4 187.4,722.1 174.5,718.0 173.5,712.6 111.1,712.6 107.0,701.0 93.2,694.9 79.1,677.7 74.1,692.6 61.3,693.4 55.2,696.8 41.2,696.1 35.1,702.2 33.5,711.1 26.7,719.4 16.7,724.1 5.6,722.9 0.0,713.3 0.6,704.9 6.0,700.3 16.7,682.6 27.3,686.5 35.1,685.8 39.6,672.2 30.7,670.8 22.9,675.7 12.9,676.4 18.3,665.4 12.9,655.8 12.9,643.0 18.3,635.4 19.5,626.8 23.7,616.7 75.5,595.3 166.7,570.7 169.7,494.3 175.7,463.8 224.5,457.7 260.9,433.3 306.7,405.8 394.9,402.9 425.2,369.2 443.5,326.4 460.3,322.2 461.1,313.1 481.2,297.4 509.5,282.7 532.6,262.5 565.2,244.3 604.1,251.2 626.0,222.4 644.3,164.7 680.7,109.6 735.5,100.5 784.1,97.3 796.3,57.8 835.9,15.0 859.0,0.0 864.8,7.1 865.8,23.6 950.2,23.6 978.7,52.1 1000.0,87.7 996.6,119.9ZM556.7,666.1 560.6,673.0 576.8,680.4 589.1,696.1 596.3,700.3 595.3,713.8 597.5,722.9 589.7,725.6 590.3,735.2 606.9,747.5 612.6,759.8 631.5,769.8 631.5,773.3 620.8,793.2 612.0,795.9 601.9,793.2 595.3,771.3 586.3,767.9 578.4,773.3 568.0,762.9 569.0,750.7 566.2,746.0 555.5,745.2 538.3,737.1 530.4,730.3 524.4,721.4 514.4,717.2 505.3,707.2 499.9,696.8 500.5,686.5 517.8,675.7 545.1,667.6 556.7,666.1Z";

export default function Login() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });

    if (error) {
      setBusy(false);
      setError(error.message);
    }
    // 성공하면 구글로 이동하므로 busy를 되돌릴 필요가 없다.
  }

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-white p-4 font-sans sm:p-6">
      {/* 레이어 스택. 높이를 확정값으로 둬 모바일에서도 무너지지 않게 한다. */}
      <div className="relative h-[600px] w-full max-w-[1500px] sm:h-[700px]">
        {/* Layer 1: 뒤 (코드 스페이스) */}
        <div className="rise-in absolute left-[7.5%] top-0 h-[400px] w-[85%] overflow-hidden rounded-t-xl border border-white/5 bg-[#11132C] p-6 shadow-xl sm:h-[460px] sm:p-8">
          <pre className="font-mono text-xs leading-relaxed text-[#4A5D9A] sm:text-sm">
            <span className="text-[#6D83D4]">class</span>{" "}
            <span className="text-white">DHUB_Reservation</span>:<br />
            {"    "}
            <span className="text-[#6D83D4]">def</span>{" "}
            <span className="text-[#E2B93D]">__init__</span>(self):
            <br />
            {"        "}self.center = <span className="text-[#72A875]">&quot;AI·SW마에스트로 부산센터&quot;</span>
            <br />
            {"        "}self.room = <span className="text-[#72A875]">&quot;D-HUB&quot;</span>
            <br />
            {"        "}self.latitude = <span className="text-[#FF875F]">35.1574377402408</span>
            <br />
            {"        "}self.longitude = <span className="text-[#FF875F]">129.060435030175</span>
            <br />
            {"        "}self.network_status = <span className="text-[#E2B93D]">True</span>
            <br />
            <br />
            {"    "}
            <span className="text-[#6D83D4]">def</span>{" "}
            <span className="text-[#E2B93D]">authenticate</span>(self, user):
            <br />
            {"        "}
            <span className="text-[#6D83D4]">if</span>{" "}
            <span className="text-[#E2B93D]">not</span> user.is_verified():
            <br />
            {"            "}
            <span className="text-[#6D83D4]">return</span> System.login_required()
            <br />
            {"        "}
            <span className="text-[#6D83D4]">return</span> self.grant_access()
          </pre>
        </div>

        {/* Layer 2: 중간 (부산센터 개발공간 사진) */}
        <div
          className="rise-in absolute left-[4%] top-[9%] h-[420px] w-[92%] overflow-hidden rounded-t-xl border border-white/10 shadow-2xl sm:h-[500px]"
          style={{ animationDelay: "0.1s" }}
        >
          <Image
            src="/office.jpg"
            alt=""
            fill
            priority
            sizes="(max-width: 768px) 92vw, 900px"
            className="object-cover"
          />
          {/* 사진을 테마 색으로 눌러 준다 */}
          <div className="absolute inset-0 bg-[#0022AA]/40 mix-blend-multiply" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#1A25A8] via-transparent to-transparent opacity-80" />
          <div className="absolute left-8 top-6 font-mono text-xs tracking-widest text-white/50">
            CAM_01 // D-HUB INTERIOR
          </div>
        </div>

        {/* Layer 3: 앞 (로그인 / 지도 인터페이스) */}
        <div
          className="rise-in absolute bottom-0 left-0 z-10 h-[520px] w-full overflow-hidden rounded-xl border border-[#3A45C8] bg-[#1A25A8] shadow-[0_30px_70px_-20px_rgba(26,37,168,0.55)] sm:h-[620px]"
          style={{ animationDelay: "0.2s" }}
        >
          {/* 부산 지도 halftone 배경 */}
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 1000 837"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
          >
            <defs>
              <pattern id="halftone" width="13" height="13" patternUnits="userSpaceOnUse">
                <circle cx="6.5" cy="6.5" r="2" fill="#9fc0f5" />
              </pattern>
            </defs>
            {/* 옅은 격자(블루프린트 느낌) */}
            <path
              d="M0,140H1000M0,280H1000M0,420H1000M0,560H1000M0,700H1000M170,0V837M340,0V837M510,0V837M680,0V837M850,0V837"
              stroke="white"
              strokeWidth="1"
              opacity="0.06"
            />
            {/* 부산 지형을 점으로 채움 + 해안선 */}
            <path d={BUSAN_PATH} fill="url(#halftone)" opacity="0.6" />
            <path d={BUSAN_PATH} fill="none" stroke="#cddbf6" strokeWidth="1.4" opacity="0.4" />
          </svg>

          {/* 헤더 */}
          <div className="absolute left-0 right-0 top-6 z-20 text-center">
            <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-white/80 sm:text-lg">
              AI·SW MAESTRO BUSAN
            </h2>
          </div>

          {/* 좌측 좌표 */}
          <div className="absolute left-8 top-24 z-20 hidden font-mono text-sm leading-relaxed tracking-widest text-white/70 md:block">
            LAT: 35.1574° N
            <br />
            LNG: 129.0604° E
          </div>

          {/* 좌측 점선 아크 + 오렌지 박스 */}
          <svg className="pointer-events-none absolute left-32 top-24 z-20 hidden h-64 w-32 overflow-visible md:block" aria-hidden="true">
            <path d="M0,0 Q50,50 10,200" fill="none" stroke="#FF6B00" strokeWidth="2" strokeDasharray="6 6" />
            <rect x="-6" y="-6" width="12" height="12" fill="#FF6B00" />
          </svg>

          <div className="absolute bottom-24 left-12 z-20 hidden items-center gap-3 md:flex">
            <div className="flex flex-col">
              <span className="text-lg font-bold tracking-tight text-[#FF6B00]">
                AI·SW마에스트로 부산센터
              </span>
              <span className="font-mono text-xs tracking-wider text-[#FF6B00]/80">
                SEOMYEON, BUSAN
              </span>
            </div>
            <div className="h-3 w-3 bg-[#FF6B00]" />
          </div>

          {/* 우측 D-HUB 태그 */}
          <div className="absolute right-12 top-24 z-20 hidden items-center gap-2 md:flex">
            <div className="h-4 w-4 bg-[#F9F871]" />
            <span className="font-bold tracking-wider text-[#F9F871]">D-HUB</span>
          </div>

          {/* 우측 점선 아크 */}
          <svg className="pointer-events-none absolute right-32 top-32 z-20 hidden h-64 w-32 overflow-visible md:block" aria-hidden="true">
            <path
              d="M0,0 Q-80,100 -50,220"
              fill="none"
              stroke="#F9F871"
              strokeWidth="2"
              strokeDasharray="6 6"
              markerEnd="url(#arrow)"
            />
            <defs>
              <marker
                id="arrow"
                viewBox="0 0 10 10"
                refX="5"
                refY="5"
                markerWidth="4"
                markerHeight="4"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#F9F871" />
              </marker>
            </defs>
          </svg>

          {/* 우하단 코드 디테일 */}
          <div className="absolute bottom-12 right-12 z-20 hidden text-right font-mono text-xs leading-loose tracking-widest text-white/50 md:block">
            SYS.INIT = [<br />
            &nbsp;&nbsp;VERIFY_USER();
            <br />
            &nbsp;&nbsp;ALLOCATE_SEAT();
            <br />
            &nbsp;&nbsp;LAUNCH();
            <br />]
          </div>

          {/* 가운데: 로그인 인터페이스 */}
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center px-6">
            {/* 뒤 워터마크 */}
            <div className="pointer-events-none absolute select-none text-7xl font-black leading-none tracking-tighter text-white/[0.06] sm:text-[13rem]">
              D-HUB
            </div>

            <div className="relative w-full max-w-[360px] rounded-lg border border-[#3A45C8]/50 bg-[#050A24]/60 p-6 shadow-2xl backdrop-blur-md sm:p-7">
              {/* 터미널 헤더 */}
              <div className="mb-5 border-b border-white/10 pb-4">
                <div className="mb-3 flex items-center gap-2">
                  <div className="h-2 w-2 animate-pulse bg-[#F9F871] shadow-[0_0_8px_#F9F871]" />
                  <h3 className="text-xl font-bold tracking-tight text-white">@@자리요</h3>
                </div>

                <div className="flex flex-col gap-1.5 font-mono text-[11px] text-white/70">
                  <div className="flex items-center gap-2">
                    <span className="text-[#FF6B00]">LOC_</span>
                    <span>부산센터 D-HUB (48석)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[#FF6B00]">TIME_</span>
                    <span>
                      예약 {OPEN}:00 – {CLOSE}:00
                    </span>
                  </div>
                </div>
              </div>

              {/* 로그인 버튼 */}
              <button
                type="button"
                onClick={signIn}
                disabled={busy}
                className="flex w-full items-center justify-center gap-3 rounded bg-white px-4 py-3 text-sm font-bold text-black shadow-[0_0_15px_rgba(255,255,255,0.1)] transition-colors hover:bg-zinc-200 disabled:opacity-60"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                {busy ? "이동 중…" : "구글 로그인"}
              </button>

              {error && (
                <p role="alert" className="mt-3 text-[11px] font-bold text-red-300">
                  {error}
                </p>
              )}

              {/* 안내 */}
              <div className="mt-5 font-mono text-[10px] leading-relaxed text-white/40">
                <p className="mb-0.5 text-white/30">{"/* NOTICE */"}</p>
                <div className="border-l border-white/10 pl-2">
                  <p>- 첫 로그인 시 이름/팀명 최초 등록</p>
                  <p>
                    - {OPEN}~{CLOSE}시 외 예약 없이 자유 이용
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
