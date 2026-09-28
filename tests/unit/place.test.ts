// 檔案用途：驗證同地點多路線合併，以及「最快到的一班」排序（真實資料中下午班／晚上班共用路口的情境）。
// 所在層：tests/unit；bun:test。
// 主要關聯：src/domain/place.ts。

import { describe, expect, test } from "bun:test";
import { groupStopsByPlace, upcomingVisits } from "@/domain/place";
import type { GarbageStop, ServiceType } from "@/domain/types";
import { BANQIAO_STATION } from "../fixtures/landmarks";

const everyDay = Array.from({ length: 7 }, () => ["garbage"] as ServiceType[]);

function stop(id: string, routeId: string, timeOfDay: string, overrides: Partial<GarbageStop> = {}): GarbageStop {
  return {
    id,
    city: "new-taipei",
    district: "板橋區",
    village: "測試里",
    name: "測試路1號",
    routeId,
    routeName: routeId,
    sequence: 1,
    location: BANQIAO_STATION,
    timeOfDay,
    weeklyServices: everyDay,
    ...overrides,
  };
}

describe("groupStopsByPlace", () => {
  test("同名同座標的下午班與晚上班合併成一個地點，並保留輸入順序", () => {
    const places = groupStopsByPlace([
      stop("a", "afternoon", "14:36"),
      stop("far", "x", "10:00", { name: "另一個地點", location: { lat: 25.02, lng: 121.47 } }),
      stop("b", "evening", "19:38"),
    ]);
    expect(places.map((p) => p.name)).toEqual(["測試路1號", "另一個地點"]);
    expect(places[0].stops.map((s) => s.id)).toEqual(["a", "b"]);
  });

  test("同名但相距數十公尺的點不合併（不同路口）", () => {
    const places = groupStopsByPlace([
      stop("a", "r1", "10:00"),
      stop("b", "r2", "10:00", { location: { lat: BANQIAO_STATION.lat + 0.0005, lng: BANQIAO_STATION.lng } }),
    ]);
    expect(places).toHaveLength(2);
  });
});

describe("upcomingVisits", () => {
  test("傍晚 18:00 時，今晚 19:38 排在明天 14:36 前面", () => {
    const [place] = groupStopsByPlace([stop("a", "afternoon", "14:36"), stop("b", "evening", "19:38")]);
    const visits = upcomingVisits(place, new Date("2026-09-28T18:00:00+08:00"));
    expect(visits.map((v) => [v.stop.id, v.pickup.dayOffset])).toEqual([
      ["b", 0],
      ["a", 1],
    ]);
  });
});
