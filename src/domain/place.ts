// 檔案用途：把「同一個實體地點」的多筆清運點（不同路線／時段）合併成一個地點，並找出該地點最快到的一班。
// 所在層：src/domain；純函式。
// 主要關聯：src/hooks/useNearbyStops.ts、src/components/PlaceCard.tsx、src/components/PlaceDetail.tsx、tests/unit/place.test.ts。
//
// 為什麼需要：新北資料以「路線 × 站序」為單位，同一個路口通常同時屬於下午班與晚上班兩條路線。
// 直接照資料列出來，每個地址會重複兩次，而且依距離排序時「明天下午」可能排在「今晚」前面。
// 使用者在意的是「我家巷口下一次什麼時候有車」，所以畫面以地點為單位。

import { nextPickup, type NextPickup } from "./schedule";
import { parseTimeOfDay } from "./time";
import type { GarbageStop, LatLng, ServiceType, Weekday } from "./types";

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

/** 週班表的顯示順序：台灣一般以週一開頭、週日結尾（Weekday 的 0 是週日，直接照數字排會把週日排第一）。 */
export const WEEK_ORDER: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0];

export interface ServiceDays {
  services: readonly ServiceType[];
  /** 依 WEEK_ORDER 排序。 */
  days: Weekday[];
}

export interface RouteWeek {
  stop: GarbageStop;
  /** 有收運的日子依「收的種類相同」分組；不收的日子不出現在任何一組。 */
  groups: ServiceDays[];
  /** 依 WEEK_ORDER 排序的所有收運日，給「一 二 三…」日期列用。 */
  days: Weekday[];
}

/**
 * 地點的完整週班表：每條路線一列，依一天中的時刻排序（下午班在晚上班前面）。
 * 為什麼要分組：多數路線每天收的種類都一樣，逐日列出會變成 7 行重複文字；
 * 但少數路線資源回收只收某幾天，全部合併又會說錯，所以「種類相同的日子」合成一組。
 */
export function weeklySchedule(place: StopPlace): RouteWeek[] {
  return [...place.stops]
    .sort((a, b) => (parseTimeOfDay(a.timeOfDay) ?? Infinity) - (parseTimeOfDay(b.timeOfDay) ?? Infinity))
    .map((stop) => {
      const groups: ServiceDays[] = [];
      const days: Weekday[] = [];
      for (const day of WEEK_ORDER) {
        const services = stop.weeklyServices[day] ?? [];
        if (services.length === 0) continue;
        days.push(day);
        // provider 產出的種類順序固定（一般垃圾 → 資源回收 → 廚餘），join 就能當比對鍵。
        const key = services.join(",");
        const group = groups.find((g) => g.services.join(",") === key);
        if (group) group.days.push(day);
        else groups.push({ services, days: [day] });
      }
      return { stop, groups, days };
    });
}
