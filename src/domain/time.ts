// 檔案用途：所有「台北當地時間」的換算工具（星期幾、當日分鐘數、HH:MM 解析）。
// 所在層：src/domain；AGENTS.md § 3.3 規定清運時間計算一律經過本檔。
// 主要關聯：src/domain/schedule.ts（下一班推算）、src/providers/new-taipei（GPS 時間字串轉 ISO）。

import type { Weekday } from "./types";

/**
 * 台灣自 1979 年起不實施日光節約時間，UTC+8 是固定偏移。
 * 為什麼不用 Intl.DateTimeFormat({ timeZone }) ：固定偏移的算術結果完全可預測、
 * 在 Edge／Worker／bun test 各種執行環境行為一致，也不必解析 formatToParts 的字串。
 */
export const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface TaipeiClock {
  weekday: Weekday;
  /** 當日 00:00 起算的分鐘數（0–1439）。 */
  minuteOfDay: number;
  /** 台北當日 00:00 的絕對時間（epoch ms），用來組出「第 N 天後幾點幾分」。 */
  midnightEpochMs: number;
}

export function taipeiClock(now: Date): TaipeiClock {
  // 把絕對時間平移 +8 小時後用 UTC getter 讀，等於讀出台北牆上時鐘；
  // 絕不能用 getDay()/getHours()，那會讀到伺服器（Vercel 是 UTC）或手機的本地時區。
  const shifted = new Date(now.getTime() + TAIPEI_OFFSET_MS);
  const minuteOfDay = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  const shiftedMidnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return {
    weekday: shifted.getUTCDay() as Weekday,
    minuteOfDay,
    midnightEpochMs: shiftedMidnight - TAIPEI_OFFSET_MS,
  };
}

/** `"7:05"`、`"19:40"` → 當日分鐘數；格式不符回傳 null，由呼叫端決定要丟棄還是報錯。 */
export function parseTimeOfDay(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** 統一輸出成兩位數 `HH:MM`，讓畫面與排序都一致。 */
export function formatTimeOfDay(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 台北某天 00:00 往後 dayOffset 天、minuteOfDay 分的絕對時間。 */
export function taipeiDateAt(clock: TaipeiClock, dayOffset: number, minuteOfDay: number): Date {
  return new Date(clock.midnightEpochMs + dayOffset * DAY_MS + minuteOfDay * 60_000);
}

/**
 * 新北 GPS 的 `"2026/09/28 17:42:20"`（台北當地時間、無時區標記）→ ISO 字串。
 * 解析失敗回傳 null：時間戳是判斷資料是否過期的依據，寧可讓呼叫端丟棄該筆，也不能猜。
 */
export function parseTaipeiLocalDateTime(value: string): string | null {
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const parts = [+y, +mo - 1, +d, +h, +mi, s ? +s : 0] as const;
  const wall = new Date(Date.UTC(...parts));
  // Date.UTC 會把超出範圍的欄位「進位」而不是報錯（2/31 → 3/3、25:00 → 隔天 01:00）。
  // 壞掉的時間戳若被進位成看似合理甚至未來的時間，過期判斷就會被騙，所以逐欄比對確認沒有進位。
  const roundTrip = [
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate(),
    wall.getUTCHours(),
    wall.getUTCMinutes(),
    wall.getUTCSeconds(),
  ];
  if (roundTrip.some((value, i) => value !== parts[i])) return null;
  return new Date(wall.getTime() - TAIPEI_OFFSET_MS).toISOString();
}
