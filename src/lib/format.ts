// 檔案用途：畫面文案的格式化工具（距離、收運種類、下一班的相對日期、資料新舊）。
// 所在層：src/lib；純函式，瀏覽器端元件共用，讓同一種資訊在每張卡片上說法一致。
// 主要關聯：src/components/StopCard.tsx、src/components/NearbyView.tsx、tests/unit/format.test.ts。

import type { NextPickup } from "@/domain/schedule";
import type { ServiceType, Weekday } from "@/domain/types";

export const SERVICE_LABEL: Record<ServiceType, string> = {
  garbage: "一般垃圾",
  recycling: "資源回收",
  foodScraps: "廚餘",
};

const WEEKDAY_LABEL: Record<Weekday, string> = { 0: "週日", 1: "週一", 2: "週二", 3: "週三", 4: "週四", 5: "週五", 6: "週六" };

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} 公尺`;
  return `${(meters / 1000).toFixed(1)} 公里`;
}

export function formatDayLabel(pickup: Pick<NextPickup, "dayOffset" | "weekday">): string {
  if (pickup.dayOffset === 0) return "今天";
  if (pickup.dayOffset === 1) return "明天";
  if (pickup.dayOffset === 7) return `下${WEEKDAY_LABEL[pickup.weekday]}`;
  return WEEKDAY_LABEL[pickup.weekday];
}

/**
 * 「還有多久」只在今天、且 3 小時內才顯示；再遠的相對時間對「要不要現在出門」沒有幫助，只會讓卡片變長。
 * 已過表定時間時明講「已過 N 分鐘」，而不是說車「快到了」——表定時間不是預計到達時間（AGENTS.md § 3.4）。
 */
export function formatCountdown(pickup: Pick<NextPickup, "dayOffset" | "minutesUntil">): string | null {
  if (pickup.dayOffset !== 0) return null;
  const m = pickup.minutesUntil;
  if (m < 0) return `已過表定 ${-m} 分鐘，車可能還在附近`;
  if (m === 0) return "表定就是現在";
  if (m <= 180) return m < 60 ? `${m} 分鐘後` : `${Math.floor(m / 60)} 小時 ${m % 60} 分鐘後`;
  return null;
}

export function formatAge(ms: number): string {
  if (ms < 60_000) return "剛剛";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} 分鐘前`;
  return `${Math.floor(minutes / 60)} 小時前`;
}

export function formatClock(iso: string): string {
  // 顯示用時間也固定台北時區：出差或手機時區設錯時，「幾點抓的資料」仍要跟班表同一把尺。
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).format(
    new Date(iso),
  );
}
