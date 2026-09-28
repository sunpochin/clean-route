// 檔案用途：App 根版面——語系、metadata、viewport，以及頂部標題列。
// 所在層：src/app（Next.js root layout）。
// 主要關聯：src/app/providers.tsx、src/app/globals.css、src/app/page.tsx。

import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "垃圾車雷達｜新北市附近垃圾車時間",
  description: "打開就知道附近的垃圾車幾點到、現在開到哪。資料來源：新北市政府資料開放平台。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 讓內容延伸到瀏海／Home indicator 區域，再由 env(safe-area-inset-*) 自行留白。
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1f7a4d" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1411" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-Hant-TW" className="h-full antialiased">
      <body className="flex h-dvh flex-col overflow-hidden">
        <header className="flex shrink-0 items-center gap-2 bg-accent px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-on-accent">
          <span aria-hidden className="text-2xl">
            🚛
          </span>
          <h1 className="text-xl font-bold">垃圾車雷達</h1>
          <span className="ml-auto text-sm opacity-90">新北市</span>
        </header>
        <Providers>
          <main className="flex min-h-0 flex-1 flex-col">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
