"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, ChartPie, LogOut, Map, Megaphone, Settings, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Props = {
  name: string;
  isAdmin: boolean;
};

type NavItem = { href: string; label: string; icon: LucideIcon };

function navItems(isAdmin: boolean): NavItem[] {
  const items: NavItem[] = [
    { href: "/", label: "좌석 예약", icon: Map },
    { href: "/guide", label: "사용 방법", icon: BookOpen },
    { href: "/me", label: "마이페이지", icon: User },
  ];
  // 관리자가 아니면 눌러도 서버에서 되돌려보내므로 아예 감춘다.
  // 라벨을 짧게 둔다. 모바일 하단 탭은 폭을 균등 분할해서, 길면 좁은 화면에서 넘친다.
  if (isAdmin) {
    items.push({ href: "/admin", label: "관리자페이지", icon: Settings });
    items.push({ href: "/stats", label: "이용 분석", icon: ChartPie });
    items.push({ href: "/announcement", label: "팝업 공지", icon: Megaphone });
  }
  return items;
}

async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  window.location.href = "/login";
}

/**
 * ASM 워드마크 + 서비스명.
 * public/logo-asm.svg 는 "Symbol Mark.ai"(PDF 호환)를 벡터 그대로 변환한 것이다.
 * 가로:세로가 약 2.76:1이라 높이만 고정하고 폭은 흐르게 둔다.
 * SVG라 Next 이미지 최적화를 태울 이유가 없어 unoptimized로 내보낸다.
 */
function Logo({ height = "h-6" }: { height?: string }) {
  return (
    <Link
      href="/"
      aria-label="@@자리요 좌석 예약"
      className="flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20"
    >
      <Image
        src="/logo-asm.svg"
        alt="ASM"
        width={193}
        height={70}
        unoptimized
        priority
        className={`${height} w-auto shrink-0`}
      />
      <span className="h-4 w-px shrink-0 bg-neutral-200" />
      <h1 className="text-lg font-black tracking-tighter text-neutral-900">@@자리요</h1>
    </Link>
  );
}

/** 데스크톱 좌측 내비. 모바일에서는 감추고 MobileTabBar가 대신한다. */
export function Sidebar({ name, isAdmin }: Props) {
  const pathname = usePathname();
  const items = navItems(isAdmin);

  return (
    <aside className="z-10 hidden h-dvh w-[240px] shrink-0 flex-col border-r border-neutral-200 bg-white shadow-[4px_0_24px_rgba(0,0,0,0.02)] md:flex">
      <div className="px-6 py-7">
        <Logo />
      </div>

      <nav className="flex flex-col gap-1.5 px-5 py-2">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3.5 rounded-xl px-4 py-3 text-sm font-bold transition-all ${
                active
                  ? "bg-neutral-900 text-white shadow-md"
                  : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900"
              }`}
            >
              <Icon className={`h-5 w-5 ${active ? "text-white" : "text-neutral-400"}`} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-neutral-100 bg-neutral-50/50 p-5">
        <p className="px-4 pb-2 text-sm font-bold text-neutral-900">{name}</p>
        <button
          type="button"
          onClick={signOut}
          className="flex w-full items-center gap-3.5 rounded-xl px-4 py-3 text-sm font-bold text-red-500 transition-all hover:bg-red-50 hover:text-red-600"
        >
          <LogOut className="h-5 w-5" />
          로그아웃
        </button>
      </div>
    </aside>
  );
}

/** 모바일 상단 바. 로고와 이름만 둔다. */
export function MobileHeader({ name }: { name: string }) {
  return (
    <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-5 py-3.5 md:hidden">
      <Logo />
      <span className="text-sm font-bold text-neutral-500">{name}</span>
    </header>
  );
}

/** 모바일 하단 탭바. 사이드바 항목에 로그아웃을 더한다. */
export function MobileTabBar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const items = navItems(isAdmin);

  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 grid grid-flow-col border-t border-neutral-200 bg-white/95 backdrop-blur md:hidden">
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-bold transition-colors ${
              active ? "text-neutral-900" : "text-neutral-400"
            }`}
          >
            <Icon className="h-5 w-5" />
            {label}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={signOut}
        className="flex flex-col items-center gap-1 py-2.5 text-[11px] font-bold text-red-500"
      >
        <LogOut className="h-5 w-5" />
        로그아웃
      </button>
    </nav>
  );
}
