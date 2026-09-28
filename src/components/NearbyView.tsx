"use client";

// 檔案用途：首頁主畫面——串起定位、附近清運地點、即時車輛與地圖，並負責「載入中／失敗／查無結果」三種狀態的區分。
// 所在層：src/components；頁面級 client 元件，資料邏輯在 src/hooks，呈現拆給 PlaceCard／StopMap／LocationGate。
// 主要關聯：src/app/page.tsx、src/hooks/*；狀態區分規則見 AGENTS.md § 3.4 與 docs/agents/code-conventions.md。

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { distanceMeters } from "@/domain/geo";
import type { GarbageTruck } from "@/domain/types";
import { DEMO_LABEL, useGeolocation } from "@/hooks/useGeolocation";
import { useNearbyStops } from "@/hooks/useNearbyStops";
import { useNow } from "@/hooks/useNow";
import { useTrucks } from "@/hooks/useTrucks";
import { NEARBY_DEFAULT_RADIUS_M } from "@/lib/api-contract";
import { formatClock, formatDateTime, formatDistance } from "@/lib/format";
import { LocationGate } from "./LocationGate";
import { PlaceCard, type TruckNearStop } from "./PlaceCard";

// 地圖依賴 WebGL 與 window，只能在瀏覽器載入；ssr:false 也讓首屏不必等地圖 bundle。
const StopMap = dynamic(() => import("./StopMap").then((m) => m.StopMap), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-surface-muted motion-reduce:animate-none" />,
});

export function NearbyView() {
  const geo = useGeolocation();
  const now = useNow();
  const position = geo.state.status === "ready" ? geo.state.position : null;
  const nearby = useNearbyStops(position);
  // 由近到遠攤平成路線清單，useTrucks 超過上限時會保留最近的路線。
  const routeIds = useMemo(
    () => nearby.places?.flatMap((p) => p.place.stops.map((s) => s.routeId)) ?? [],
    [nearby.places],
  );
  const trucksState = useTrucks(routeIds);
  const trucks = trucksState.trucks;
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);

  const truckByStop = useMemo(() => {
    const byRoute = new Map<string, GarbageTruck[]>();
    for (const truck of trucks) byRoute.set(truck.routeId, [...(byRoute.get(truck.routeId) ?? []), truck]);
    const result = new Map<string, TruckNearStop>();
    for (const stop of nearby.places?.flatMap((p) => p.place.stops) ?? []) {
      // 同一路線偶爾會有兩台車（上游實測有重複 lineid），取離這個點最近的那台。
      for (const truck of byRoute.get(stop.routeId) ?? []) {
        const d = distanceMeters(stop.location, truck.location);
        const current = result.get(stop.id);
        if (!current || d < current.distanceM) result.set(stop.id, { truck, distanceM: d });
      }
    }
    return result;
  }, [trucks, nearby.places]);

  if (geo.state.status !== "ready") {
    return <LocationGate state={geo.state} onLocate={geo.locate} onDemo={geo.chooseDemo} />;
  }

  const selectPlace = (id: string) => {
    setSelectedPlaceId(id);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(`place-${id}`)?.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div className="h-[42vh] shrink-0 md:order-2 md:h-auto md:flex-1">
        {position && (
          <StopMap
            center={position}
            places={nearby.places ?? []}
            trucks={trucks}
            selectedPlaceId={selectedPlaceId}
            onSelectPlace={selectPlace}
            now={now}
          />
        )}
      </div>

      <section className="flex min-h-0 flex-1 flex-col md:order-1 md:w-[26rem] md:flex-none md:border-r md:border-line">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <p className="text-base">
            {geo.state.isDemo ? (
              <span className="rounded-md bg-warn-soft px-2 py-0.5 font-bold">{DEMO_LABEL}</span>
            ) : (
              <>
                你的位置
                {geo.state.accuracyM !== null && (
                  <span className="ml-1 text-sm text-muted">（誤差約 {formatDistance(geo.state.accuracyM)}）</span>
                )}
              </>
            )}
          </p>
          <button type="button" onClick={geo.locate} className="btn-small">
            📍 重新定位
          </button>
        </div>

        {nearby.data?.dataStale && (
          <p role="alert" className="border-b border-warn bg-warn-soft px-4 py-2 text-sm">
            班表資料更新失敗，目前顯示的是 {formatDateTime(nearby.data.dataLoadedAt)} 取得的版本，可能不是最新班表。
          </p>
        )}
        {nearby.data && nearby.data.skippedUpstreamRows > 0 && (
          <p role="alert" className="border-b border-warn bg-warn-soft px-4 py-2 text-sm">
            上游有 {nearby.data.skippedUpstreamRows} 筆清運點資料格式異常而未顯示，附近的清運點可能不完整。
          </p>
        )}
        {trucksState.isError && (
          <p role="alert" className="border-b border-warn bg-warn-soft px-4 py-2 text-sm">
            垃圾車即時位置暫時無法更新，下方顯示的是最後取得的位置。
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <PlaceListBody
            nearby={nearby}
            truckByStop={truckByStop}
            availableRouteIds={trucksState.availableRouteIds}
            selectedPlaceId={selectedPlaceId}
            onSelect={selectPlace}
            now={now}
          />
          <DataFootnote dataLoadedAt={nearby.data?.dataLoadedAt} trucksFetchedAt={trucksState.fetchedAt} />
        </div>
      </section>
    </div>
  );
}

function PlaceListBody({
  nearby,
  truckByStop,
  availableRouteIds,
  selectedPlaceId,
  onSelect,
  now,
}: {
  nearby: ReturnType<typeof useNearbyStops>;
  truckByStop: Map<string, TruckNearStop>;
  availableRouteIds: ReadonlySet<string>;
  selectedPlaceId: string | null;
  onSelect: (id: string) => void;
  now: Date;
}) {
  // 三種狀態必須長得不一樣：「抓不到」絕不能顯示成「附近沒有」（AGENTS.md § 3.4）。
  if (nearby.isPending) {
    return <p className="py-8 text-center text-lg" aria-live="polite">正在查詢附近清運點…</p>;
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
          selected={place.id === selectedPlaceId}
          onSelect={() => onSelect(place.id)}
          now={now}
        />
      ))}
    </ol>
  );
}

function DataFootnote({ dataLoadedAt, trucksFetchedAt }: { dataLoadedAt?: string; trucksFetchedAt?: string }) {
  return (
    <p className="mt-4 text-xs leading-relaxed text-muted">
      資料來源：新北市政府資料開放平台。
      {dataLoadedAt && `清運班表取得於 ${formatDateTime(dataLoadedAt)}；`}
      {trucksFetchedAt && `即時位置更新於 ${formatClock(trucksFetchedAt)}。`}
      表定時間為清潔隊公告時刻，實際到達可能提早或延後。
    </p>
  );
}
