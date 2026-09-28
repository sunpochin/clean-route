"use client";

// 檔案用途：輪詢附近清運點所屬路線的垃圾車即時位置（每 30 秒；分頁在背景時暫停）。
// 所在層：src/hooks；瀏覽器專用。
// 主要關聯：src/app/api/trucks/route.ts、src/components/NearbyView.tsx。

import { useQuery } from "@tanstack/react-query";
import { TRUCKS_MAX_ROUTES, type TrucksResponse } from "@/lib/api-contract";
import { fetchJson } from "@/lib/fetch-json";

/** 上游 GPS 本身約每分鐘更新、伺服器又快取 20 秒，輪詢再快也拿不到更新的位置，只會浪費手機電量與流量。 */
const POLL_MS = 30_000;

export function useTrucks(routeIds: readonly string[]) {
  // routeIds 由近到遠傳入：超過上限時先截斷（保留最近的路線），再排序當查詢鍵——
  // 列表順序會隨定位微調而變，但路線集合相同就不該重新開始輪詢。
  const ids = [...new Set(routeIds)].slice(0, TRUCKS_MAX_ROUTES).sort();
  return useQuery({
    queryKey: ["trucks", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: ({ signal }) => fetchJson<TrucksResponse>(`/api/trucks?routes=${encodeURIComponent(ids.join(","))}`, signal),
    refetchInterval: POLL_MS,
    // 預設就是 false，寫出來是為了讓人知道「背景不輪詢」是刻意的省電設計。
    refetchIntervalInBackground: false,
  });
}
