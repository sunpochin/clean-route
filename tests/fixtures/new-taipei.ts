// 檔案用途：新北 provider 單元測試用的假資料產生器（原始欄位格式）。
// 所在層：tests/fixtures；座標一律使用公開地標（板橋車站周邊），不得放真實住家位置（AGENTS.md § 3.5）。
// 主要關聯：tests/unit/new-taipei-*.test.ts、src/providers/new-taipei/raw.ts。

import type { RawStop, RawTruck } from "@/providers/new-taipei/raw";

/** 板橋車站（公開地標）。 */
export const BANQIAO_STATION = { lat: 25.0143, lng: 121.4638 };

export function rawStop(overrides: Partial<RawStop> = {}): RawStop {
  return {
    city: "板橋區",
    lineid: "999001",
    linename: "測試路線",
    rank: "1",
    name: "測試清運點",
    village: "測試里",
    latitude: String(BANQIAO_STATION.lat),
    longitude: String(BANQIAO_STATION.lng),
    time: "19:40",
    memo: "",
    garbagemonday: "Y",
    garbagetuesday: "Y",
    recyclingmonday: "Y",
    foodscrapsmonday: "Y",
    ...overrides,
  };
}

export function rawTruck(overrides: Partial<RawTruck> = {}): RawTruck {
  return {
    lineid: "999001",
    car: "TEST-0001",
    time: "2026/09/28 19:30:00",
    location: "新北市板橋區測試路1號",
    latitude: String(BANQIAO_STATION.lat),
    longitude: String(BANQIAO_STATION.lng),
    cityid: "6500100",
    cityname: "板橋區",
    ...overrides,
  };
}
