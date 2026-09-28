// 檔案用途：驗證同地點多路線合併、「最快到的一班」排序，以及地點詳情的完整週班表（真實資料中下午班／晚上班共用路口的情境）。
// 所在層：tests/unit；bun:test。
// 主要關聯：src/domain/place.ts。

import { describe, expect, test } from "bun:test";
import { groupStopsByPlace, upcomingVisits, weeklySchedule } from "@/domain/place";
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

describe("weeklySchedule", () => {
  // 仿真實資料：週三、週日停收，其餘每天三種都收（新北常見排法）。
  const all: ServiceType[] = ["garbage", "recycling", "foodScraps"];
  const noWedSun = [[], all, all, [], all, all, all];

  test("路線依時刻排序：晚上班即使在資料裡排前面，也列在下午班之後", () => {
    const [place] = groupStopsByPlace([
      stop("evening", "evening", "18:51", { weeklyServices: noWedSun }),
      stop("afternoon", "afternoon", "13:49", { weeklyServices: noWedSun }),
    ]);
    const week = weeklySchedule(place);
    expect(week.map((r) => r.stop.id)).toEqual(["afternoon", "evening"]);
    // 週一開頭、週日結尾，停收日不出現
    expect(week[0].days).toEqual([1, 2, 4, 5, 6]);
    expect(week[0].groups).toEqual([{ services: all, days: [1, 2, 4, 5, 6] }]);
  });

  test("不同日子收的種類不同時分組，週日排在最後", () => {
    const weeklyServices = [["garbage"], ["garbage", "recycling"], ["garbage"], ["garbage", "recycling"], [], [], []] as ServiceType[][];
    const [place] = groupStopsByPlace([stop("a", "r", "10:00", { weeklyServices })]);
    expect(weeklySchedule(place)[0].groups).toEqual([
      { services: ["garbage", "recycling"], days: [1, 3] },
      { services: ["garbage"], days: [2, 0] },
    ]);
  });
});
