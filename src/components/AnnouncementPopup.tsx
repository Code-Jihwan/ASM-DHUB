"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Announcement } from "@/lib/types";

const SEEN_KEY = "asm-notice-seen";

/**
 * 맥OS 창 느낌의 미니멀 공지 창. 작성 미리보기와 실제 팝업이 함께 쓴다.
 * 신호등 3색 + 얇은 타이틀바 + 텍스트 본문.
 */
export function NoticeWindow({
  title,
  body,
  onClose,
}: {
  title: string;
  body: string;
  onClose?: () => void;
}) {
  return (
    <div className="w-full max-w-[440px] overflow-hidden rounded-xl border border-black/10 bg-white shadow-2xl">
      {/* 타이틀 바 */}
      <div className="relative flex items-center border-b border-black/5 bg-neutral-100 px-4 py-3">
        <span className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="group flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#ff5f57] transition-transform hover:scale-110"
          >
            <span className="text-[8px] font-black leading-none text-black/50 opacity-0 group-hover:opacity-100">
              ✕
            </span>
          </button>
          <span className="h-3.5 w-3.5 rounded-full bg-[#febc2e]" />
          <span className="h-3.5 w-3.5 rounded-full bg-[#28c840]" />
        </span>
        <span className="absolute left-1/2 -translate-x-1/2 text-xs font-bold text-neutral-500">
          공지
        </span>
      </div>

      {/* 본문 */}
      <div className="px-6 py-6">
        {title.trim() && (
          <h2 className="text-lg font-black tracking-tight text-neutral-900">{title}</h2>
        )}
        <p
          className={
            "whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-600 " +
            (title.trim() ? "mt-2" : "")
          }
        >
          {body.trim() || "표시할 내용이 없습니다."}
        </p>
      </div>

      {onClose && (
        <div className="flex justify-end border-t border-black/5 px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-bold text-white transition-all hover:bg-black active:scale-[0.98]"
          >
            확인
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 로그인 후 예약 화면에 뜨는 팝업. active 공지가 있고, 이번 버전(updated_at)을
 * 아직 안 봤으면 띄운다. 닫으면 그 버전을 봤다고 기록해 다시 안 뜬다.
 */
export function AnnouncementPopup() {
  const [ann, setAnn] = useState<Announcement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("announcement")
      .select("id, title, body, active, updated_at")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        const a = data as Announcement;
        const hasText = a.title.trim() !== "" || a.body.trim() !== "";
        const seen = localStorage.getItem(SEEN_KEY);
        if (a.active && hasText && seen !== a.updated_at) setAnn(a);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ann) return null;

  function close() {
    if (ann) localStorage.setItem(SEEN_KEY, ann.updated_at);
    setAnn(null);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={close}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
    >
      <div onClick={(e) => e.stopPropagation()}>
        <NoticeWindow title={ann.title} body={ann.body} onClose={close} />
      </div>
    </div>
  );
}
