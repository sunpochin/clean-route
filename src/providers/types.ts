// 檔案用途：縣市資料來源（provider）的共同介面與可注入的 fetcher 型別。
// 所在層：src/providers；AGENTS.md § 3.2 Provider 邊界的「合約」。刻意不依賴 Next.js（docs/DECISIONS.md D3）。
// 主要關聯：src/providers/new-taipei（實作）、src/providers/registry.ts（註冊）、src/server/next-fetcher.ts（Next 版 fetcher）。

import type { CityId, GarbageStop, GarbageTruck } from "@/domain/types";

/**
 * Provider 不直接呼叫全域 fetch，而是由執行環境注入。
 * 為什麼：快取方式因平台而異（Next data cache 的 `next.revalidate`、Cloudflare Cache API…），
 * 注入後 provider 可以原封不動搬到 Worker；單元測試也能直接餵假資料、不打網路。
 */
export type JsonFetcher = (url: string, options: { revalidateSeconds: number }) => Promise<unknown>;

/** 上游回應不可用（HTTP 錯誤、格式不符、資料量異常）。route handler 看到它要回 502，而不是空陣列。 */
export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly source: string,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export interface StopsResult {
  stops: GarbageStop[];
  /** 格式不符而被丟棄的原始筆數；非零時要能在 API meta 看見，不能靜默吞掉。 */
  skipped: number;
}

export interface CityProvider {
  city: CityId;
  displayName: string;
  fetchStops(fetcher: JsonFetcher): Promise<StopsResult>;
  fetchTrucks(fetcher: JsonFetcher): Promise<GarbageTruck[]>;
}
