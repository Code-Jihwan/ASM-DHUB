"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { mountRibbon } from "@/lib/prismatic-ribbon";

// 상단 우측 장식용 코드 티커(데이터 바인딩 없음, 문구 그대로).
const TICKER = [
  "// SEAT ALLOCATOR",
  "GET /seats?center=dhub → 48",
  "POST /reservations 08:00–20:00",
  "CONFLICT → NEXT AVAILABLE",
  "OFF-HOURS → OPEN SEATING",
  "// 200 OK",
];

export default function Login() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 프리즈매틱 리본 애니메이션(framework-agnostic 모듈, 그대로 재사용).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return mountRibbon(canvas, { speed: 1, glow: 1.1 });
  }, []);

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
      setError("로그인에 실패했어요. 잠시 후 다시 시도해 주세요.");
    }
    // 성공하면 구글로 이동하므로 busy를 되돌릴 필요가 없다.
  }

  return (
    <div className="login-root">
      <canvas ref={canvasRef} className="ribbon" aria-hidden="true" />

      <div className="top">
        <div className="ticker" aria-hidden="true">
          {TICKER.map((line, i) => (
            <div key={line} style={{ animationDelay: `${i * 0.35}s` }}>
              {line}
            </div>
          ))}
        </div>
      </div>

      <div className="center">
        {/* AI·SW MAESTRO 로크업(핸드오프 자산, 로컬 정적 이미지). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="logo"
          src="/asm-logo-900.png"
          alt="AI·SW MAESTRO"
          width={900}
          height={131}
          decoding="async"
        />
        <h1>@@자리요</h1>
        <p className="meta">부산센터 D-HUB · 48석</p>
        <p className="meta-sub">예약 운영 08–20시</p>

        <div className="cta-row">
          <button className="cta" type="button" onClick={signIn} disabled={busy}>
            <span className="g-badge">
              <GoogleGlyph />
            </span>
            {busy ? "로그인 중…" : "구글 로그인"}
          </button>
        </div>

        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}

        <p className="note">
          첫 로그인 시 이름과 팀명을 최초 등록합니다.
          <br />
          08시–20시를 제외한 시간은 예약 없이 자유롭게 이용 가능합니다.
        </p>
      </div>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23 12.2c0-.8-.1-1.6-.2-2.3H12v4.4h6.1a5.3 5.3 0 0 1-2.3 3.4v2.9h3.7c2.2-2 3.5-5 3.5-8.4z"
      />
      <path
        fill="#34A853"
        d="M12 23.5c3.1 0 5.7-1 7.5-2.8l-3.7-2.9c-1 .7-2.3 1.1-3.8 1.1-3 0-5.5-2-6.4-4.7H1.8v3a11.5 11.5 0 0 0 10.2 6.3z"
      />
      <path
        fill="#FBBC05"
        d="M5.6 14.2a6.9 6.9 0 0 1 0-4.4v-3H1.8a11.5 11.5 0 0 0 0 10.4l3.8-3z"
      />
      <path
        fill="#EA4335"
        d="M12 5.1c1.7 0 3.2.6 4.4 1.7l3.3-3.2A11.5 11.5 0 0 0 1.8 6.8l3.8 3C6.5 7.1 9 5.1 12 5.1z"
      />
    </svg>
  );
}
