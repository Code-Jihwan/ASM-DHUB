"use client";

import { useEffect, useState } from "react";
import { Share, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const IOS_HINT_KEY = "push-ios-hint-dismissed";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/** 이 기기의 푸시 구독을 만들고 DB에 저장(있으면 갱신). */
async function subscribeAndSave() {
  if (!VAPID) return;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID) as BufferSource,
    });
  }
  const keys = sub.toJSON().keys;
  if (!keys?.p256dh || !keys?.auth) return;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("push_subscription").upsert(
    {
      user_id: user.id,
      endpoint: sub.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      ua: navigator.userAgent,
    },
    { onConflict: "endpoint" },
  );
}

/**
 * 로그인 이후 모든 화면에서 동작. 버튼 없이 알림을 켠다.
 *  - 지원 브라우저(PC·안드로이드): 첫 상호작용 때 브라우저 기본 권한 팝업을 띄우고,
 *    허용하면 구독을 저장한다(한 번 허용하면 다시 안 물음).
 *  - 아이폰(사파리, 홈 화면 미설치): 푸시 자체가 불가 → 1회성 안내만 띄운다.
 */
export function PushAutoEnable() {
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    // VAPID 공개키(NEXT_PUBLIC_VAPID_PUBLIC_KEY)가 설정되기 전엔 완전히 비활성.
    // → 배포만 되고 서버 세팅(env/마이그레이션/크론) 전이면 권한 팝업도 안 뜬다.
    if (!VAPID) return;

    const supported =
      "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

    const ua = navigator.userAgent;
    const isIOS = /iphone|ipad|ipod/i.test(ua);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;

    if (!supported) {
      // 아이폰 사파리(미설치)에서 푸시 불가 → 홈 화면 추가 안내(한 번만)
      if (isIOS && !standalone) {
        let dismissed = false;
        try {
          dismissed = localStorage.getItem(IOS_HINT_KEY) === "1";
        } catch {
          dismissed = false;
        }
        // 이펙트 본문에서 동기 setState를 피한다(React Compiler 규칙).
        if (!dismissed) queueMicrotask(() => setIosHint(true));
      }
      return;
    }

    let cleanup: (() => void) | undefined;

    (async () => {
      try {
        await navigator.serviceWorker.register("/sw.js");
      } catch {
        return;
      }

      if (Notification.permission === "granted") {
        void subscribeAndSave();
        return;
      }
      if (Notification.permission === "denied") return;

      // 아직 결정 전(default): 첫 사용자 상호작용에 브라우저 기본 팝업을 띄운다(우리 버튼 없이).
      const onFirst = () => {
        cleanup?.();
        Notification.requestPermission()
          .then((perm) => {
            if (perm === "granted") return subscribeAndSave();
          })
          .catch(() => {});
      };
      cleanup = () => {
        window.removeEventListener("pointerdown", onFirst);
        window.removeEventListener("keydown", onFirst);
      };
      window.addEventListener("pointerdown", onFirst, { once: true });
      window.addEventListener("keydown", onFirst, { once: true });
    })();

    return () => cleanup?.();
  }, []);

  function dismissIos() {
    setIosHint(false);
    try {
      localStorage.setItem(IOS_HINT_KEY, "1");
    } catch {
      // localStorage 불가여도 무시
    }
  }

  if (!iosHint) return null;

  return (
    <div className="pb-safe fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-3 md:hidden">
      <div className="flex w-full max-w-[420px] items-center gap-3 rounded-2xl border border-neutral-200 bg-neutral-900 px-4 py-3 text-white shadow-xl">
        <Share className="h-5 w-5 shrink-0 text-white/80" />
        <p className="min-w-0 flex-1 text-[13px] font-bold leading-snug">
          알림을 받으려면 <b className="font-black">공유 → 홈 화면에 추가</b> 후 열어 주세요.
        </p>
        <button
          type="button"
          onClick={dismissIos}
          aria-label="닫기"
          className="shrink-0 rounded-lg p-1 text-white/60 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
