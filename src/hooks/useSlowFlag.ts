"use client";

// 檔案用途：某個等待狀態持續超過指定時間後回傳 true，讓畫面在「等很久」時補充說明原因。
// 所在層：src/hooks；瀏覽器專用、無資料依賴。
// 主要關聯：src/components/MapStatusBanner.tsx、src/components/PlaceList.tsx。

import { useEffect, useState } from "react";

/**
 * 為什麼不一開始就顯示「可能要十幾秒」：伺服器快取熱的時候查詢不到 1 秒，
 * 一打開就看到「請耐心等候」反而讓人以為 App 很慢；只有真的等久了才解釋。
 */
export function useSlowFlag(active: boolean, afterMs: number): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setSlow(true), afterMs);
    return () => {
      clearTimeout(timer);
      // 下一次等待要重新計時，不能沿用上一次的「已經很久」。
      setSlow(false);
    };
  }, [active, afterMs]);
  return active && slow;
}
