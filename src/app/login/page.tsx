"use client";

import { useState } from "react";
import Image from "next/image";
import { Clock, MapPin } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { POLICY } from "@/lib/policy";

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
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      {/*
        배경: 부산센터 개발공간 사진.
        public/office.jpg 가 있으면 그걸 쓰고, 없어도 아래 그라데이션이 깔려 화면이 비지 않는다.
        blur-[2px] + scale-105 로 가장자리 흰 테두리가 생기지 않게 살짝 키운다.
      */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-slate-700 via-slate-800 to-slate-950">
        <Image
          src="/office.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="scale-105 object-cover blur-[2px]"
        />
        {/* 밝은 유리 카드가 뜨도록 사진을 눌러 준다. 아래쪽을 조금 더 어둡게 해 문구 대비를 확보. */}
        <div className="absolute inset-0 bg-slate-950/55" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/40 to-transparent" />
      </div>

      {/* 글래스모피즘 카드. 좌측에 로고·타이틀·캡슐, 우측에 마스코트. */}
      <div className="relative w-full max-w-[420px] overflow-hidden rounded-[28px] border border-white/30 bg-white/15 p-8 shadow-2xl shadow-black/40 backdrop-blur-2xl sm:max-w-[500px] sm:p-12">
        {/* 우측 마스코트(말풍선 포함 이미지). 여백을 잘라 캐릭터가 박스를 채운다. */}
        <Image
          src="/mascot.png"
          alt=""
          width={802}
          height={941}
          priority
          className="pointer-events-none absolute -right-1 top-1 w-28 select-none drop-shadow-lg sm:right-0 sm:top-2 sm:w-40"
        />

        {/* 상단 정보. 마스코트와 겹치지 않게 오른쪽 여백을 준다. */}
        <div className="relative pr-24 sm:pr-40">
          <Image
            src="/logo-asm.svg"
            alt="ASM"
            width={386}
            height={140}
            unoptimized
            priority
            className="h-9 w-auto drop-shadow-sm sm:h-11"
          />

          <h1 className="mt-6 text-[28px] font-black leading-tight tracking-tighter text-white drop-shadow-sm sm:mt-8 sm:text-[38px]">
            @@자리요
          </h1>
          <div className="mt-3.5 flex flex-col items-start gap-2 sm:mt-4">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-3 py-1.5 text-xs font-bold text-white/90 backdrop-blur-sm">
              <MapPin className="h-3.5 w-3.5" />
              부산센터 D-HUB · 48석
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-3 py-1.5 text-xs font-bold text-white/90 backdrop-blur-sm">
              <Clock className="h-3.5 w-3.5" />
              예약 {String(POLICY.displayOpenHour).padStart(2, "0")}–
              {String(POLICY.displayCloseHour).padStart(2, "0")}시
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={signIn}
          disabled={busy}
          className="mt-8 flex w-full items-center justify-center gap-3 rounded-2xl border border-white/50 bg-white/90 py-4 text-sm font-bold text-neutral-800 shadow-lg transition-all hover:bg-white hover:shadow-xl active:scale-[0.98] disabled:opacity-60 sm:mt-10 sm:py-5 sm:text-base"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.19 14.97 0 12 0A11 11 0 0 0 2.18 7.06L5.84 9.9c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          {busy ? "이동 중…" : "구글 로그인"}
        </button>

        {error && (
          <p role="alert" className="mt-3 text-sm font-bold text-red-100 drop-shadow-sm">
            {error}
          </p>
        )}

        <p className="mt-6 text-xs font-medium leading-relaxed text-white/70 sm:mt-8 sm:text-[13px]">
          첫 로그인 시 이름과 팀명을 최초 등록합니다.
          <br />
          {String(POLICY.displayOpenHour).padStart(2, "0")}시–
          {String(POLICY.displayCloseHour).padStart(2, "0")}시를 제외한 시간은 예약 없이 자유롭게
          이용 가능합니다.
        </p>
      </div>
    </main>
  );
}
