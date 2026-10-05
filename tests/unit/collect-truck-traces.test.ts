// 檔案用途：驗證 GPS 軌跡收集腳本的純邏輯：參數檢查、台北日期切檔、重啟後的去重接續、班表快照的原子寫入。
// 所在層：tests/unit；bun:test。收集迴圈本身（打上游、睡眠）不在這裡測，見 PR #7 的實測紀錄。
// 主要關聯：scripts/collect-truck-traces.ts。

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseArgs,
  pickFreshRows,
  seedLastRecordedAt,
  stopsFile,
  taipeiDate,
  writeStopsSnapshot,
} from "../../scripts/collect-truck-traces";
import type { GarbageTruck } from "@/domain/types";
import { BANQIAO_STATION } from "../fixtures/landmarks";

function truck(id: string, recordedAt: string): GarbageTruck {
  return { id, city: "new-taipei", routeId: "R1", location: BANQIAO_STATION, recordedAt };
}

describe("parseArgs", () => {
  test("預設值與各參數", () => {
    expect(parseArgs([], "out")).toEqual({ intervalS: 30, outDir: "out" });
    expect(parseArgs(["--interval", "60", "--hours=8", "--out", "x"], "out")).toEqual({ intervalS: 60, outDir: "x", hours: 8 });
  });

  test("拒絕過快的間隔、非正數與非有限的時數（--hours Infinity 會變成永遠不停，PR #7 review）", () => {
    expect(() => parseArgs(["--interval", "5"], "out")).toThrow("至少 10 秒");
    expect(() => parseArgs(["--hours", "0"], "out")).toThrow("有限數字");
    expect(() => parseArgs(["--hours", "Infinity"], "out")).toThrow("有限數字");
    expect(() => parseArgs(["--hours", "1e999"], "out")).toThrow("有限數字");
    expect(() => parseArgs(["--hours", "abc"], "out")).toThrow("有限數字");
    expect(() => parseArgs(["--bogus", "1"], "out")).toThrow("未知參數");
  });
});

describe("taipeiDate", () => {
  test("以台北日期切檔：UTC 16:00 已是台北隔天（AGENTS.md § 3.3）", () => {
    expect(taipeiDate(new Date("2026-09-29T15:59:59Z"))).toBe("2026-09-29");
    expect(taipeiDate(new Date("2026-09-29T16:00:00Z"))).toBe("2026-09-30");
  });
});

describe("seedLastRecordedAt／pickFreshRows", () => {
  test("重啟後接續去重：既有檔案裡出現過的定位不再寫一次（PR #7 review）", () => {
    const existing = [
      JSON.stringify({ id: "A", recordedAt: "2026-09-29T03:36:21.000Z" }),
      JSON.stringify({ id: "A", recordedAt: "2026-09-29T03:37:41.000Z" }),
      JSON.stringify({ id: "B", recordedAt: "2026-09-29T03:30:00.000Z" }),
    ].join("\n");
    const last = new Map<string, string>();
    expect(seedLastRecordedAt(existing, last)).toEqual({ rows: 3, badLines: 0 });
    expect(last.get("A")).toBe("2026-09-29T03:37:41.000Z");

    const fresh = pickFreshRows(
      [truck("A", "2026-09-29T03:37:41.000Z"), truck("B", "2026-09-29T03:31:00.000Z"), truck("C", "2026-09-29T03:31:00.000Z")],
      "2026-09-29T03:38:00.000Z",
      last,
    );
    expect(fresh.map((r) => r.id)).toEqual(["B", "C"]);
  });

  test("檔案行序不保證時間序：取每台車最新的那筆", () => {
    const last = new Map<string, string>();
    seedLastRecordedAt(
      [JSON.stringify({ id: "A", recordedAt: "2026-09-29T05:00:00.000Z" }), JSON.stringify({ id: "A", recordedAt: "2026-09-29T04:00:00.000Z" })].join("\n"),
      last,
    );
    expect(last.get("A")).toBe("2026-09-29T05:00:00.000Z");
  });

  test("上次中止留下的殘缺行：略過並回報，不讓收集停下", () => {
    const last = new Map<string, string>();
    const text = `${JSON.stringify({ id: "A", recordedAt: "2026-09-29T03:36:21.000Z" })}\n{"id":"B","recor`;
    expect(seedLastRecordedAt(text, last)).toEqual({ rows: 1, badLines: 1 });
    expect(last.has("B")).toBe(false);
  });

  test("同一筆定位掛很久也只寫一次（上游會把過期定位掛好幾小時）", () => {
    const last = new Map<string, string>();
    const stale = truck("A", "2026-09-28T14:56:23.000Z");
    expect(pickFreshRows([stale], "2026-09-28T15:00:00.000Z", last)).toHaveLength(1);
    expect(pickFreshRows([stale], "2026-09-28T18:00:00.000Z", last)).toHaveLength(0);
  });
});

describe("writeStopsSnapshot", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  test("寫完才出現在正式檔名下，不留暫存檔", () => {
    dir = mkdtempSync(join(tmpdir(), "traces-"));
    const file = stopsFile(dir, "2026-09-29");
    writeStopsSnapshot(file, { loadedAt: "2026-09-29T00:00:00.000Z", skipped: 0, stops: [] });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ loadedAt: "2026-09-29T00:00:00.000Z", skipped: 0, stops: [] });
    expect(readdirSync(dir)).toEqual(["stops-2026-09-29.json"]);
  });

  test("寫入失敗時往上拋，且正式檔名下不會出現殘缺的快照（PR #7 review）", () => {
    dir = mkdtempSync(join(tmpdir(), "traces-"));
    const file = stopsFile(join(dir, "missing-dir"), "2026-09-29");
    expect(() => writeStopsSnapshot(file, { loadedAt: "x", skipped: 0, stops: [] })).toThrow();
    expect(existsSync(file)).toBe(false);
  });
});
