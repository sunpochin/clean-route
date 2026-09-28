// 檔案用途：驗證新北原始資料列 → domain 型別的轉換、備註過濾與壞資料丟棄。
// 所在層：tests/unit；bun:test。
// 主要關聯：src/providers/new-taipei/normalize.ts、tests/fixtures/new-taipei.ts。

import { describe, expect, test } from "bun:test";
import { normalizeStop, normalizeTruck } from "@/providers/new-taipei/normalize";
import { BANQIAO_STATION, rawStop, rawTruck } from "../fixtures/new-taipei";

describe("normalizeStop", () => {
  test("轉出 domain 格式，服務日依星期排列（0 = 星期日）", () => {
    const stop = normalizeStop(rawStop({ time: "7:05" }))!;
    expect(stop.id).toBe("new-taipei:999001:1");
    expect(stop.district).toBe("板橋區");
    expect(stop.location).toEqual(BANQIAO_STATION);
    expect(stop.timeOfDay).toBe("07:05");
    expect(stop.weeklyServices[0]).toEqual([]);
    expect(stop.weeklyServices[1]).toEqual(["garbage", "recycling", "foodScraps"]);
    expect(stop.weeklyServices[2]).toEqual(["garbage"]);
  });

  test("使用者有用的備註保留，內部維護註記濾掉", () => {
    expect(normalizeStop(rawStop({ memo: "國定假日、連假隔天會加收" }))!.note).toBe("國定假日、連假隔天會加收");
    for (const internal of ["經緯度修正", "站序修正", "調整時間", "2025通報", "-", "  "]) {
      expect(normalizeStop(rawStop({ memo: internal }))!.note).toBeUndefined();
    }
  });

  test("壞資料回傳 null：空座標、境外座標、壞時間、缺路線、整週不收", () => {
    expect(normalizeStop(rawStop({ latitude: "", longitude: "" }))).toBeNull();
    expect(normalizeStop(rawStop({ latitude: "0", longitude: "0" }))).toBeNull();
    expect(normalizeStop(rawStop({ time: "晚上" }))).toBeNull();
    expect(normalizeStop(rawStop({ lineid: "" }))).toBeNull();
    expect(
      normalizeStop(rawStop({ garbagemonday: "", garbagetuesday: "", recyclingmonday: "", foodscrapsmonday: "" })),
    ).toBeNull();
  });
});

describe("normalizeTruck", () => {
  test("GPS 時間以台北時間轉成 ISO", () => {
    const truck = normalizeTruck(rawTruck())!;
    expect(truck.recordedAt).toBe("2026-09-28T11:30:00.000Z");
    expect(truck.routeId).toBe("999001");
    expect(truck.id).toBe("TEST-0001");
  });

  test("沒有可信時間戳的位置直接丟棄（無法判斷是否過期）", () => {
    expect(normalizeTruck(rawTruck({ time: "" }))).toBeNull();
    expect(normalizeTruck(rawTruck({ latitude: "abc" }))).toBeNull();
  });
});
