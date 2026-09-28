// 檔案用途：驗證「下一班」推算：當天、寬限期、跨日、跨週與時區邊界。
// 所在層：tests/unit；bun:test。
// 主要關聯：src/domain/schedule.ts。

import { describe, expect, test } from "bun:test";
import { LATE_GRACE_MINUTES, nextPickup } from "@/domain/schedule";
import type { ServiceType } from "@/domain/types";

const none: ServiceType[] = [];
// 週一：垃圾＋回收；週二：垃圾；其他天不收。
const stop = {
  timeOfDay: "19:40",
  weeklyServices: [none, ["garbage", "recycling"], ["garbage"], none, none, none, none] as ServiceType[][],
};

/** 以台北當地時間建立 Date（2026-09-28 是星期一）。 */
const taipei = (isoLocal: string) => new Date(`${isoLocal}+08:00`);

describe("nextPickup", () => {
  test("今天稍晚有班：dayOffset 0，列出當天收運種類", () => {
    const next = nextPickup(stop, taipei("2026-09-28T19:00:00"))!;
    expect(next.dayOffset).toBe(0);
    expect(next.services).toEqual(["garbage", "recycling"]);
    expect(next.minutesUntil).toBe(40);
    expect(next.startsAt.toISOString()).toBe("2026-09-28T11:40:00.000Z");
  });

  test("剛過表定時間、仍在寬限內：還是今天這班，minutesUntil 為負", () => {
    const next = nextPickup(stop, taipei("2026-09-28T19:50:00"))!;
    expect(next.dayOffset).toBe(0);
    expect(next.minutesUntil).toBe(-10);
  });

  test("超過寬限：跳到明天", () => {
    const late = 19 * 60 + 40 + LATE_GRACE_MINUTES + 1;
    const hh = String(Math.floor(late / 60)).padStart(2, "0");
    const mm = String(late % 60).padStart(2, "0");
    const next = nextPickup(stop, taipei(`2026-09-28T${hh}:${mm}:00`))!;
    expect(next.dayOffset).toBe(1);
    expect(next.services).toEqual(["garbage"]);
  });

  test("星期二晚上錯過後，下一班是下週一（跨週）", () => {
    const next = nextPickup(stop, taipei("2026-09-29T22:00:00"))!;
    expect(next.dayOffset).toBe(6);
    expect(next.weekday).toBe(1);
  });

  test("一週只收一天且今天已過：dayOffset 7（下週同一天）", () => {
    const mondayOnly = { timeOfDay: "08:00", weeklyServices: [none, ["garbage"], none, none, none, none, none] as ServiceType[][] };
    expect(nextPickup(mondayOnly, taipei("2026-09-28T12:00:00"))!.dayOffset).toBe(7);
  });

  test("台北已過午夜、UTC 仍是前一天：以台北星期二計算", () => {
    // 台北 2026-09-29（二）00:30 = UTC 2026-09-28（一）16:30
    const next = nextPickup(stop, new Date("2026-09-28T16:30:00Z"))!;
    expect(next.dayOffset).toBe(0);
    expect(next.weekday).toBe(2);
  });

  test("時間格式錯誤或整週不收：回傳 null", () => {
    expect(nextPickup({ ...stop, timeOfDay: "晚上" }, new Date())).toBeNull();
    expect(nextPickup({ timeOfDay: "10:00", weeklyServices: Array(7).fill(none) }, new Date())).toBeNull();
  });
});
