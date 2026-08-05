import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "@@자리요 · 부산센터 D-HUB 예약",
  description: "부산센터 D-HUB 48석 좌석 예약",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f8f9fa",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        {/* Pretendard. 시안이 이 폰트를 전제로 자간·굵기를 잡았다.
            dynamic-subset은 글자 범위별로 잘라 둔 판이라, 화면에 실제 쓰인 글자 조각만
            내려받는다. 전체 웨이트를 통째로 받는 static 판(웨이트당 약 790KB)보다 훨씬 가볍다.
            버전을 고정한다. latest는 예고 없이 바뀌어 자간·글자폭이 흔들릴 수 있다. */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/static/pretendard-dynamic-subset.css"
        />
      </head>
      {/* flex 컬럼으로 두면 자식의 mx-auto가 stretch를 끊고 max-content로 부풀어
          좁은 화면에서 가로로 넘친다. 블록으로 둔다. */}
      <body className="min-h-full bg-canvas text-neutral-900">{children}</body>
    </html>
  );
}
