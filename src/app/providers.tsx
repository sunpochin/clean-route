"use client";

// 檔案用途：瀏覽器端的全域 Provider（目前只有 TanStack Query 的 QueryClient）。
// 所在層：src/app；由 layout.tsx 包住整個 App。
// 主要關聯：src/hooks/useNearbyStops.ts、src/hooks/useTrucks.ts。

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  // 用 useState 建立：放在模組層級會讓伺服器端 render 時不同請求共用同一個快取。
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // 上游失敗時重試 1 次就好：政府 API 掛掉時多試幾次只會讓使用者多等，錯誤畫面要盡快出現。
          queries: { retry: 1, refetchOnWindowFocus: true },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
