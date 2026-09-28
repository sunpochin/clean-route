// 檔案用途：驗證清運點記憶體快取：同時請求只抓一次、刷新失敗時沿用舊資料並標示 stale、完全沒資料時才報錯。
// 所在層：tests/unit；bun:test，注入假 fetcher。
// 主要關聯：src/server/stop-cache.ts。

import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import type { JsonFetcher } from "@/providers/types";
import { getStopSnapshot, resetStopCacheForTests } from "@/server/stop-cache";
import { rawStop } from "@/providers/new-taipei/test-fixtures";

const TOTAL = 10_500;

function countingFetcher() {
  let pageCalls = 0;
  let failing = false;
  const fetcher: JsonFetcher = async (url) => {
    if (failing) throw new Error("upstream down");
    pageCalls++;
    const page = Number(new URL(url).searchParams.get("page"));
    const from = page * 1000;
    const to = Math.min(TOTAL, from + 1000);
    return Array.from({ length: Math.max(0, to - from) }, (_, i) => rawStop({ rank: String(from + i + 1) }));
  };
  return {
    fetcher,
    get pageCalls() {
      return pageCalls;
    },
    fail() {
      failing = true;
    },
  };
}

afterEach(() => {
  resetStopCacheForTests();
  setSystemTime();
});

describe("getStopSnapshot", () => {
  test("冷啟動時同時進來的請求只觸發一輪上游抓取", async () => {
    const upstream = countingFetcher();
    const [a, b] = await Promise.all([getStopSnapshot("new-taipei", upstream.fetcher), getStopSnapshot("new-taipei", upstream.fetcher)]);
    expect(a.stops).toBe(b.stops);
    expect(a.stale).toBe(false);
    // 10,500 筆 → 11 頁，但 provider 以 6 頁為一批，所以是 12 次呼叫。
    expect(upstream.pageCalls).toBe(12);
  });

  test("TTL 內直接回快取", async () => {
    const upstream = countingFetcher();
    await getStopSnapshot("new-taipei", upstream.fetcher);
    const calls = upstream.pageCalls;
    await getStopSnapshot("new-taipei", upstream.fetcher);
    expect(upstream.pageCalls).toBe(calls);
  });

  test("過期後刷新失敗：沿用舊資料、標示 stale，loadedAt 維持舊時間", async () => {
    const upstream = countingFetcher();
    setSystemTime(new Date("2026-09-28T00:00:00Z"));
    const first = await getStopSnapshot("new-taipei", upstream.fetcher);
    setSystemTime(new Date("2026-09-29T00:00:00Z"));
    upstream.fail();
    const second = await getStopSnapshot("new-taipei", upstream.fetcher);
    expect(second.stops).toBe(first.stops);
    expect(second.stale).toBe(true);
    expect(second.loadedAt.toISOString()).toBe("2026-09-28T00:00:00.000Z");
  });

  test("從來沒成功過：直接拋錯", async () => {
    const upstream = countingFetcher();
    upstream.fail();
    await expect(getStopSnapshot("new-taipei", upstream.fetcher)).rejects.toThrow("upstream down");
  });
});
