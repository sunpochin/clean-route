// 檔案用途：長時間輪詢新北即時 GPS，把每台垃圾車的位置軌跡存成 JSONL，每個台北日期存一份清運點班表快照，
//           並把每一次抓取的結果（成功幾台、失敗原因）另外記下來；這批資料是「車開到第幾站」比對
//           （src/domain/route-progress.ts）的真實評估集，取代目前只有模擬數據的狀態。
// 所在層：scripts；手動執行（`bun run collect:traces`），不在 App 的執行路徑上。輸出放 data/traces/（已列入 .gitignore）。
// 主要關聯：src/providers/registry.ts（只經由 registry 取得 provider，遵守 AGENTS.md § 3.2）、
//           docs/data-sources/new-taipei.md（收集方式與資料格式）、docs/DECISIONS.md D9（為什麼需要評估集）、
//           tests/unit/collect-truck-traces.test.ts（參數、去重、快照寫入）。
//
// 為什麼要收：模擬只涵蓋「車剛好停在某站旁」；真實軌跡才有兩站之間的行駛、實際晚到多少、暫停與回場。
// 為什麼存正規化後的 domain 型別而不是原始欄位：原始欄位只准出現在 provider 資料夾內；評估腳本也只該認識 GarbageTruck／GarbageStop。
// 車輛位置是政府公開資料、不含任何使用者位置，存到本機不違反 § 3.5；但仍不提交進 git，資料量大且與程式碼無關。
//
// 錯誤分兩種，處理方式刻意不同（PR #7 review）：
// - 上游抓不到（UpstreamError）：可恢復。上游維護可能持續幾十分鐘，中斷收集會損失後面的資料；照樣記進 polls 檔。
// - 寫檔失敗（磁碟滿、權限、目錄被移走）：不可恢復，直接中止並回傳非零結束碼。
//   否則 --hours 的無人收集會「成功結束」卻少一大段資料，而評估時根本不會知道。

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TAIPEI_OFFSET_MS } from "@/domain/time";
import type { GarbageStop, GarbageTruck } from "@/domain/types";
import { getProvider, type JsonFetcher, UpstreamError } from "@/providers/registry";

/** 上游 GPS 約每分鐘更新一次；30 秒抓一次可以把更新時間點抓得比較準，再快只會抓到重複資料。 */
const DEFAULT_INTERVAL_S = 30;
/** 上游偶爾卡住不回；沒有 timeout 的話整個收集會停在那一次。 */
const UPSTREAM_TIMEOUT_MS = 15_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 一行軌跡：抓取時間 + 車輛正規化資料（去掉 address：反查門牌對評估沒用，檔案卻大一半）。 */
export interface TraceRow {
  fetchedAt: string;
  id: string;
  routeId: string;
  recordedAt: string;
  lat: number;
  lng: number;
  district?: string;
}

/**
 * 一行抓取紀錄：每次抓取都寫，不論成功、失敗或 0 台。
 * 為什麼需要：軌跡檔只有「有車的時刻」，評估時看不出某段空白是「上游掛了」還是「真的沒車」（AGENTS.md § 3.4）。
 * stopsSnapshot 標示這一天的班表快照在當下是否已存好；false 的時段要當成缺班表。
 */
export type PollRow =
  | { fetchedAt: string; ok: true; online: number; written: number; stopsSnapshot: boolean }
  | { fetchedAt: string; ok: false; error: string; stopsSnapshot: boolean };

export interface Options {
  intervalS: number;
  outDir: string;
  /** 跑滿幾小時自動結束；未指定就跑到 Ctrl+C。 */
  hours?: number;
}

