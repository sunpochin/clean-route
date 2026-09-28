"use client";

// 檔案用途：MapLibre 地圖——顯示使用者位置、附近清運地點與垃圾車即時位置；點地點會通知父層選取。
// 所在層：src/components；瀏覽器專用，maplibre-gl 以 dynamic import 載入（v6 為 ESM-only，且不能在伺服器端執行）。
// 主要關聯：src/components/NearbyView.tsx（資料與選取狀態）、docs/DECISIONS.md D5（底圖來源）。

import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import type { GarbageTruck, LatLng } from "@/domain/types";
import { ageMs, isStale } from "@/domain/freshness";
import { formatAge, formatClock } from "@/lib/format";
import type { PlaceWithDistance } from "@/hooks/useNearbyStops";

/** OpenFreeMap：免費、免 API key。換底圖只改這一行（DECISIONS D5）。 */
const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
/** 由 scripts/copy-maplibre-worker.ts 複製到 public/；打包後 MapLibre 自己推算的 worker 路徑是錯的。 */
const WORKER_URL = "/maplibre/maplibre-gl-worker.mjs";
/**
 * 樣式與第一批圖磚要多久內載入完成才算正常。
 * 為什麼用逾時而不是看 error 事件：載入過程中單一圖磚、字型、sprite 失敗都會發 error，
 * 那時 isStyleLoaded() 還是 false，用它判斷會把「之後其實載好了」的地圖永久蓋上失敗畫面。
 */
const MAP_LOAD_TIMEOUT_MS = 20_000;
/** 初次框選範圍：使用者位置 + 最近幾個地點。全部框進來的話，手機上每個點會小到點不到。 */
const FIT_NEAREST_STOPS = 8;

interface Props {
  center: LatLng;
  places: readonly PlaceWithDistance[];
  trucks: readonly GarbageTruck[];
  selectedPlaceId: string | null;
  onSelectPlace: (id: string) => void;
  now: Date;
}

function markerElement(className: string, label: string, text = ""): HTMLElement {
  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  // 地圖標記對螢幕閱讀器是無意義的 div；給名稱，至少聽得出這是哪個點。
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", label);
  return el;
}

