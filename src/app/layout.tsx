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
        {/* Pretendard. 시안이 이 폰트를 전제로 자간·굵기를 잡았다. */}
        <link
          rel="stylesheet"
          as="style"
          crossOrigin=""
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v3.2.1/dist/web/static/pretendard.css"
        />
      </head>
      {/* flex 컬럼으로 두면 자식의 mx-auto가 stretch를 끊고 max-content로 부풀어
          좁은 화면에서 가로로 넘친다. 블록으로 둔다. */}
      <body className="min-h-full bg-canvas text-neutral-900">{children}</body>
    </html>
  );
}
