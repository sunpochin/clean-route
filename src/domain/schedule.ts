// 檔案用途：由清運點的「每週固定行程」推算下一班的日期、時刻與收運種類。
// 所在層：src/domain；純函式，時間一律透過 src/domain/time.ts 以 Asia/Taipei 計算（AGENTS.md § 3.3）。
// 主要關聯：src/components/StopCard.tsx（顯示下一班）、tests/unit/schedule.test.ts。

import { parseTimeOfDay, taipeiClock, taipeiDateAt } from "./time";
import type { GarbageStop, ServiceType, Weekday } from "./types";

/**
 * 表定時間過了多久內仍視為「這一班」。
 * 為什麼需要寬限：垃圾車常晚到 5～15 分鐘；表定 19:40、現在 19:45 時，
 * 直接跳到「下週二」會讓使用者以為車已經走了而放棄出門，這比多顯示幾分鐘更糟。
 */
export const LATE_GRACE_MINUTES = 15;

export interface NextPickup {
  /** 0 = 今天、1 = 明天…（台北日期）；最多 7，代表下週同一天。 */
  dayOffset: number;
  weekday: Weekday;
  services: readonly ServiceType[];
  startsAt: Date;
  /** 距離表定時間的分鐘數；負值代表已過表定時間但仍在寬限內。 */
  minutesUntil: number;
}

export function nextPickup(stop: Pick<GarbageStop, "timeOfDay" | "weeklyServices">, now: Date): NextPickup | null {
  const stopMinute = parseTimeOfDay(stop.timeOfDay);
  if (stopMinute === null) return null;

  const clock = taipeiClock(now);
  // 掃 0..7 共 8 天：第 7 天是「今天同星期、但今天這班已過」時的下週同一天。
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const weekday = ((clock.weekday + dayOffset) % 7) as Weekday;
    const services = stop.weeklyServices[weekday] ?? [];
    if (services.length === 0) continue;
    if (dayOffset === 0 && stopMinute < clock.minuteOfDay - LATE_GRACE_MINUTES) continue;

    const startsAt = taipeiDateAt(clock, dayOffset, stopMinute);
    return {
      dayOffset,
      weekday,
      services,
      startsAt,
      minutesUntil: Math.round((startsAt.getTime() - now.getTime()) / 60_000),
    };
  }
  return null;
}
