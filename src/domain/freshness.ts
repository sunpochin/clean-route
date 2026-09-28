// 檔案用途：判斷即時 GPS 資料是否過期的單一門檻與工具函式。
// 所在層：src/domain；AGENTS.md § 3.4「過期的 GPS ≠ 即時位置」的落地點。
// 主要關聯：src/components/*（顯示「位置可能過期」）、docs/data-sources/new-taipei.md（上游延遲實測）。

/**
 * 2026-09 實測新北上游 GPS 本身就延遲約 1～2.5 分鐘（中位數 1.3 分鐘），
 * 所以門檻不能設太緊，否則每台車都被標成過期；超過 5 分鐘通常代表車輛收班、訊號中斷或上游卡住。
 */
export const STALE_TRUCK_MS = 5 * 60 * 1000;

export function ageMs(recordedAt: string, now: Date): number | null {
  const t = Date.parse(recordedAt);
  return Number.isNaN(t) ? null : now.getTime() - t;
}

/** 無法解析的時間戳一律視為過期：不知道多舊的位置不能當成即時位置。 */
export function isStale(recordedAt: string, now: Date): boolean {
  const age = ageMs(recordedAt, now);
  return age === null || age > STALE_TRUCK_MS;
}
