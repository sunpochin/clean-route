// 檔案用途：Next.js 設定——目前只放安全與隱私相關的 HTTP headers。
// 所在層：repository root。
// 主要關聯：AGENTS.md § 3.5（位置隱私）。

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // 只有本站自己能要求定位；嵌入的第三方 iframe 一律不行，相機麥克風完全用不到就關掉。
          { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=()" },
          // 對外連結（例如地圖圖磚）只帶來源網域，不帶完整網址。
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
