// 檔案用途：長時間輪詢新北即時 GPS，把每台垃圾車的位置軌跡存成 JSONL，並在開始時存一份當天的清運點班表快照；
//           這批資料是「車開到第幾站」比對（src/domain/route-progress.ts）的真實評估集，取代目前只有模擬數據的狀態。
// 所在層：scripts；手動執行（`bun run collect:traces`），不在 App 的執行路徑上。輸出放 data/traces/（已列入 .gitignore）。
// 主要關聯：src/providers/registry.ts（只經由 registry 取得 provider，遵守 AGENTS.md § 3.2）、
//           docs/data-sources/new-taipei.md（收集方式與資料格式）、docs/DECISIONS.md D9（為什麼需要評估集）。
//
// 為什麼要收：模擬只涵蓋「車剛好停在某站旁」；真實軌跡才有兩站之間的行駛、實際晚到多少、暫停與回場。
// 為什麼存正規化後的 domain 型別而不是原始欄位：原始欄位只准出現在 provider 資料夾內；評估腳本也只該認識 GarbageTruck／GarbageStop。
// 車輛位置是政府公開資料、不含任何使用者位置，存到本機不違反 § 3.5；但仍不提交進 git，資料量大且與程式碼無關。

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TAIPEI_OFFSET_MS } from "@/domain/time";
import type { GarbageTruck } from "@/domain/types";
import { getProvider, type JsonFetcher, UpstreamError } from "@/providers/registry";

/** 上游 GPS 約每分鐘更新一次；30 秒抓一次可以把更新時間點抓得比較準，再快只會抓到重複資料。 */
const DEFAULT_INTERVAL_S = 30;
/** 上游偶爾卡住不回；沒有 timeout 的話整個收集會停在那一次。 */
const UPSTREAM_TIMEOUT_MS = 15_000;
/** 一行軌跡：抓取時間 + 車輛正規化資料（去掉 address：反查門牌對評估沒用，檔案卻大一半）。 */
interface TraceRow {
  fetchedAt: string;
  id: string;
  routeId: string;
  recordedAt: string;
  lat: number;
  lng: number;
  district?: string;
}

interface Options {
  intervalS: number;
  outDir: string;
  /** 跑滿幾小時自動結束；未指定就跑到 Ctrl+C。 */
  hours?: number;
}

function parseArgs(argv: string[]): Options {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const options: Options = { intervalS: DEFAULT_INTERVAL_S, outDir: join(root, "data", "traces") };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split("=");
    const value = inline ?? argv[++i];
    if (flag === "--interval") options.intervalS = Number(value);
    else if (flag === "--out") options.outDir = value;
    else if (flag === "--hours") options.hours = Number(value);
    else throw new Error(`未知參數 ${flag}；可用：--interval 秒數 --out 目錄 --hours 小時數`);
  }
  if (!Number.isFinite(options.intervalS) || options.intervalS < 10) throw new Error("--interval 至少 10 秒，別對政府伺服器太兇");
  if (options.hours !== undefined && !(options.hours > 0)) throw new Error("--hours 需大於 0");
  return options;
}

/** 純 fetch 版的 JsonFetcher：這裡沒有 Next data cache，revalidateSeconds 用不到，每次都真的打上游。 */
const plainFetcher: JsonFetcher = async (url) => {
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch (error) {
    throw new UpstreamError(`連線失敗：${error instanceof Error ? error.message : String(error)}`, url);
  }
  if (!response.ok) throw new UpstreamError(`HTTP ${response.status}`, url);
  return response.json();
};