export function parseArgs(argv: string[], defaultOutDir: string): Options {
  const options: Options = { intervalS: DEFAULT_INTERVAL_S, outDir: defaultOutDir };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split("=");
    const value = inline ?? argv[++i];
    if (flag === "--interval") options.intervalS = Number(value);
    else if (flag === "--out") options.outDir = value;
    else if (flag === "--hours") options.hours = Number(value);
    else throw new Error(`未知參數 ${flag}；可用：--interval 秒數 --out 目錄 --hours 小時數`);
  }
  if (!Number.isFinite(options.intervalS) || options.intervalS < 10) throw new Error("--interval 至少 10 秒，別對政府伺服器太兇");
  // 要有限數字：`--hours Infinity` 或溢位的數字會變成「永遠不停」，違背「跑滿幾小時」的意思。
  if (options.hours !== undefined && !(Number.isFinite(options.hours) && options.hours > 0)) {
    throw new Error("--hours 需為大於 0 的有限數字");
  }
  return options;
}

/** 台北當地日期 `YYYY-MM-DD`，用來切檔；不能用 toISOString 直接切，那是 UTC 日期，晚上 8 點後會差一天（AGENTS.md § 3.3）。 */
export function taipeiDate(time: Date | number): string {
  return new Date(new Date(time).getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

function taipeiClockText(now: Date): string {
  return new Date(now.getTime() + TAIPEI_OFFSET_MS).toISOString().slice(11, 19);
}

function log(message: string) {
  console.log(`${taipeiClockText(new Date())} ${message}`);
}

function errorText(error: unknown): string {
  if (error instanceof UpstreamError) return `${error.message}（${error.source}）`;
  return error instanceof Error ? error.message : String(error);
}

function logError(message: string, error: unknown) {
  console.error(`${taipeiClockText(new Date())} ✖ ${message}：${errorText(error)}`);
}

export const stopsFile = (outDir: string, date: string) => join(outDir, `stops-${date}.json`);
export const tracesFile = (outDir: string, date: string) => join(outDir, `trucks-${date}.jsonl`);
export const pollsFile = (outDir: string, date: string) => join(outDir, `polls-${date}.jsonl`);

/**
 * 原子寫入班表快照：先寫暫存檔再改名。直接寫目標檔的話，寫到一半失敗（磁碟滿）會留下殘缺的檔案，
 * 下次 existsSync 就把它當成完整快照，評估時才發現讀不出來（PR #7 review）。同一個磁碟內的 rename 不會只做一半。
 * 寫檔錯誤一律往上拋，由呼叫端中止整個收集。
 */
export function writeStopsSnapshot(file: string, snapshot: { loadedAt: string; skipped: number; stops: GarbageStop[] }) {
  const temp = `${file}.partial`;
  writeFileSync(temp, JSON.stringify(snapshot));
  renameSync(temp, file);
}

/**
 * 從既有的軌跡檔讀回「每台車最後寫入的 recordedAt」，讓重啟後的去重接得上（PR #7 review）。
 * 同一天分好幾段 --hours 收集時，沒有這一步，重啟後的第一次抓取會把當下所有車再寫一次。
 * 上一次若在寫到一半時被中止，最後一行可能殘缺：略過並回報行數，不讓整個收集因此停下。
 */
export function seedLastRecordedAt(jsonl: string, into: Map<string, string>): { rows: number; badLines: number } {
  let rows = 0;
  let badLines = 0;
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Partial<TraceRow>;
      if (typeof row.id !== "string" || typeof row.recordedAt !== "string") throw new Error("缺欄位");
      rows++;
      // recordedAt 都是 toISOString 產生的 UTC 字串，字典序就是時間順序。
      const previous = into.get(row.id);
      if (!previous || row.recordedAt > previous) into.set(row.id, row.recordedAt);
    } catch {
      badLines++;
    }
  }
  return { rows, badLines };
}

/** 把一批新的位置挑出來：recordedAt 沒變就是同一筆定位（上游每次都回「該車最新一筆」），不重寫。 */
export function pickFreshRows(trucks: readonly GarbageTruck[], fetchedAt: string, lastRecordedAt: Map<string, string>): TraceRow[] {
  const fresh: TraceRow[] = [];
  for (const truck of trucks) {
    if (lastRecordedAt.get(truck.id) === truck.recordedAt) continue;
    lastRecordedAt.set(truck.id, truck.recordedAt);
    fresh.push({
      fetchedAt,
      id: truck.id,
      routeId: truck.routeId,
      recordedAt: truck.recordedAt,
      lat: truck.location.lat,
      lng: truck.location.lng,
      district: truck.district,
    });
  }
  return fresh;
}

