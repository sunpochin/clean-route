// 檔案用途：驗證垃圾車 GPS → 路線站序的比對：一般情況、離開路線、路線繞回同一帶時用表定時刻分辨或明說無法判斷、台北時區，以及同路線多台車時該顯示哪一台。
// 所在層：tests/unit；bun:test。
// 主要關聯：src/domain/route-progress.ts、docs/DECISIONS.md D9。

import { describe, expect, test } from "bun:test";
import { groupStopsByRoute, matchRouteProgress, pickTruckForStop, stopsUntil } from "@/domain/route-progress";
import type { GarbageStop, LatLng, ServiceType } from "@/domain/types";
import { formatTimeOfDay } from "@/domain/time";
import { BANQIAO_STATION } from "../fixtures/landmarks";

const everyDay = Array.from({ length: 7 }, () => ["garbage"] as ServiceType[]);

/** 板橋車站往北每 0.001 度（約 111 m）一站，大於比對半徑 80 m，相鄰站不會同時成為候選。 */
function north(steps: number, spacingDeg = 0.001): LatLng {
  return { lat: BANQIAO_STATION.lat + steps * spacingDeg, lng: BANQIAO_STATION.lng };
}

function stop(sequence: number, location: LatLng, timeOfDay: string, routeId = "R1"): GarbageStop {
  return {
    id: `new-taipei:${routeId}:${sequence}`,
    city: "new-taipei",
    district: "板橋區",
    village: "測試里",
    name: `測試站${sequence}`,
    routeId,
    routeName: routeId,
    sequence,
    location,
    timeOfDay,
    weeklyServices: everyDay,
  };
}

/** 直線路線：第 n 站在往北 n 格，19:00 起每站 1 分鐘。 */
function straightRoute(count: number): GarbageStop[] {
  return Array.from({ length: count }, (_, i) => stop(i + 1, north(i + 1), formatTimeOfDay(19 * 60 + i)));
}

// 台北 19:06 = UTC 11:06。刻意用 UTC 的 ISO 字串，確保比對時換算成台北時間（AGENTS.md § 3.3）。
const AT_1906 = "2026-09-29T11:06:00.000Z";
const AT_1944 = "2026-09-29T11:44:00.000Z";

describe("matchRouteProgress", () => {
  test("車在第 12 站旁邊 → 第 12 站", () => {
    const progress = matchRouteProgress(straightRoute(30), { lat: north(12).lat + 0.0002, lng: north(12).lng }, AT_1906);
    expect(progress).toMatchObject({ status: "matched", sequence: 12 });
  });

  test("站序順序不拘（伺服器索引不保證排序）", () => {
    const progress = matchRouteProgress(straightRoute(30).reverse(), north(7), AT_1906);
    expect(progress).toMatchObject({ status: "matched", sequence: 7 });
  });

  test("連續幾站都在半徑內時算同一次經過，取最近的一站", () => {
    const dense = Array.from({ length: 5 }, (_, i) => stop(i + 1, north(i, 0.0003), formatTimeOfDay(19 * 60 + i)));
    const progress = matchRouteProgress(dense, north(2, 0.0003), AT_1906);
    expect(progress).toMatchObject({ status: "matched", sequence: 3 });
  });

  test("附近沒有這條路線的站 → offRoute，不硬湊一站", () => {
    expect(matchRouteProgress(straightRoute(10), north(50), AT_1906)).toEqual({ status: "offRoute" });
    expect(matchRouteProgress([], north(1), AT_1906)).toEqual({ status: "offRoute" });
  });

  describe("路線繞回同一帶（第 5 站與第 17 站在同一個路口）", () => {
    function loopRoute(returnTime: string): GarbageStop[] {
      const route = straightRoute(20);
      route[16] = stop(17, north(5), returnTime);
      return route;
    }

    test("表定時刻差很多時，用 GPS 時間挑出正確的那一次經過", () => {
      const route = loopRoute("19:40");
      expect(matchRouteProgress(route, north(5), AT_1906)).toMatchObject({ status: "matched", sequence: 5 });
      expect(matchRouteProgress(route, north(5), "2026-09-29T11:38:00.000Z")).toMatchObject({ status: "matched", sequence: 17 });
    });

    test("兩次經過的表定時刻太接近（車晚到就會認錯）→ ambiguous", () => {
      expect(matchRouteProgress(loopRoute("19:15"), north(5), AT_1906)).toEqual({ status: "ambiguous" });
    });

    test("GPS 時間無法解析時沒有依據挑 → ambiguous；但只有一次經過時仍可回答", () => {
      expect(matchRouteProgress(loopRoute("19:40"), north(5), "not-a-date")).toEqual({ status: "ambiguous" });
      expect(matchRouteProgress(straightRoute(10), north(5), "not-a-date")).toMatchObject({ status: "matched", sequence: 5 });
    });

    test("以台北時間判斷：UTC 11:44 是台北 19:44，應選較晚的那次經過", () => {
      // 若誤把 11:44 當成當地時間，較早那次經過（19:04）反而比較近，會選成第 5 站。
      expect(matchRouteProgress(loopRoute("19:45"), north(5), AT_1944)).toMatchObject({ status: "matched", sequence: 17 });
    });
  });

  test("跳站串接不能把繞回的兩次經過併成一段（5 → 8 → 11，PR #6 review）", () => {
    // 只有 5、8、11 在同一個路口，中間的站都在別處：11 與 5 相差 6 站，是第二次經過。
    const route = straightRoute(20);
    route[7] = stop(8, north(5), "19:07");
    route[10] = stop(11, north(5), "19:10");
    // 兩段表定時刻很近（19:04–19:07 vs 19:10），分不出來就要說 ambiguous，而不是自信地回某一站。
    expect(matchRouteProgress(route, north(5), AT_1906)).toEqual({ status: "ambiguous" });
  });
});

