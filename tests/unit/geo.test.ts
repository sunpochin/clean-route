// 檔案用途：驗證距離計算、附近搜尋排序，以及降精度誤差不超過宣告上限（位置隱私設計的前提）。
// 所在層：tests/unit；bun:test。
// 主要關聯：src/domain/geo.ts、docs/DECISIONS.md D6。

import { describe, expect, test } from "bun:test";
import { coarsenCoordinate, COARSEN_MAX_ERROR_M, distanceMeters, findWithinRadius, isInTaiwan } from "@/domain/geo";
import { BANQIAO_STATION } from "../fixtures/new-taipei";

const TAIPEI_MAIN_STATION = { lat: 25.0478, lng: 121.517 };

describe("distanceMeters", () => {
  test("板橋車站到台北車站約 6.5 公里", () => {
    const d = distanceMeters(BANQIAO_STATION, TAIPEI_MAIN_STATION);
    expect(d).toBeGreaterThan(6000);
    expect(d).toBeLessThan(7000);
  });
});

describe("coarsenCoordinate", () => {
  test("降到小數點後三位", () => {
    expect(coarsenCoordinate({ lat: 25.01436, lng: 121.46384 })).toEqual({ lat: 25.014, lng: 121.464 });
  });

  test("任意台灣座標降精度後的位移都不超過 COARSEN_MAX_ERROR_M", () => {
    for (let i = 0; i < 2000; i++) {
      const p = { lat: 21.9 + Math.random() * 4.4, lng: 119.3 + Math.random() * 2.8 };
      expect(distanceMeters(p, coarsenCoordinate(p))).toBeLessThanOrEqual(COARSEN_MAX_ERROR_M);
    }
  });
});

describe("findWithinRadius", () => {
  const items = [
    { id: "far", location: TAIPEI_MAIN_STATION },
    { id: "200m", location: { lat: BANQIAO_STATION.lat + 0.0018, lng: BANQIAO_STATION.lng } },
    { id: "50m", location: { lat: BANQIAO_STATION.lat + 0.00045, lng: BANQIAO_STATION.lng } },
  ];

  test("只回傳半徑內、由近到遠排序", () => {
    const hits = findWithinRadius(items, BANQIAO_STATION, 500, 10);
    expect(hits.map((h) => h.item.id)).toEqual(["50m", "200m"]);
  });

  test("遵守 limit", () => {
    expect(findWithinRadius(items, BANQIAO_STATION, 500, 1)).toHaveLength(1);
  });
});

describe("isInTaiwan", () => {
  test("擋掉 0,0 與境外座標", () => {
    expect(isInTaiwan({ lat: 0, lng: 0 })).toBe(false);
    expect(isInTaiwan({ lat: 35.68, lng: 139.76 })).toBe(false);
    expect(isInTaiwan(BANQIAO_STATION)).toBe(true);
  });
});
