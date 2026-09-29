"use client";

// 檔案用途：「負責這一班的垃圾車離這裡多遠、多久前回報、開到第幾站（還差幾站）」狀態；查不到、沒回報、位置過期、站序判斷不出來各有不同說法。
// 所在層：src/components；純呈現元件，卡片（PlaceCard）與地點詳情（PlaceDetail）共用，確保同一件事說法一致。
// 主要關聯：src/domain/freshness.ts、src/domain/route-progress.ts（站序比對）、src/lib/format.ts；資料誠實規則見 AGENTS.md § 3.4。

import { ageMs, isStale } from "@/domain/freshness";
import type { TrackedTruck } from "@/lib/api-contract";
import { formatAge, formatDistance, formatRouteProgress } from "@/lib/format";

export interface TruckNearStop {
  truck: TrackedTruck;
  distanceM: number;
}

interface Props {
  truck: TruckNearStop | null;
  trucksAvailable: boolean;
  /** 這一班在路線上的站序，用來算「還差幾站」。 */
  stopSequence: number;
  now: Date;
}

export function TruckStatus({ truck, trucksAvailable, stopSequence, now }: Props) {
  if (!trucksAvailable) return <p className="mt-2 text-sm text-muted">即時位置暫時無法取得</p>;
  if (!truck) return <p className="mt-2 text-sm text-muted">這一班的車目前沒有回報位置（可能尚未出車）</p>;

  const stale = isStale(truck.truck.recordedAt, now);
  const age = ageMs(truck.truck.recordedAt, now);
  const { progress } = truck.truck;
  const matched = progress?.status === "matched";
  return (
    <div className="mt-2">
      <p className={`text-base font-medium ${stale ? "text-warn" : "text-live"}`}>
        🚛 車輛距此 {formatDistance(truck.distanceM)}
        <span className="ml-1 text-sm font-normal">
          （{age === null ? "時間不明" : `${formatAge(age)}回報`}
          {stale && "，位置可能過期"}）
        </span>
      </p>
      {/* 站數是從同一筆 GPS 推出來的：位置過期時跟著用警示色，不讓「還差幾站」看起來比位置本身更可靠。
          判斷不出來時改用小字灰色，讓人一眼分辨「有答案」和「沒答案」，但仍明說原因，而不是默默不顯示。 */}
      <p className={matched ? `text-base font-medium ${stale ? "text-warn" : "text-foreground"}` : "text-sm text-muted"}>
        {formatRouteProgress(progress, stopSequence)}
      </p>
    </div>
  );
}