/** 台北當地日期 `YYYY-MM-DD`，用來切檔；不能用 toISOString 直接切，那是 UTC 日期，晚上 8 點後會差一天（AGENTS.md § 3.3）。 */
function taipeiDate(now: Date): string {
  return new Date(now.getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

function taipeiClockText(now: Date): string {
  return new Date(now.getTime() + TAIPEI_OFFSET_MS).toISOString().slice(11, 19);
}

function log(message: string) {
  console.log(`${taipeiClockText(new Date())} ${message}`);
}

function logError(message: string, error: unknown) {
  const detail = error instanceof UpstreamError ? `${error.message}（${error.source}）` : error instanceof Error ? error.message : String(error);
  console.error(`${taipeiClockText(new Date())} ✖ ${message}：${detail}`);
}

/**
 * 每個台北日期存一份清運點快照。評估要拿「當時的班表」對軌跡，班表雖然一年難得改幾次，
 * 但沒有這份快照，幾週後要重算就得相信「應該沒改」。跨夜連跑時每換一天都要再存一份，軌跡檔才有配對的班表。
 */
async function ensureStopsSnapshot(outDir: string, date: string, provider = getProvider("new-taipei")) {
  const file = join(outDir, `stops-${date}.json`);
  if (existsSync(file)) {
    log(`班表快照已存在：${file}`);
    return;
  }
  log("抓取清運點班表快照（27 頁，約 5 秒）…");
  const { stops, skipped } = await provider.fetchStops(plainFetcher);
  writeFileSync(file, JSON.stringify({ loadedAt: new Date().toISOString(), skipped, stops }));
  log(`班表快照已存：${stops.length} 站（略過 ${skipped} 筆）→ ${file}`);
}

function toRow(truck: GarbageTruck, fetchedAt: string): TraceRow {
  return {
    fetchedAt,
    id: truck.id,
    routeId: truck.routeId,
    recordedAt: truck.recordedAt,
    lat: truck.location.lat,
    lng: truck.location.lng,
    district: truck.district,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  mkdirSync(options.outDir, { recursive: true });
  const provider = getProvider("new-taipei");

  // 一開始班表快照抓不到就直接停：沒有班表，軌跡評估做不了，繼續收只是浪費時間（fail loudly）。
  let snapshotDate = taipeiDate(new Date());
  await ensureStopsSnapshot(options.outDir, snapshotDate, provider);

  const startedAt = Date.now();
  const deadline = options.hours === undefined ? Infinity : startedAt + options.hours * 60 * 60 * 1000;
  /**
   * 車牌 → 最近一次寫入的 recordedAt。上游每次都回「該車最新一筆」，所以 recordedAt 沒變就是同一筆定位，不重寫。
   * 為什麼不用有期限的「看過的鍵」集合：上游偶爾會把同一筆過期定位掛好幾個小時，鍵一過期就會被重寫一次，評估集會多出假的重複點。
   */
  const lastRecordedAt = new Map<string, string>();
  const trucksSeen = new Set<string>();
  let ticks = 0;
  let rowsWritten = 0;
  let failures = 0;
  let consecutiveFailures = 0;
  let stopping = false;

  const summary = () => {
    const minutes = Math.round((Date.now() - startedAt) / 60_000);
    log(`結束：跑了 ${minutes} 分鐘、${ticks} 次抓取、寫入 ${rowsWritten} 筆、${trucksSeen.size} 台車、失敗 ${failures} 次。輸出：${options.outDir}`);
  };
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

    // 只有「打上游」可以失敗後繼續：上游維護可能持續幾十分鐘，中斷收集會損失後面的資料。
    // 寫檔失敗（磁碟滿、目錄被移走）不在這個 try 裡：那會讓 --hours 的無人收集「成功結束」卻少一大段資料，必須直接中止。
    const fetchedAt = new Date().toISOString();
    let trucks: GarbageTruck[] | null = null;
    try {
      trucks = await provider.fetchTrucks(plainFetcher);
      consecutiveFailures = 0;
    } catch (error) {
      failures++;
      consecutiveFailures++;
      logError(`第 ${ticks} 次抓取失敗（連續 ${consecutiveFailures} 次）`, error);
      if (consecutiveFailures === 10) console.error("連續失敗 10 次：這段時間沒有軌跡，評估時要把它當成缺口而不是「沒有車」。");
    }

    if (trucks) {
      // 跨過台北午夜：先補這一天的班表快照，軌跡檔才有配對的班表。抓不到就下一輪再試，軌跡照存（班表一年難得改，補得回來）。
      const today = taipeiDate(new Date());
      if (today !== snapshotDate) {
        try {
          await ensureStopsSnapshot(options.outDir, today, provider);
          snapshotDate = today;
        } catch (error) {
          logError(`${today} 的班表快照抓取失敗，下一輪再試`, error);
        }
      }

      const fresh: TraceRow[] = [];
      for (const truck of trucks) {
        if (lastRecordedAt.get(truck.id) === truck.recordedAt) continue;
        lastRecordedAt.set(truck.id, truck.recordedAt);
        trucksSeen.add(truck.id);
        fresh.push(toRow(truck, fetchedAt));
      }
      if (fresh.length > 0) {
        // 依台北日期切檔：跨夜連跑時檔案不會無限長，之後也能按天挑「有車的時段」來評估。
        const file = join(options.outDir, `trucks-${today}.jsonl`);
        appendFileSync(file, fresh.map((row) => JSON.stringify(row)).join("\n") + "\n");
        rowsWritten += fresh.length;
      }
      // 上游回 0 台是合法狀態（收班後），照實印出來，不當成錯誤，也不能假裝有資料。
      log(`線上 ${trucks.length} 台，新位置 ${fresh.length} 筆，累計 ${rowsWritten} 筆／${trucksSeen.size} 台`);
    }

    // 扣掉這次抓取花的時間讓間隔穩定，但不能睡過 --hours 的期限（間隔沒有上限，睡過頭可能多跑將近一整個間隔）；
    // Ctrl+C 期間每秒檢查一次，不用等整個間隔。
    const waitUntil = Math.min(tickStarted + options.intervalS * 1000, deadline);
    while (!stopping && Date.now() < waitUntil) await Bun.sleep(Math.min(1000, waitUntil - Date.now()));
  }
  summary();
}

main().catch((error: unknown) => {
  logError("收集中止", error);
  process.exit(1);
});
