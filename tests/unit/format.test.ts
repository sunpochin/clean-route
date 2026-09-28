// 檔案用途：驗證畫面文案格式：距離、相對日期、倒數（特別是「已過表定」不能說成「快到了」）。
// 所在層：tests/unit；bun:test。
// 主要關聯：src/lib/format.ts。

import { describe, expect, test } from "bun:test";
import { formatAge, formatCountdown, formatDayLabel, formatDistance } from "@/lib/format";

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
