import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cloudflared 터널로 외부에서 개발 서버에 붙일 때 필요하다.
  // 배포하면 필요 없다.
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default nextConfig;
