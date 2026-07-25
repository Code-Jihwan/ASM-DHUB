import { MobileHeader, MobileTabBar, Sidebar } from "./Sidebar";

type Props = {
  name: string;
  isAdmin: boolean;
  /**
   * fill   — 데스크톱에서 화면을 꽉 채우고 안쪽 패널이 각자 스크롤한다 (예약 화면).
   * scroll — 내용이 길어 본문이 통째로 스크롤된다 (관리자, 마이페이지).
   */
  variant?: "fill" | "scroll";
  children: React.ReactNode;
};

/**
 * 로그인 이후 모든 화면의 껍데기.
 *
 * 모바일에서는 fill 구조를 쓰면 좌석도가 눌려버리므로 언제나 문서 스크롤로 돌리고,
 * 하단 탭바에 가리지 않게 아래 여백을 준다.
 */
export function AppShell({ name, isAdmin, variant = "fill", children }: Props) {
  return (
    // 2단 배치는 lg부터다. md~lg에서는 우측 패널이 좌석도 아래로 내려가므로
    // 화면을 꽉 채우지 않고 문서가 그대로 스크롤되게 둔다.
    <div className="flex lg:h-dvh lg:overflow-hidden">
      <Sidebar name={name} isAdmin={isAdmin} />

      <div className="flex min-w-0 flex-1 flex-col lg:h-dvh">
        <MobileHeader name={name} />

        <main
          className={
            "min-h-0 flex-1 p-4 pb-24 md:p-6 md:pb-6 " +
            (variant === "fill" ? "lg:overflow-hidden" : "lg:overflow-y-auto scroll-thin")
          }
        >
          <div
            className={
              "mx-auto flex w-full max-w-[1600px] flex-col " +
              (variant === "fill" ? "lg:h-full" : "")
            }
          >
            {children}
          </div>
        </main>

        <MobileTabBar isAdmin={isAdmin} />
      </div>
    </div>
  );
}
