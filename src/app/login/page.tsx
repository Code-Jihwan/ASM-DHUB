"use client";

import { useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { POLICY } from "@/lib/policy";

const OPEN = String(POLICY.displayOpenHour).padStart(2, "0");
const CLOSE = String(POLICY.displayCloseHour).padStart(2, "0");

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
          {/* 서면 지도 SVG 배경 */}
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full opacity-25"
            viewBox="0 0 800 600"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
          >
            <circle cx="400" cy="300" r="40" fill="none" stroke="white" strokeWidth="2" />
            <circle cx="400" cy="300" r="48" fill="none" stroke="white" strokeWidth="1" strokeDasharray="4 4" />
            <path
              d="M400,260 L400,-100 M400,340 L400,700 M360,300 L-100,300 M440,300 L900,300"
              stroke="white"
              strokeWidth="4"
              opacity="0.8"
            />
            <path
              d="M370,270 L100,-100 M430,330 L700,700 M430,270 L800,-100 M370,330 L-100,700"
              stroke="white"
              strokeWidth="2"
              opacity="0.6"
            />
            <path
              d="M100,0 L100,600 M200,0 L200,600 M300,0 L300,600 M500,0 L500,600 M600,0 L600,600 M700,0 L700,600"
              stroke="white"
              strokeWidth="0.5"
            />
            <path
              d="M0,100 L800,100 M0,200 L800,200 M0,400 L800,400 M0,500 L800,500"
              stroke="white"
              strokeWidth="0.5"
            />
            <rect x="220" y="120" width="60" height="40" fill="white" opacity="0.1" />
            <rect x="450" y="350" width="80" height="60" fill="white" opacity="0.1" />
            <rect x="520" y="150" width="40" height="100" fill="white" opacity="0.1" />
            <rect x="250" y="450" width="90" height="50" fill="white" opacity="0.1" />
            <rect x="380" y="280" width="40" height="40" fill="#FF6B00" opacity="0.2" />
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
