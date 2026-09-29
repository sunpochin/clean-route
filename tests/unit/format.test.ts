// 檔案用途：驗證畫面文案格式：距離、相對日期、倒數（特別是「已過表定」不能說成「快到了」）、車開到第幾站。
// 所在層：tests/unit；bun:test。
// 主要關聯：src/lib/format.ts。

import { describe, expect, test } from "bun:test";
import { formatAge, formatCountdown, formatDayLabel, formatDistance, formatRouteProgress, formatWeekdayList } from "@/lib/format";

describe("formatDistance", () => {
  test("一公里內以 10 公尺為單位，以上用公里", () => {
    expect(formatDistance(213)).toBe("210 公尺");
    expect(formatDistance(1234)).toBe("1.2 公里");
  });
});

describe("formatDayLabel", () => {
  test("今天、明天、星期、下週同一天", () => {
    expect(formatDayLabel({ dayOffset: 0, weekday: 1 })).toBe("今天");
    expect(formatDayLabel({ dayOffset: 1, weekday: 2 })).toBe("明天");
    expect(formatDayLabel({ dayOffset: 3, weekday: 4 })).toBe("週四");
    expect(formatDayLabel({ dayOffset: 7, weekday: 1 })).toBe("下週一");
  });
});

describe("formatCountdown", () => {
  test("已過表定時明講已過，不暗示車快到", () => {
    expect(formatCountdown({ dayOffset: 0, minutesUntil: -5 })).toBe("已過表定 5 分鐘，車可能還在附近");
  });

  test("三小時內顯示倒數，超過或不是今天則不顯示", () => {
    expect(formatCountdown({ dayOffset: 0, minutesUntil: 40 })).toBe("40 分鐘後");
    expect(formatCountdown({ dayOffset: 0, minutesUntil: 95 })).toBe("1 小時 35 分鐘後");
    expect(formatCountdown({ dayOffset: 0, minutesUntil: 200 })).toBeNull();
    expect(formatCountdown({ dayOffset: 1, minutesUntil: 30 })).toBeNull();
  });
});

describe("formatAge", () => {
  test("一分鐘內顯示剛剛", () => {
    expect(formatAge(30_000)).toBe("剛剛");
    expect(formatAge(5 * 60_000)).toBe("5 分鐘前");
  });
});

describe("formatWeekdayList", () => {
  test("依傳入順序列出，週日不會被數字 0 排到最前面", () => {
    expect(formatWeekdayList([3, 0])).toBe("週三、週日");
    expect(formatWeekdayList([])).toBe("");
  });
});

describe("formatRouteProgress", () => {
  const at = (sequence: number) => ({ status: "matched", sequence, distanceM: 20 }) as const;

  test("車還沒到：說出車的站、這裡的站、還差約幾站", () => {
    expect(formatRouteProgress(at(12), 18)).toBe("還差約 6 站（車在第 12 站附近，這裡是第 18 站）");
  });

  test("同一站與已超過：超過時只說「可能」已經過了", () => {
    expect(formatRouteProgress(at(18), 18)).toBe("車就在這一站附近（第 18 站）");
    expect(formatRouteProgress(at(20), 18)).toBe("車可能已經過了（車在第 20 站附近，這裡是第 18 站）");
  });

  test("判斷不出來的每種原因各有說法，且都不出現站數；「班表抓取失敗」要明說是失敗", () => {
    const texts = [
      formatRouteProgress({ status: "ambiguous" }, 18),
      formatRouteProgress({ status: "offRoute" }, 18),
      formatRouteProgress({ status: "unavailable", reason: "scheduleLoading" }, 18),
      formatRouteProgress({ status: "unavailable", reason: "scheduleFailed" }, 18),
      formatRouteProgress({ status: "unavailable", reason: "routeNotInSchedule" }, 18),
    ];
    expect(new Set(texts).size).toBe(texts.length);
    for (const text of texts) expect(text).not.toMatch(/還差/);
    expect(formatRouteProgress({ status: "unavailable", reason: "scheduleFailed" }, 18)).toContain("抓取失敗");
  });
});
