// 檔案用途：新北市 provider 實作——分頁抓取清運點、抓取即時 GPS，並做資料量與格式的健全性檢查。
// 所在層：src/providers/new-taipei；對外只匯出 newTaipeiProvider，由 src/providers/registry.ts 註冊。
// 主要關聯：raw.ts、normalize.ts、src/providers/types.ts；快取秒數的理由見 docs/DECISIONS.md D4。

import { UpstreamError, type CityProvider, type JsonFetcher, type StopsResult } from "../types";
import { normalizeStop, normalizeTruck } from "./normalize";
import { STOPS_DATASET_URL, TRUCKS_DATASET_URL, type RawStop, type RawTruck } from "./raw";

/** 每頁約 680 KB；再大會超過 Next data cache 單筆 2 MB 上限而每次重抓（DECISIONS D4）。 */
const PAGE_SIZE = 1000;
/** 同時發出的分頁請求數：一次全發 27 個請求對政府伺服器不禮貌，也容易被擋。 */
const PARALLEL_PAGES = 6;
/** 防呆：上游若分頁參數失效、每頁都回 1000 筆，不能無限抓下去。2026-09 實際為 27 頁。 */
const MAX_PAGES = 60;
/**
 * 2026-09 實際約 26,600 筆。低於此值代表上游回傳不完整（維護中、分頁壞掉），
 * 此時寧可回報錯誤，也不能讓使用者看到「附近沒有清運點」（AGENTS.md § 3.4）。
 */
const MIN_EXPECTED_STOPS = 10_000;
/** 格式不符而丟棄的比例上限；超過代表上游改了 schema，要 fail loudly 而非默默少一大塊資料。 */
const MAX_SKIPPED_RATIO = 0.05;

/**
 * 即時車輛可丟棄比例上限。比清運點寬鬆：GPS 偶有單筆座標或時間缺漏；
 * 但若大部分都解析失敗，代表上游改了欄位或時間格式，此時回傳 [] 會被畫面誤讀成「沒有車在線上」。
 */
const MAX_SKIPPED_TRUCK_RATIO = 0.2;

const STOPS_REVALIDATE_SECONDS = 12 * 60 * 60;
const TRUCKS_REVALIDATE_SECONDS = 20;

function pageUrl(base: string, page: number, size: number) {
  return `${base}?page=${page}&size=${size}`;
}

async function fetchArray<T>(fetcher: JsonFetcher, url: string, revalidateSeconds: number): Promise<T[]> {
  const body = await fetcher(url, { revalidateSeconds });
  if (!Array.isArray(body)) throw new UpstreamError("預期回傳陣列", url);
  return body as T[];
}

async function fetchAllStopRows(fetcher: JsonFetcher): Promise<RawStop[]> {
  const rows: RawStop[] = [];
  for (let start = 0; start < MAX_PAGES; start += PARALLEL_PAGES) {
    const pages = Array.from({ length: PARALLEL_PAGES }, (_, i) => start + i);
    const results = await Promise.all(
      pages.map((page) => fetchArray<RawStop>(fetcher, pageUrl(STOPS_DATASET_URL, page, PAGE_SIZE), STOPS_REVALIDATE_SECONDS)),
    );
    for (const result of results) {
      rows.push(...result);
      // 任何一頁不滿 PAGE_SIZE 就是最後一頁；同一批裡後面的空頁不影響結果。
      if (result.length < PAGE_SIZE) return rows;
    }
  }
  throw new UpstreamError(`分頁超過 ${MAX_PAGES} 頁仍未結束，疑似分頁參數失效`, STOPS_DATASET_URL);
}

export const newTaipeiProvider: CityProvider = {
  city: "new-taipei",
  displayName: "新北市",

  async fetchStops(fetcher): Promise<StopsResult> {
    const rows = await fetchAllStopRows(fetcher);
    const stops = rows.map(normalizeStop).filter((s) => s !== null);
    const skipped = rows.length - stops.length;

    if (stops.length < MIN_EXPECTED_STOPS) {
      throw new UpstreamError(`清運點只有 ${stops.length} 筆，低於預期下限 ${MIN_EXPECTED_STOPS}`, STOPS_DATASET_URL);
    }
    if (skipped / rows.length > MAX_SKIPPED_RATIO) {
      throw new UpstreamError(`${skipped}/${rows.length} 筆格式不符，疑似上游欄位變更`, STOPS_DATASET_URL);
    }
    return { stops, skipped };
  },

  async fetchTrucks(fetcher) {
    // 即時車輛約 100～200 台，一頁 1000 筆足夠；若哪天超過，至少會被下面的檢查發現。
    const rows = await fetchArray<RawTruck>(fetcher, pageUrl(TRUCKS_DATASET_URL, 0, PAGE_SIZE), TRUCKS_REVALIDATE_SECONDS);
    if (rows.length >= PAGE_SIZE) {
      throw new UpstreamError(`即時車輛達 ${rows.length} 筆，需要改成分頁抓取`, TRUCKS_DATASET_URL);
    }
    // 夜間收班後上游本身回傳 0 筆是合法狀態；但「上游有資料、我們卻解析不出來」不是（AGENTS.md § 3.4）。
    const trucks = rows.map(normalizeTruck).filter((t) => t !== null);
    const skipped = rows.length - trucks.length;
    if (rows.length > 0 && skipped / rows.length > MAX_SKIPPED_TRUCK_RATIO) {
      throw new UpstreamError(`${skipped}/${rows.length} 筆車輛資料格式不符，疑似上游欄位變更`, TRUCKS_DATASET_URL);
    }
    return trucks;
  },
};
