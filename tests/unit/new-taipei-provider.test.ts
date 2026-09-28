// 檔案用途：驗證新北 provider 的分頁抓取、以及資料量／格式異常時 fail loudly 而不是回傳殘缺資料。
// 所在層：tests/unit；bun:test，用注入的假 fetcher，不打真實網路。
// 主要關聯：src/providers/new-taipei/index.ts、src/providers/types.ts（JsonFetcher、UpstreamError）。

import { describe, expect, test } from "bun:test";
import { newTaipeiProvider } from "@/providers/new-taipei";
import { UpstreamError, type JsonFetcher } from "@/providers/types";
import { rawStop, rawTruck } from "@/providers/new-taipei/test-fixtures";

const PAGE_SIZE = 1000;

/** 模擬上游：total 筆資料依 page/size 切頁；corrupt 指定要壞掉的筆數。 */
function stopsFetcher(total: number, corrupt = 0) {
  const calls: string[] = [];
  const fetcher: JsonFetcher = async (url) => {
    calls.push(url);
    const params = new URL(url).searchParams;
    const page = Number(params.get("page"));
    const size = Number(params.get("size"));
    const from = page * size;
    const to = Math.min(total, from + size);
    return Array.from({ length: Math.max(0, to - from) }, (_, i) => {
      const n = from + i;
      return rawStop({ rank: String(n + 1), ...(n < corrupt ? { time: "壞掉" } : {}) });
    });
  };
  return Object.assign(fetcher, { calls });
}

describe("newTaipeiProvider.fetchStops", () => {
  test("抓完所有分頁，遇到不滿一頁就停", async () => {
    const fetcher = stopsFetcher(12_345);
    const { stops, skipped } = await newTaipeiProvider.fetchStops(fetcher);
    expect(stops).toHaveLength(12_345);
    expect(skipped).toBe(0);
    expect(fetcher.calls.every((url) => url.includes(`size=${PAGE_SIZE}`))).toBe(true);
  });

  test("資料量異常少：丟 UpstreamError，不回傳殘缺清單", async () => {
    await expect(newTaipeiProvider.fetchStops(stopsFetcher(500))).rejects.toBeInstanceOf(UpstreamError);
  });

  test("壞資料比例過高（疑似 schema 變更）：丟 UpstreamError", async () => {
    await expect(newTaipeiProvider.fetchStops(stopsFetcher(12_000, 1_000))).rejects.toBeInstanceOf(UpstreamError);
  });

  test("少量壞資料：丟棄並回報 skipped 筆數", async () => {
    const { skipped } = await newTaipeiProvider.fetchStops(stopsFetcher(12_000, 10));
    expect(skipped).toBe(10);
  });

  test("上游不是陣列：丟 UpstreamError", async () => {
    const fetcher: JsonFetcher = async () => ({ message: "maintenance" });
    await expect(newTaipeiProvider.fetchStops(fetcher)).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe("newTaipeiProvider.fetchTrucks", () => {
  test("正規化並丟棄少量壞資料", async () => {
    const good = Array.from({ length: 9 }, (_, i) => rawTruck({ car: `TEST-${i}` }));
    const fetcher: JsonFetcher = async () => [...good, rawTruck({ car: "BAD", time: "" })];
    const trucks = await newTaipeiProvider.fetchTrucks(fetcher);
    expect(trucks).toHaveLength(9);
    expect(trucks.some((t) => t.id === "BAD")).toBe(false);
  });

  test("上游有資料但大多解析失敗（疑似改格式）：丟 UpstreamError，不能回傳 [] 冒充「沒有車」", async () => {
    const fetcher: JsonFetcher = async () => [rawTruck({ time: "28-09-2026 18:00" }), rawTruck({ time: "28-09-2026 18:01" })];
    await expect(newTaipeiProvider.fetchTrucks(fetcher)).rejects.toBeInstanceOf(UpstreamError);
  });

  test("夜間收班 0 台車是合法狀態", async () => {
    expect(await newTaipeiProvider.fetchTrucks(async () => [])).toEqual([]);
  });
});
