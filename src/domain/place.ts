// 檔案用途：把「同一個實體地點」的多筆清運點（不同路線／時段）合併成一個地點，並找出該地點最快到的一班。
// 所在層：src/domain；純函式。
// 主要關聯：src/hooks/useNearbyStops.ts、src/components/PlaceCard.tsx、tests/unit/place.test.ts。
//
// 為什麼需要：新北資料以「路線 × 站序」為單位，同一個路口通常同時屬於下午班與晚上班兩條路線。
// 直接照資料列出來，每個地址會重複兩次，而且依距離排序時「明天下午」可能排在「今晚」前面。
// 使用者在意的是「我家巷口下一次什麼時候有車」，所以畫面以地點為單位。

import { nextPickup, type NextPickup } from "./schedule";
import type { GarbageStop, LatLng } from "./types";

export interface StopPlace {
  /** 地點 id：名稱 + 約 11 m 精度座標。只在一次查詢結果內穩定，不可當作永久識別碼儲存。 */
  id: string;
  name: string;
  district: string;
  location: LatLng;
  stops: GarbageStop[];
}

export interface PlaceVisit {
  stop: GarbageStop;
  pickup: NextPickup;
}

/** 依名稱 + 座標（小數 4 位 ≈ 11 m）合併；保留輸入順序（呼叫端已依距離排序）。 */
export function groupStopsByPlace(stops: readonly GarbageStop[]): StopPlace[] {
  const places = new Map<string, StopPlace>();
  for (const stop of stops) {
    const id = `${stop.name}@${stop.location.lat.toFixed(4)},${stop.location.lng.toFixed(4)}`;
    const place = places.get(id);
    if (place) place.stops.push(stop);
    else places.set(id, { id, name: stop.name, district: stop.district, location: stop.location, stops: [stop] });
  }
  return [...places.values()];
}

/** 地點內每條路線的下一班，依時間先後排序；第一筆就是「這個地點下一次有車」。 */
export function upcomingVisits(place: StopPlace, now: Date): PlaceVisit[] {
  return place.stops
    .map((stop) => ({ stop, pickup: nextPickup(stop, now) }))
    .filter((v): v is PlaceVisit => v.pickup !== null)
    .sort((a, b) => a.pickup.startsAt.getTime() - b.pickup.startsAt.getTime());
}
