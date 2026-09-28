"use client";

// 檔案用途：每隔固定時間更新一次的「現在時間」，讓倒數與「幾分鐘前」文案會自己前進。
// 所在層：src/hooks；瀏覽器專用。
// 主要關聯：src/components/NearbyView.tsx。

import { useEffect, useState } from "react";

export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    // 手機從背景切回來時 setInterval 可能停了好幾分鐘，立刻更新一次，避免顯示過時的倒數。
    const onVisible = () => document.visibilityState === "visible" && setNow(new Date());
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);
  return now;
}
