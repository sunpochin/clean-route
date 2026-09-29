// 檔案用途：驗證清運點記憶體快取：同時請求只抓一次、過期時先回舊資料並背景刷新、刷新失敗標示 stale 並退避、完全沒資料時才報錯；peek 不觸發抓取並回報冷啟動失敗、keepStopSnapshotWarm 會刷新過期快照且失敗時退避、路線索引快取。
// 所在層：tests/unit；bun:test，注入假 fetcher。
// 主要關聯：src/server/stop-cache.ts。

import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import type { JsonFetcher } from "@/providers/types";
import { getStopSnapshot, keepStopSnapshotWarm, peekStopSnapshot, resetStopCacheForTests, stopsByRoute } from "@/server/stop-cache";
import { rawStop } from "@/providers/new-taipei/test-fixtures";

const TOTAL = 10_500;

function countingFetcher() {
  let pageCalls = 0;
  let failing = false;
  let failedCalls = 0;
  const fetcher: JsonFetcher = async (url) => {
    if (failing) {
      failedCalls++;
      throw new Error("upstream down");
    }
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
    get failedCalls() {
      return failedCalls;
    },
    fail() {
      failing = true;
    },
    recover() {
      failing = false;
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

  test("過期後：立刻回舊資料不等上游，背景刷新完成後換新版", async () => {
    const upstream = countingFetcher();
    setSystemTime(new Date("2026-09-28T00:00:00Z"));
    const first = await getStopSnapshot("new-taipei", upstream.fetcher);
    expect(first.backgroundRefresh).toBeUndefined();
    expect(first.expired).toBe(false);

    setSystemTime(new Date("2026-09-28T13:00:00Z"));
    const callsBefore = upstream.pageCalls;
    const expired = await getStopSnapshot("new-taipei", upstream.fetcher);
    // 回來的是舊快照本身：證明沒有等上游。刷新還沒失敗過，所以不是 stale。
    expect(expired.stops).toBe(first.stops);
    expect(expired.stale).toBe(false);
    // 刷新結果未定：route 靠這個旗標縮短 CDN 快取，否則之後的失敗狀態傳不出去。
    expect(expired.expired).toBe(true);
    expect(expired.backgroundRefresh).toBeInstanceOf(Promise);

    // 刷新進行中再來的請求不能再發動一輪。
    const concurrent = await getStopSnapshot("new-taipei", upstream.fetcher);
    expect(concurrent.backgroundRefresh).toBeUndefined();
    expect(concurrent.expired).toBe(true);

    await expired.backgroundRefresh;
    expect(upstream.pageCalls).toBe(callsBefore * 2);
    const refreshed = await getStopSnapshot("new-taipei", upstream.fetcher);
    expect(refreshed.stops).not.toBe(first.stops);
    expect(refreshed.loadedAt.toISOString()).toBe("2026-09-28T13:00:00.000Z");
    expect(refreshed.stale).toBe(false);
    expect(refreshed.expired).toBe(false);
  });

  test("背景刷新失敗：Promise 不 reject；之後沿用舊資料並標 stale，loadedAt 維持舊時間", async () => {
    const upstream = countingFetcher();
    setSystemTime(new Date("2026-09-28T00:00:00Z"));
    const first = await getStopSnapshot("new-taipei", upstream.fetcher);
    setSystemTime(new Date("2026-09-29T00:00:00Z"));
    upstream.fail();
    const expired = await getStopSnapshot("new-taipei", upstream.fetcher);
    // 失敗要轉成 stale 狀態而非 unhandled rejection；若 reject，這行 await 會讓測試失敗。
    await expired.backgroundRefresh;

    const after = await getStopSnapshot("new-taipei", upstream.fetcher);
    expect(after.stops).toBe(first.stops);
    expect(after.stale).toBe(true);
    expect(after.expired).toBe(true);
    expect(after.loadedAt.toISOString()).toBe("2026-09-28T00:00:00.000Z");
  });

  test("背景刷新失敗後退避 5 分鐘才重試；重試成功就解除 stale", async () => {
    const upstream = countingFetcher();
    setSystemTime(new Date("2026-09-28T00:00:00Z"));
    await getStopSnapshot("new-taipei", upstream.fetcher);
    setSystemTime(new Date("2026-09-29T00:00:00Z"));
    upstream.fail();
    await (await getStopSnapshot("new-taipei", upstream.fetcher)).backgroundRefresh;
    const failedCalls = upstream.failedCalls;

    setSystemTime(new Date("2026-09-29T00:04:00Z"));
    const duringBackoff = await getStopSnapshot("new-taipei", upstream.fetcher);
    expect(duringBackoff.backgroundRefresh).toBeUndefined();
    expect(upstream.failedCalls).toBe(failedCalls);

    setSystemTime(new Date("2026-09-29T00:06:00Z"));
    upstream.recover();
    const retry = await getStopSnapshot("new-taipei", upstream.fetcher);
    // 重試這一刻仍是舊資料、仍標 stale：新資料還沒到手，不能提前宣稱已恢復。
    expect(retry.stale).toBe(true);
    await retry.backgroundRefresh;
    const recovered = await getStopSnapshot("new-taipei", upstream.fetcher);
    expect(recovered.stale).toBe(false);
    expect(recovered.expired).toBe(false);
    expect(recovered.loadedAt.toISOString()).toBe("2026-09-29T00:06:00.000Z");
  });

  test("從來沒成功過：直接拋錯", async () => {
    const upstream = countingFetcher();
    upstream.fail();
    await expect(getStopSnapshot("new-taipei", upstream.fetcher)).rejects.toThrow("upstream down");
  });
});

describe("peekStopSnapshot／keepStopSnapshotWarm／stopsByRoute", () => {
  test("peek 只看現有快照、不觸發上游抓取（/api/trucks 不能被冷啟動拖慢）", async () => {
    const upstream = countingFetcher();
    expect(peekStopSnapshot("new-taipei")).toEqual({ snapshot: undefined, loadFailed: false });
    expect(upstream.pageCalls).toBe(0);

    await keepStopSnapshotWarm("new-taipei", upstream.fetcher);
    expect(peekStopSnapshot("new-taipei").snapshot?.stops.length).toBe(TOTAL);
  });

  test("冷啟動失敗：peek 回報 loadFailed（不能和「還在載入」混為一談），退避期間不重打上游", async () => {
    const upstream = countingFetcher();
    upstream.fail();
    setSystemTime(new Date("2026-09-28T00:00:00Z"));
    await keepStopSnapshotWarm("new-taipei", upstream.fetcher); // 不會 reject
    expect(peekStopSnapshot("new-taipei").loadFailed).toBe(true);

    const failedCalls = upstream.failedCalls;
    await keepStopSnapshotWarm("new-taipei", upstream.fetcher);
    expect(upstream.failedCalls).toBe(failedCalls);

    // 退避期過後重試成功：loadFailed 清除。
    upstream.recover();
    setSystemTime(new Date("2026-09-28T00:06:00Z"));
    await keepStopSnapshotWarm("new-taipei", upstream.fetcher);
    expect(peekStopSnapshot("new-taipei")).toMatchObject({ loadFailed: false });
    expect(peekStopSnapshot("new-taipei").snapshot?.stops.length).toBe(TOTAL);
  });

  test("快照過期時 keepStopSnapshotWarm 會刷新（只靠 /api/trucks 的機器也不會永遠用舊班表）", async () => {
    const upstream = countingFetcher();
    setSystemTime(new Date("2026-09-28T00:00:00Z"));
    await keepStopSnapshotWarm("new-taipei", upstream.fetcher);
    const first = peekStopSnapshot("new-taipei").snapshot!;

    // 還新鮮：不打上游。
    const calls = upstream.pageCalls;
    await keepStopSnapshotWarm("new-taipei", upstream.fetcher);
    expect(upstream.pageCalls).toBe(calls);

    setSystemTime(new Date("2026-09-28T13:00:00Z"));
    await keepStopSnapshotWarm("new-taipei", upstream.fetcher);
    expect(upstream.pageCalls).toBeGreaterThan(calls);
    expect(peekStopSnapshot("new-taipei").snapshot).not.toBe(first);
  });

  test("路線索引依快照快取：同一份快照回傳同一個索引", async () => {
    await getStopSnapshot("new-taipei", countingFetcher().fetcher);
    const snapshot = peekStopSnapshot("new-taipei").snapshot!;
    const index = stopsByRoute(snapshot);
    expect(stopsByRoute(snapshot)).toBe(index);
    const total = [...index.values()].reduce((sum, stops) => sum + stops.length, 0);
    expect(total).toBe(TOTAL);
  });
});
