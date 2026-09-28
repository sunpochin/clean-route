// 檔案用途：距離計算、附近清運點搜尋、座標降精度（位置隱私）。
// 所在層：src/domain；純函式，伺服器（/api/nearby）與瀏覽器（精確距離重算）共用。
// 主要關聯：src/app/api/nearby/route.ts、src/hooks/useNearbyStops.ts；隱私規則見 AGENTS.md § 3.5、docs/DECISIONS.md D6。

import type { LatLng } from "./types";

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 降精度到小數點後 3 位 ≈ 緯度 111 m、經度（北緯 25 度）約 100 m 的格子。 */
export const COARSE_DECIMALS = 3;

/**
 * 降精度造成的最大位移：每軸最多半格（0.0005 度），對角線約 75 m。
 * 伺服器搜尋半徑要加上這個值，否則「精確位置在半徑內、降精度後在半徑外」的點會被漏掉。
 */
export const COARSEN_MAX_ERROR_M = 80;

export function coarsenCoordinate(point: LatLng): LatLng {
  const f = 10 ** COARSE_DECIMALS;
  return { lat: Math.round(point.lat * f) / f, lng: Math.round(point.lng * f) / f };
}

/**
 * 在記憶體中找出半徑內的點，依距離排序。
 * 為什麼是線性掃描：新北約 2.6 萬點，先用經緯度方框粗篩再算 haversine，
 * 單次查詢在毫秒等級；上 PostGIS 的時機見 docs/DECISIONS.md D2。
 */
export function findWithinRadius<T extends { location: LatLng }>(
  items: readonly T[],
  center: LatLng,
  radiusM: number,
  limit: number,
): { item: T; distanceM: number }[] {
  const latDelta = radiusM / 111_320;
  const lngDelta = radiusM / (111_320 * Math.cos(toRad(center.lat)));
  const hits: { item: T; distanceM: number }[] = [];
  for (const item of items) {
    const { lat, lng } = item.location;
    if (Math.abs(lat - center.lat) > latDelta || Math.abs(lng - center.lng) > lngDelta) continue;
    const d = distanceMeters(center, item.location);
    if (d <= radiusM) hits.push({ item, distanceM: d });
  }
  hits.sort((a, b) => a.distanceM - b.distanceM);
  return hits.slice(0, limit);
}

/** 粗略的台灣本島＋離島範圍，用來擋掉明顯錯誤的查詢座標（例如 0,0）。 */
export function isInTaiwan(point: LatLng): boolean {
  return point.lat > 21.5 && point.lat < 26.5 && point.lng > 118 && point.lng < 122.5;
}
