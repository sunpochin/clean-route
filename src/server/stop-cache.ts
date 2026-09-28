// 檔案用途：清運點資料的程序內（in-process）記憶體快取，含 TTL、同時請求合併與「刷新失敗沿用舊資料」策略。
// 所在層：src/server；Next data cache 之上的第二層快取，避免每個 /api/nearby 請求都重新組 27 頁、2.6 萬筆資料。
// 主要關聯：src/app/api/nearby/route.ts、src/providers/registry.ts、docs/DECISIONS.md D2／D4。

import type { CityId, GarbageStop } from "@/domain/types";
import { getProvider, type JsonFetcher } from "@/providers/registry";
import { nextFetcher } from "./next-fetcher";

const TTL_MS = 12 * 60 * 60 * 1000;

export interface StopSnapshot {
  stops: GarbageStop[];
  skipped: number;
  loadedAt: Date;
}

interface CacheEntry {
  snapshot?: StopSnapshot;
  inflight?: Promise<StopSnapshot>;
}

const cache = new Map<CityId, CacheEntry>();

async function load(city: CityId, fetcher: JsonFetcher): Promise<StopSnapshot> {
  const { stops, skipped } = await getProvider(city).fetchStops(fetcher);
  return { stops, skipped, loadedAt: new Date() };
}

export async function getStopSnapshot(city: CityId, fetcher: JsonFetcher = nextFetcher): Promise<StopSnapshot> {
  const entry = cache.get(city) ?? {};
  cache.set(city, entry);

  const fresh = entry.snapshot && Date.now() - entry.snapshot.loadedAt.getTime() < TTL_MS;
  if (fresh) return entry.snapshot!;

  // 冷啟動時多個請求同時進來，只能有一個真的去抓上游，其他人等同一個 Promise。
  entry.inflight ??= load(city, fetcher).finally(() => {
    entry.inflight = undefined;
  });

  try {
    entry.snapshot = await entry.inflight;
    return entry.snapshot;
  } catch (error) {
    // 刷新失敗但手上有舊資料時沿用舊資料：清運班表一年難得改幾次，12 小時前的版本仍然正確，
    // 讓整個 App 因上游短暫維護而全掛反而更糟。回應裡的 loadedAt 會如實反映資料時間（AGENTS.md § 3.4）。
    // 沒有任何舊資料時才往上拋，讓 route handler 回 502。
    if (entry.snapshot) {
      console.error("[stop-cache] refresh failed, serving previous snapshot", city, error);
      return entry.snapshot;
    }
    throw error;
  }
}

/** 測試專用：清空快取，避免測試之間互相污染。 */
export function resetStopCacheForTests() {
  cache.clear();
}