export function StopMap({ center, places, trucks, selectedPlaceId, onSelectPlace, now }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const libRef = useRef<typeof import("maplibre-gl") | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  // 底圖（樣式＋第一批圖磚）是否載完；未載完前地圖是一片空白，要讓人知道「還在載」而不是「沒東西」。
  const [basemapLoaded, setBasemapLoaded] = useState(false);
  const userMarkerRef = useRef<Marker | null>(null);
  const stopMarkersRef = useRef<Marker[]>([]);
  const truckMarkersRef = useRef<Marker[]>([]);
  const fittedForRef = useRef<string | null>(null);
  // onSelectPlace 每次 render 都是新函式；放 ref 讓 marker 的 click handler 永遠呼叫最新版本，而不必重建 marker。
  const onSelectRef = useRef(onSelectPlace);
  useEffect(() => {
    onSelectRef.current = onSelectPlace;
  }, [onSelectPlace]);

  // 建立地圖：只做一次。center 變動由下一個 effect 處理，避免每次定位都整張地圖重建。
  useEffect(() => {
    let disposed = false;
    import("maplibre-gl")
      .then((lib) => {
        if (disposed || !containerRef.current) return;
        libRef.current = lib;
        lib.setWorkerUrl(WORKER_URL);
        const map = new lib.Map({
          container: containerRef.current,
          style: MAP_STYLE_URL,
          center: [center.lng, center.lat],
          zoom: 16,
          attributionControl: { compact: true },
        });
        map.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");
        const loadTimer = setTimeout(() => !disposed && setFailed(true), MAP_LOAD_TIMEOUT_MS);
        map.on("load", () => {
          clearTimeout(loadTimer);
          if (disposed) return;
          setFailed(false);
          setBasemapLoaded(true);
        });
        map.on("error", (e) => console.warn("[StopMap]", e.error?.message));
        mapRef.current = map;
        // 標記是 HTML 元素、不依賴樣式或圖磚，地圖物件建好就能畫；
        // 若等 load（全部初始圖磚載完）才畫，慢網路下使用者會盯著空白地圖十幾秒。
        setReady(true);
      })
      .catch(() => !disposed && setFailed(true));
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // 刻意只在掛載時執行（見上方註解）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 使用者位置
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!ready || !map || !lib) return;
    userMarkerRef.current?.remove();
    userMarkerRef.current = new lib.Marker({ element: markerElement("map-user", "你的位置") })
      .setLngLat([center.lng, center.lat])
      .addTo(map);
    map.easeTo({ center: [center.lng, center.lat], duration: prefersReducedMotion() ? 0 : 500 });
  }, [ready, center]);

  // 清運地點
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!ready || !map || !lib) return;
    stopMarkersRef.current.forEach((m) => m.remove());
    stopMarkersRef.current = places.map(({ place }, index) => {
      const el = markerElement(
        `map-stop${place.id === selectedPlaceId ? " map-stop--selected" : ""}`,
        `清運點 ${index + 1}：${place.name}`,
        String(index + 1),
      );
      el.addEventListener("click", () => onSelectRef.current(place.id));
      return new lib.Marker({ element: el }).setLngLat([place.location.lng, place.location.lat]).addTo(map);
    });

    // 每個查詢位置只自動框一次：之後每 30 秒更新車輛或使用者點選時再框，會把使用者自己拖好的畫面搶走。
    const fitKey = `${center.lat},${center.lng}`;
    if (places.length > 0 && fittedForRef.current !== fitKey) {
      fittedForRef.current = fitKey;
      const bounds = new lib.LngLatBounds([center.lng, center.lat], [center.lng, center.lat]);
      for (const { place } of places.slice(0, FIT_NEAREST_STOPS)) bounds.extend([place.location.lng, place.location.lat]);
      map.fitBounds(bounds, { padding: 48, maxZoom: 17, duration: prefersReducedMotion() ? 0 : 500 });
    }
  }, [ready, places, selectedPlaceId, center]);

  // 垃圾車
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!ready || !map || !lib) return;
    truckMarkersRef.current.forEach((m) => m.remove());
    truckMarkersRef.current = trucks.map((truck) => {
      const stale = isStale(truck.recordedAt, now);
      const age = ageMs(truck.recordedAt, now);
      // 地圖上很多車沒有對應的卡片，所以回報時間必須在標記本身看得到（AGENTS.md § 3.4）：
      // 點開 popup 顯示完整時間，過期的車直接在圖示旁標出多久前。
      const when = age === null ? "回報時間不明" : `${formatAge(age)}回報（${formatClock(truck.recordedAt)}）`;
      const detail = `垃圾車 ${truck.id}：${when}${stale ? "，位置可能過期" : ""}`;
      const el = markerElement(`map-truck${stale ? " map-truck--stale" : ""}`, detail, "🚛");
      if (stale) {
        const badge = document.createElement("span");
        badge.className = "map-truck__age";
        badge.textContent = age === null ? "?" : formatAge(age);
        el.append(badge);
      }
      return new lib.Marker({ element: el })
        .setLngLat([truck.location.lng, truck.location.lat])
        .setPopup(new lib.Popup({ offset: 18, closeButton: false }).setText(detail))
        .addTo(map);
    });
  }, [ready, trucks, now]);

  // 選取地點時把地圖移過去
  useEffect(() => {
    const map = mapRef.current;
    const target = places.find((p) => p.place.id === selectedPlaceId);
    if (!ready || !map || !target) return;
    map.easeTo({ center: [target.place.location.lng, target.place.location.lat], duration: prefersReducedMotion() ? 0 : 500 });
  }, [ready, selectedPlaceId, places]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {!basemapLoaded && !failed && (
        // 放左下角：頂端是清運點查詢狀態條（MapStatusBanner），兩者同時出現時不互相遮擋。
        <p aria-live="polite" className="absolute bottom-3 left-3 rounded-lg bg-surface/90 px-3 py-1.5 text-sm shadow">
          底圖載入中…
        </p>
      )}
      {failed && (
        <p className="absolute inset-0 flex items-center justify-center bg-surface-muted p-4 text-center text-base">
          地圖暫時載入失敗，清運點列表仍可正常使用。
        </p>
      )}
    </div>
  );
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
