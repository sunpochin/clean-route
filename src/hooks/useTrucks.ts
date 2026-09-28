"use client";

// 檔案用途：輪詢附近清運點所屬路線的垃圾車即時位置（每 30 秒；分頁在背景時暫停），路線多時分批查詢。
// 所在層：src/hooks；瀏覽器專用。
// 主要關聯：src/app/api/trucks/route.ts、src/components/NearbyView.tsx。

import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { TRUCKS_MAX_ROUTES, type TrackedTruck, type TrucksResponse } from "@/lib/api-contract";
import { fetchJson } from "@/lib/fetch-json";

/** 上游 GPS 本身約每分鐘更新、伺服器又快取 20 秒，輪詢再快也拿不到更新的位置，只會浪費手機電量與流量。 */
const POLL_MS = 30_000;

export interface TrucksState {
  trucks: TrackedTruck[];
  /**
   * 「有成功查到」的路線集合。不在集合內的路線（該批查詢失敗或尚未回來）只能說「無法取得」，
   * 不能說「車沒有回報位置」——後者是查過之後的結論（AGENTS.md § 3.4）。
   */
  availableRouteIds: ReadonlySet<string>;
  /** 至少一批查詢失敗；已有的舊資料仍保留，由畫面顯示警示條。 */
  isError: boolean;
  fetchedAt?: string;
}

export function useTrucks(routeIds: readonly string[]): TrucksState {
  // 排序後切批：列表順序會隨定位微調而變，但路線集合相同就不該重新開始輪詢。
  // 不截斷：超過 API 單次上限就分多批，避免多出來的路線被默默當成「沒有車」。
  const key = [...new Set(routeIds)].sort().join(",");
  const batches = useMemo(() => {
    const ids = key ? key.split(",") : [];
    const result: string[][] = [];
    for (let i = 0; i < ids.length; i += TRUCKS_MAX_ROUTES) result.push(ids.slice(i, i + TRUCKS_MAX_ROUTES));
    return result;
  }, [key]);

  // combine 的引用要穩定：否則每次 render 都產生新的 trucks 陣列，地圖會不停移除／重建所有車輛標記。
  const combine = useCallback(
    (results: UseQueryResult<TrucksResponse>[]): TrucksState => {
      const availableRouteIds = new Set<string>();
      const trucks: TrackedTruck[] = [];
      let fetchedAt: string | undefined;
      results.forEach((result, i) => {
        if (!result.data) return;
        batches[i].forEach((id) => availableRouteIds.add(id));
        trucks.push(...result.data.trucks);
        // 多批時取最舊的時間，頁尾顯示的「更新於」才不會比實際資料新。
        if (!fetchedAt || result.data.fetchedAt < fetchedAt) fetchedAt = result.data.fetchedAt;
      });
      return { trucks, availableRouteIds, isError: results.some((r) => r.isError), fetchedAt };
    },
    [batches],
  );

  return useQueries({
    queries: batches.map((batch) => ({
      queryKey: ["trucks", batch.join(",")],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchJson<TrucksResponse>(`/api/trucks?routes=${encodeURIComponent(batch.join(","))}`, signal),
      refetchInterval: POLL_MS,
      // 預設就是 false，寫出來是為了讓人知道「背景不輪詢」是刻意的省電設計。
      refetchIntervalInBackground: false,
    })),
    combine,
  });
}