function appendJsonl(file: string, rows: readonly object[]) {
  if (rows.length === 0) return;
  appendFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

/**
 * 純 fetch 版的 JsonFetcher：這裡沒有 Next data cache，revalidateSeconds 用不到，每次都真的打上游。
 * JSON 解析失敗也包成 UpstreamError：上游回 HTML 維護頁是「上游問題」，應該重試而不是中止收集。
 */
const plainFetcher: JsonFetcher = async (url) => {
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch (error) {
    throw new UpstreamError(`連線失敗：${error instanceof Error ? error.message : String(error)}`, url);
  }
  if (!response.ok) throw new UpstreamError(`HTTP ${response.status}`, url);
  try {
    return await response.json();
  } catch {
    throw new UpstreamError("回應不是合法 JSON", url);
  }
};

async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const options = parseArgs(process.argv.slice(2), join(root, "data", "traces"));
  mkdirSync(options.outDir, { recursive: true });
  const provider = getProvider("new-taipei");

  /** 存好（或本來就有）班表快照的日期。 */
  const snapshotDates = new Set<string>();
  /** 有寫入軌跡的日期；結束時逐一確認都有配對的班表。 */
  const traceDates = new Set<string>();

  /**
   * 確保某一天的班表快照存在。上游抓不到 → 拋 UpstreamError（呼叫端決定要不要重試）；
   * 寫檔失敗 → 拋原本的檔案系統錯誤（呼叫端不得攔下，見檔頭）。
   */
  const ensureStopsSnapshot = async (date: string) => {
    if (snapshotDates.has(date)) return;
    const file = stopsFile(options.outDir, date);
    if (existsSync(file)) {
      log(`班表快照已存在：${file}`);
    } else {
      log(`抓取 ${date} 的清運點班表快照（27 頁，約 5 秒）…`);
      const { stops, skipped } = await provider.fetchStops(plainFetcher);
      writeStopsSnapshot(file, { loadedAt: new Date().toISOString(), skipped, stops });
      log(`班表快照已存：${stops.length} 站（略過 ${skipped} 筆）→ ${file}`);
    }
    snapshotDates.add(date);
  };

  // 一開始班表快照抓不到就直接停：還沒收到任何軌跡，等上游恢復再開始就好（fail loudly）。
  await ensureStopsSnapshot(taipeiDate(Date.now()));

  // 從今天與昨天的軌跡檔接回去重狀態：上游偶爾把前一晚的最後一筆定位掛到隔天早上，只看今天的檔不夠。
  const lastRecordedAt = new Map<string, string>();
  for (const date of [taipeiDate(Date.now() - DAY_MS), taipeiDate(Date.now())]) {
    const file = tracesFile(options.outDir, date);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    const { rows, badLines } = seedLastRecordedAt(text, lastRecordedAt);
    log(`接續既有軌跡：${file}（${rows} 筆）`);
    if (badLines > 0) console.error(`⚠ ${file} 有 ${badLines} 行無法解析（多半是上次中止時寫到一半），評估時請略過這些行。`);
    // 上次若中止在一行中間，補一個換行，新的資料才不會黏在殘缺的那一行後面。
    if (text.length > 0 && !text.endsWith("\n")) appendFileSync(file, "\n");
  }

  const startedAt = Date.now();
  const deadline = options.hours === undefined ? Infinity : startedAt + options.hours * 60 * 60 * 1000;
  const trucksSeen = new Set<string>();
  let ticks = 0;
  let rowsWritten = 0;
  let failures = 0;
  let consecutiveFailures = 0;
  let stopping = false;

  process.on("SIGINT", () => {
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });

  log(`開始收集：每 ${options.intervalS} 秒一次${options.hours ? `，${options.hours} 小時後停止` : "，Ctrl+C 停止"}`);

  while (!stopping && Date.now() < deadline) {
    const tickStarted = Date.now();
    ticks++;
    const fetchedAt = new Date().toISOString();
    const today = taipeiDate(tickStarted);

    // 跨過台北午夜：先試著補這一天的班表快照。只有上游錯誤可以等下一輪再試；寫檔錯誤直接往外拋、中止收集。
    // 補不到的期間軌跡照存（錯過就沒了，班表一年難得改），但 polls 檔會標 stopsSnapshot: false，結束時也會報錯。
    if (!snapshotDates.has(today)) {
      try {
        await ensureStopsSnapshot(today);
      } catch (error) {
        if (!(error instanceof UpstreamError)) throw error;
        logError(`${today} 的班表快照抓取失敗，下一輪再試`, error);
      }
    }
    const stopsSnapshot = snapshotDates.has(today);

    let trucks: GarbageTruck[] | null = null;
    try {
      trucks = await provider.fetchTrucks(plainFetcher);
      consecutiveFailures = 0;
    } catch (error) {
      if (!(error instanceof UpstreamError)) throw error;
      failures++;
      consecutiveFailures++;
      logError(`第 ${ticks} 次抓取失敗（連續 ${consecutiveFailures} 次）`, error);
      if (consecutiveFailures === 10) console.error("連續失敗 10 次：這段時間沒有軌跡，polls 檔已逐筆記下，評估時要當成缺口而不是「沒有車」。");
      appendJsonl(pollsFile(options.outDir, today), [{ fetchedAt, ok: false, error: errorText(error), stopsSnapshot } satisfies PollRow]);
    }

    if (trucks) {
      const fresh = pickFreshRows(trucks, fetchedAt, lastRecordedAt);
      for (const row of fresh) trucksSeen.add(row.id);
      // 依台北日期切檔：跨夜連跑時檔案不會無限長，之後也能按天挑「有車的時段」來評估。
      appendJsonl(tracesFile(options.outDir, today), fresh);
      if (fresh.length > 0) traceDates.add(today);
      rowsWritten += fresh.length;
      // 抓取紀錄寫在軌跡之後：看到 ok: true 就代表這一輪的軌跡已經落地。
      appendJsonl(pollsFile(options.outDir, today), [
        { fetchedAt, ok: true, online: trucks.length, written: fresh.length, stopsSnapshot } satisfies PollRow,
      ]);
      // 上游回 0 台是合法狀態（收班後），照實印出來並記進 polls 檔，不當成錯誤，也不能假裝有資料。
      log(`線上 ${trucks.length} 台，新位置 ${fresh.length} 筆，累計 ${rowsWritten} 筆／${trucksSeen.size} 台`);
    }

    // 扣掉這次抓取花的時間讓間隔穩定，但不能睡過 --hours 的期限（間隔沒有上限，睡過頭可能多跑將近一整個間隔）；
    // Ctrl+C 期間每秒檢查一次，不用等整個間隔。
    const waitUntil = Math.min(tickStarted + options.intervalS * 1000, deadline);
    while (!stopping && Date.now() < waitUntil) await Bun.sleep(Math.min(1000, waitUntil - Date.now()));
  }

  const minutes = Math.round((Date.now() - startedAt) / 60_000);
  log(`結束：跑了 ${minutes} 分鐘、${ticks} 次抓取、寫入 ${rowsWritten} 筆、${trucksSeen.size} 台車、失敗 ${failures} 次。輸出：${options.outDir}`);

  // 有軌跡卻缺班表的日子：資料不完整，不能讓這次收集看起來是成功的（PR #7 review）。
  const missing = [...traceDates].filter((date) => !snapshotDates.has(date));
  if (missing.length > 0) {
    console.error(`✖ 這些日期有軌跡但沒有班表快照：${missing.join("、")}。評估時這幾天只能借用前一天的班表，請標註為不完整。`);
    process.exit(1);
  }
}

// 只有直接執行時才開始收集；測試 import 這支檔案時只拿純函式。
if (import.meta.main) {
  main().catch((error: unknown) => {
    logError("收集中止", error);
    process.exit(1);
  });
}
