// 檔案用途：畫面文案的格式化工具（距離、收運種類、下一班的相對日期、資料新舊）。
// 所在層：src/lib；純函式，瀏覽器端元件共用，讓同一種資訊在每張卡片上說法一致。
// 主要關聯：src/components/PlaceCard.tsx、src/components/PlaceDetail.tsx、src/components/NearbyView.tsx、src/components/TruckStatus.tsx、tests/unit/format.test.ts。

import { stopsUntil } from "@/domain/route-progress";
import type { NextPickup } from "@/domain/schedule";
import type { ServiceType, Weekday } from "@/domain/types";
import type { ProgressUnavailableReason, TruckProgress } from "./api-contract";

export const SERVICE_LABEL: Record<ServiceType, string> = {
  garbage: "一般垃圾",
  recycling: "資源回收",
  foodScraps: "廚餘",
};

const WEEKDAY_LABEL: Record<Weekday, string> = { 0: "週日", 1: "週一", 2: "週二", 3: "週三", 4: "週四", 5: "週五", 6: "週六" };
/** 週班表日期格內的單字標籤；格子只有約 40 px 寬，放不下「週一」兩個字加大字級。 */
export const WEEKDAY_SHORT: Record<Weekday, string> = { 0: "日", 1: "一", 2: "二", 3: "三", 4: "四", 5: "五", 6: "六" };

/** 「週一、週三、週五」；呼叫端負責排序（通常是 WEEK_ORDER）。 */
export function formatWeekdayList(days: readonly Weekday[]): string {
  return days.map((d) => WEEKDAY_LABEL[d]).join("、");
}

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

/**
 * 「車開到第幾站、離這一站還差幾站」。結論（還差幾站／可能已經過了）放最前面：手機上這行會折成兩行，
 * 站在門口瞄一眼的人要先看到答案，站序只是佐證。
 * 站序是用 GPS 比對推估的（約 ±1 站），所以一律說「附近」「約」，
 * 也不換算成分鐘：還沒有可靠的估算模型前，不能把站數說成預計到達時間（AGENTS.md § 3.4）。
 * 車的站序已超過這一站時只說「可能已經過了」：比對有誤差，車也可能漏收後折返。
 */
const UNAVAILABLE_TEXT: Record<ProgressUnavailableReason, string> = {
  scheduleLoading: "班表載入中，稍後顯示車開到第幾站",
  scheduleFailed: "班表抓取失敗，無法判斷車開到第幾站",
  routeNotInSchedule: "班表裡找不到這條路線，無法判斷車開到第幾站",
};

export function formatRouteProgress(progress: TruckProgress, stopSequence: number): string {
  if (progress.status === "unavailable") return UNAVAILABLE_TEXT[progress.reason];
  if (progress.status === "ambiguous") return "路線會繞回這一帶，無法判斷車開到第幾站";
  if (progress.status === "offRoute") return "車目前不在路線的站點附近，無法判斷開到第幾站";
  const remaining = stopsUntil(progress, stopSequence);
  if (remaining > 0) return `還差約 ${remaining} 站（車在第 ${progress.sequence} 站附近，這裡是第 ${stopSequence} 站）`;
  if (remaining === 0) return `車就在這一站附近（第 ${stopSequence} 站）`;
  return `車可能已經過了（車在第 ${progress.sequence} 站附近，這裡是第 ${stopSequence} 站）`;
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

/** 過期資料要讓人看出「是哪一天」的版本，只顯示時刻會讓昨天的資料看起來像今天的。 */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