describe("pickTruckForStop", () => {
  const here = stop(18, north(18), "19:17");
  const truck = (id: string, steps: number, progress: { status: string; sequence?: number }) => ({
    id,
    location: north(steps),
    progress: progress as { status: string },
  });

  test("最近的車已經過了、另一台還在路上：顯示還在路上的那台（PR #6 review）", () => {
    const passed = truck("passed", 19, { status: "matched", sequence: 19 });
    const coming = truck("coming", 12, { status: "matched", sequence: 12 });
    expect(pickTruckForStop(here, [passed, coming])?.truck.id).toBe("coming");
  });

  test("兩台都還沒到：取站數最少（最快到）的那台", () => {
    const far = truck("far", 5, { status: "matched", sequence: 5 });
    const near = truck("near", 15, { status: "matched", sequence: 15 });
    expect(pickTruckForStop(here, [far, near])?.truck.id).toBe("near");
  });

  test("判斷不出站序的車排在已經過的車前面：它可能還沒到", () => {
    const passed = truck("passed", 19, { status: "matched", sequence: 19 });
    const unknown = truck("unknown", 30, { status: "ambiguous" });
    expect(pickTruckForStop(here, [passed, unknown])?.truck.id).toBe("unknown");
  });

  test("只有已經過的車時才顯示它；距離照實計算；沒有車回 null", () => {
    const picked = pickTruckForStop(here, [truck("passed", 19, { status: "matched", sequence: 19 })]);
    expect(picked?.truck.id).toBe("passed");
    expect(picked?.distanceM).toBeGreaterThan(100);
    expect(pickTruckForStop(here, [])).toBeNull();
  });
});

describe("stopsUntil", () => {
  test("目標站序減去車的站序；負值代表車的站序已超過目標", () => {
    const at12 = { status: "matched", sequence: 12, distanceM: 10 } as const;
    expect(stopsUntil(at12, 18)).toBe(6);
    expect(stopsUntil(at12, 12)).toBe(0);
    expect(stopsUntil(at12, 10)).toBe(-2);
  });
});

describe("groupStopsByRoute", () => {
  test("依路線分組", () => {
    const index = groupStopsByRoute([stop(1, north(1), "19:00", "A"), stop(1, north(1), "14:00", "B"), stop(2, north(2), "19:01", "A")]);
    expect(index.get("A")?.map((s) => s.sequence)).toEqual([1, 2]);
    expect(index.get("B")?.length).toBe(1);
  });
});
