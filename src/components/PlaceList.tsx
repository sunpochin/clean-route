"use client";

// 檔案用途：附近清運地點列表，負責「載入中／失敗／查無結果／成功」四種狀態各自的畫面。
// 所在層：src/components；純呈現元件，資料來自 src/hooks/useNearbyStops.ts，由 NearbyView 組合。
// 主要關聯：src/components/PlaceCard.tsx、src/components/MapStatusBanner.tsx（地圖上的同一組狀態）；狀態區分規則見 AGENTS.md § 3.4。

import type { useNearbyStops } from "@/hooks/useNearbyStops";
import { useSlowFlag } from "@/hooks/useSlowFlag";
import { NEARBY_DEFAULT_RADIUS_M } from "@/lib/api-contract";
import { formatDistance } from "@/lib/format";
import { SLOW_QUERY_HINT_MS } from "./MapStatusBanner";
import { PlaceCard } from "./PlaceCard";
import type { TruckNearStop } from "./TruckStatus";

/** 骨架卡片數量：手機上約一屏，太多只是更長的灰塊。 */
const SKELETON_CARDS = 3;

interface Props {
  nearby: ReturnType<typeof useNearbyStops>;
  truckByStop: ReadonlyMap<string, TruckNearStop>;
  availableRouteIds: ReadonlySet<string>;
  onSelect: (id: string) => void;
  now: Date;
}

export function PlaceList({ nearby, truckByStop, availableRouteIds, onSelect, now }: Props) {
  const slow = useSlowFlag(nearby.isPending, SLOW_QUERY_HINT_MS);

  // 三種狀態必須長得不一樣：「抓不到」絕不能顯示成「附近沒有」（AGENTS.md § 3.4）。
  if (nearby.isPending) {
    return (
      <div aria-busy="true">
        {/* 骨架卡片保留列表的形狀，結果回來時畫面不會整個跳動；文字才是真正告訴人「在做什麼」的部分。 */}
        <p className="pb-3 text-center text-lg" aria-live="polite">
          正在查詢附近清運點…
          {/* 手機上地圖狀態條就在正上方、已說明同一件事，只在桌機（列表與地圖左右分開）重複一次。 */}
          {slow && <span className="hidden text-sm text-muted md:block">第一次查詢要下載整份新北市班表，可能需要十幾秒。</span>}
        </p>
        <ul aria-hidden className="flex flex-col gap-3">
          {Array.from({ length: SKELETON_CARDS }, (_, i) => (
            <li key={i} className="flex gap-3 rounded-2xl border-2 border-line bg-surface p-4">
              <span className="size-8 shrink-0 rounded-full bg-surface-muted" />
              <div className="flex flex-1 flex-col gap-2">
                <span className="h-5 w-2/3 animate-pulse rounded bg-surface-muted motion-reduce:animate-none" />
                <span className="h-6 w-1/2 animate-pulse rounded bg-surface-muted motion-reduce:animate-none" />
                <span className="h-4 w-5/6 animate-pulse rounded bg-surface-muted motion-reduce:animate-none" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (nearby.isError) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl border-2 border-warn bg-warn-soft p-5 text-center">
        <p className="text-lg font-bold">資料抓取失敗</p>
        <p className="text-base">{nearby.error.message}。這不代表附近沒有垃圾車。</p>
        <button type="button" onClick={() => nearby.refetch()} className="btn-primary">
          再試一次
        </button>
      </div>
    );
  }
  if (!nearby.places || nearby.places.length === 0) {
    return (
      <p className="py-8 text-center text-lg">
        方圓 {formatDistance(NEARBY_DEFAULT_RADIUS_M)} 內沒有新北市的清運點。
        <br />
        <span className="text-base text-muted">目前只支援新北市。</span>
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-3" aria-label="附近清運點，由近到遠">
      {nearby.places.map(({ place, distanceM }, index) => (
        <PlaceCard
          key={place.id}
          index={index}
          place={place}
          distanceM={distanceM}
          truckByStopId={truckByStop}
          availableRouteIds={availableRouteIds}
          onSelect={() => onSelect(place.id)}
          now={now}
        />
      ))}
    </ol>
  );
}
