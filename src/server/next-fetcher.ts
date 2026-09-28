// 檔案用途：JsonFetcher 的 Next.js 實作——把 provider 要求的快取秒數轉成 Next data cache 的 `next.revalidate`。
// 所在層：src/server；只在 route handler（伺服器端）使用，是 provider 與 Next.js 之間唯一的接點（docs/DECISIONS.md D3）。
// 主要關聯：src/providers/types.ts（JsonFetcher 合約）、src/server/stop-cache.ts、src/app/api/trucks/route.ts。

import { UpstreamError, type JsonFetcher } from "@/providers/registry";

/** 政府 API 偶爾會卡住不回；沒有 timeout 時，使用者畫面會永遠停在「載入中」。 */
const UPSTREAM_TIMEOUT_MS = 15_000;

export const nextFetcher: JsonFetcher = async (url, { revalidateSeconds }) => {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      next: { revalidate: revalidateSeconds },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    throw new UpstreamError(`連線失敗：${error instanceof Error ? error.message : String(error)}`, url);
  }
  if (!response.ok) throw new UpstreamError(`HTTP ${response.status}`, url);
  try {
    return await response.json();
  } catch {
    throw new UpstreamError("回應不是合法 JSON", url);
  }
};
