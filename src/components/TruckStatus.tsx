"use client";

// 檔案用途：「負責這一班的垃圾車離這裡多遠、多久前回報」一行狀態；查不到、沒回報、位置過期各有不同說法。
// 所在層：src/components；純呈現元件，卡片（PlaceCard）與地點詳情（PlaceDetail）共用，確保同一件事說法一致。
// 主要關聯：src/domain/freshness.ts；資料誠實規則見 AGENTS.md § 3.4。

import { ageMs, isStale } from "@/domain/freshness";
import type { GarbageTruck } from "@/domain/types";
import { formatAge, formatDistance } from "@/lib/format";

export interface TruckNearStop {
  truck: GarbageTruck;
  distanceM: number;
}

export function TruckStatus({ truck, trucksAvailable, now }: { truck: TruckNearStop | null; trucksAvailable: boolean; now: Date }) {
  if (!trucksAvailable) return <p className="mt-2 text-sm text-muted">即時位置暫時無法取得</p>;
  if (!truck) return <p className="mt-2 text-sm text-muted">這一班的車目前沒有回報位置（可能尚未出車）</p>;

  const stale = isStale(truck.truck.recordedAt, now);
  const age = ageMs(truck.truck.recordedAt, now);
  return (
    <p className={`mt-2 text-base font-medium ${stale ? "text-warn" : "text-live"}`}>
      🚛 車輛距此 {formatDistance(truck.distanceM)}
      <span className="ml-1 text-sm font-normal">
        （{age === null ? "時間不明" : `${formatAge(age)}回報`}
        {stale && "，位置可能過期"}）
      </span>
    </p>
  );
}
