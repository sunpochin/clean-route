"use client";

// 檔案用途：首頁主畫面——串起定位、附近清運地點、即時車輛與地圖，並在「附近列表」與「單一地點詳情」之間切換。
// 所在層：src/components；頁面級 client 元件，資料邏輯在 src/hooks，呈現拆給 PlaceList／PlaceDetail／StopMap／MapStatusBanner／LocationGate。
// 主要關聯：src/app/page.tsx、src/hooks/*；狀態區分規則見 AGENTS.md § 3.4 與 docs/agents/code-conventions.md。

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef } from "react";
import { distanceMeters } from "@/domain/geo";
import { DEMO_LABEL, useGeolocation } from "@/hooks/useGeolocation";
import { useNearbyStops } from "@/hooks/useNearbyStops";
import { useNow } from "@/hooks/useNow";
import { useSelectedPlace } from "@/hooks/useSelectedPlace";
import { useTrucks } from "@/hooks/useTrucks";
import type { TrackedTruck } from "@/lib/api-contract";
import { formatClock, formatDateTime, formatDistance } from "@/lib/format";
import { LocationGate } from "./LocationGate";
import { MapStatusBanner } from "./MapStatusBanner";
import { PlaceDetail } from "./PlaceDetail";
import { PlaceList } from "./PlaceList";
import type { TruckNearStop } from "./TruckStatus";

// 地圖依賴 WebGL 與 window，只能在瀏覽器載入；ssr:false 也讓首屏不必等地圖 bundle。
const StopMap = dynamic(() => import("./StopMap").then((m) => m.StopMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-surface-muted text-base text-muted">地圖載入中…</div>
  ),
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
  const selection = useSelectedPlace();
  const listScrollRef = useRef<HTMLDivElement>(null);

  const truckByStop = useMemo(() => {
    const byRoute = new Map<string, TrackedTruck[]>();
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

  // 重新定位後舊的地點可能已不在結果內；找不到就當作沒有選取，畫面退回列表而不是停在空白詳情。
  const selectedIndex = nearby.places?.findIndex((p) => p.place.id === selection.selectedId) ?? -1;
  const selected = selectedIndex >= 0 ? nearby.places![selectedIndex] : null;

  // 查詢已完成、卻找不到選取的地點：正式關閉詳情，讓歷史紀錄跟著回到列表。
  // 只在有結果時判斷：查詢中或失敗時 places 是 undefined，那時還不能斷定地點不存在。
  const selectionMissing = selection.selectedId !== null && nearby.places !== undefined && selectedIndex < 0;
  const closeSelection = selection.close;
  useEffect(() => {
    if (selectionMissing) closeSelection();
  }, [selectionMissing, closeSelection]);

  // 從詳情返回列表時捲回剛才那張卡片並聚焦：長列表裡被丟回頂端，使用者得重新找「我剛剛看到第幾個」。
  const lastSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = lastSelectedRef.current;
    lastSelectedRef.current = selection.selectedId;
    if (selection.selectedId) {
      // 換到另一個地點的詳情時從頂端開始看，不沿用上一個地點的捲動位置。
      listScrollRef.current?.scrollTo({ top: 0 });
      return;
    }
    if (!previous) return;
    const card = document.getElementById(`place-${previous}`);
    card?.scrollIntoView({ block: "center" });
    card?.querySelector("button")?.focus({ preventScroll: true });
  }, [selection.selectedId]);

  if (geo.state.status !== "ready") {
    return <LocationGate state={geo.state} onLocate={geo.locate} onDemo={geo.chooseDemo} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div className="relative h-[42vh] shrink-0 md:order-2 md:h-auto md:flex-1">
        {position && (
          <StopMap
            center={position}
            places={nearby.places ?? []}
            trucks={trucks}
            selectedPlaceId={selected?.place.id ?? null}
            onSelectPlace={selection.open}
            now={now}
          />
        )}
        <MapStatusBanner
          isPending={nearby.isPending}
          isError={nearby.isError}
          errorMessage={nearby.error?.message}
          placeCount={nearby.places?.length ?? 0}
          onRetry={() => nearby.refetch()}
        />
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

        <div ref={listScrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {/* 點了某個地點就只談那個地點：列表整個換成詳情，不讓其他地點的時間混在一起（使用者回饋）。 */}
          {selected ? (
            <PlaceDetail
              index={selectedIndex}
              place={selected.place}
              distanceM={selected.distanceM}
              truckByStopId={truckByStop}
              availableRouteIds={trucksState.availableRouteIds}
              onBack={selection.close}
              now={now}
            />
          ) : (
            <PlaceList
              nearby={nearby}
              truckByStop={truckByStop}
              availableRouteIds={trucksState.availableRouteIds}
              onSelect={selection.open}
              now={now}
            />
          )}
          <DataFootnote dataLoadedAt={nearby.data?.dataLoadedAt} trucksFetchedAt={trucksState.fetchedAt} />
        </div>
      </section>
    </div>
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
