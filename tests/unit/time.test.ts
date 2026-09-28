// 檔案用途：驗證台北時間換算在「UTC 伺服器」與跨午夜情境下仍正確（AGENTS.md § 3.3）。
// 所在層：tests/unit；bun:test。
// 主要關聯：src/domain/time.ts。

import { describe, expect, test } from "bun:test";
import { formatTimeOfDay, parseTaipeiLocalDateTime, parseTimeOfDay, taipeiClock } from "@/domain/time";

describe("taipeiClock", () => {
  test("UTC 12:30 是台北同日 20:30", () => {
    const clock = taipeiClock(new Date("2026-09-28T12:30:00Z")); // 2026-09-28 是星期一
    expect(clock.weekday).toBe(1);
    expect(clock.minuteOfDay).toBe(20 * 60 + 30);
    expect(new Date(clock.midnightEpochMs).toISOString()).toBe("2026-09-27T16:00:00.000Z");
  });

  test("UTC 還是星期一 17:00 時，台北已經是星期二 01:00", () => {
    // 這就是直接用 getDay() 在 Vercel（UTC）上會算錯的情境。
    const clock = taipeiClock(new Date("2026-09-28T17:00:00Z"));
    expect(clock.weekday).toBe(2);
    expect(clock.minuteOfDay).toBe(60);
  });
});

describe("parseTimeOfDay / formatTimeOfDay", () => {
  test("接受一位數小時並補零輸出", () => {
    expect(parseTimeOfDay("7:05")).toBe(425);
    expect(formatTimeOfDay(425)).toBe("07:05");
  });

  test("拒絕不合法時間", () => {
    for (const bad of ["", "24:00", "12:60", "1240", "12:4", "abc"]) expect(parseTimeOfDay(bad)).toBeNull();
  });
});

describe("parseTaipeiLocalDateTime", () => {
  test("新北 GPS 時間字串視為台北時間", () => {
    expect(parseTaipeiLocalDateTime("2026/09/28 17:42:20")).toBe("2026-09-28T09:42:20.000Z");
  });

  test("不存在的日期時間不會被進位成合法時間", () => {
    for (const bad of ["2026/02/31 12:00:00", "2026/13/01 12:00:00", "2026/09/28 24:30:00", "2026/09/28 12:60:00"]) {
      expect(parseTaipeiLocalDateTime(bad)).toBeNull();
    }
    expect(parseTaipeiLocalDateTime("2028/02/29 12:00:00")).toBe("2028-02-29T04:00:00.000Z");
  });

  test("格式不符回傳 null 而不是猜", () => {
    expect(parseTaipeiLocalDateTime("")).toBeNull();
    expect(parseTaipeiLocalDateTime("昨天下午")).toBeNull();
  });
});
