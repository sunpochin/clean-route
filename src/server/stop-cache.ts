// 檔案用途：清運點資料的程序內（in-process）記憶體快取，含 TTL、同時請求合併、過期時「先回舊資料、背景刷新」與刷新失敗的退避策略。
// 所在層：src/server；Next data cache 之上的第二層快取，避免每個 /api/nearby 請求都重新組 27 頁、2.6 萬筆資料。
// 主要關聯：src/app/api/nearby/route.ts（以 next/server 的 after() 讓背景刷新跑完）、src/app/api/trucks/route.ts（只讀現有快照對站序）、src/providers/registry.ts、docs/DECISIONS.md D2／D4／D8／D9。

import { groupStopsByRoute } from "@/domain/route-progress";
import type { CityId, GarbageStop } from "@/domain/types";
import { getProvider, type JsonFetcher } from "@/providers/registry";
import { nextFetcher } from "./next-fetcher";

const TTL_MS = 12 * 60 * 60 * 1000;
/**
 * 背景刷新失敗後，多久內不再重試。背景刷新不會讓使用者等，所以失敗了也沒人察覺；
 * 若不退避，上游維護期間每個請求都會再打一輪 27 頁，對政府伺服器等於小型 DoS。
 */
const REFRESH_RETRY_BACKOFF_MS = 5 * 60 * 1000;

export interface StopSnapshot {
  stops: GarbageStop[];
  skipped: number;
  loadedAt: Date;
}

export interface StopSnapshotResult extends StopSnapshot {
  /**
   * true 代表已超過 TTL 且最近一次刷新失敗，回傳的是舊版本。
   * 必須一路傳到畫面上（AGENTS.md § 3.4）：沿用舊班表可以，但不能讓使用者以為這是最新資料。
   */
  stale: boolean;
  /**
   * true 代表已超過 TTL、回傳的是舊快照，而刷新結果「尚未確定或已失敗」（stale 為 true 時必定也是 true）。
   * 呼叫端據此縮短 CDN 快取：剛過期時 stale 還是 false，若把這份回應長時間快取，
   * 背景刷新隨後失敗的狀態就傳不到使用者手上（PR #5 review，見 docs/LESSONS.md L7）。
   */
  expired: boolean;
  /**
   * 本次請求啟動的背景刷新；呼叫端必須交給 next/server 的 after()。
   * 為什麼不在這裡直接 fire-and-forget：serverless 平台在回應送出後可能凍結程序，沒註冊的 Promise 會跑不完，
   * 快取就永遠停在舊版。這個 Promise 保證不會 reject（錯誤已在內部記錄並轉成退避狀態）。
   */
  backgroundRefresh?: Promise<void>;
}

interface CacheEntry {
  snapshot?: StopSnapshot;
  inflight?: Promise<StopSnapshot>;
  /** 最近一次刷新失敗的時間；成功後清除。用來決定 stale 與退避。 */
  lastFailureAt?: number;
}

const cache = new Map<CityId, CacheEntry>();

async function load(city: CityId, fetcher: JsonFetcher): Promise<StopSnapshot> {
  const { stops, skipped } = await getProvider(city).fetchStops(fetcher);
  return { stops, skipped, loadedAt: new Date() };
}

/**
 * 發動（或加入進行中的）上游抓取。成功時換上新快照並清除失敗紀錄，失敗時記下時間；
 * 同一城市同時只會有一輪抓取（冷啟動時多個請求同時進來也只打一次上游）。
 */
function startLoad(city: CityId, entry: CacheEntry, fetcher: JsonFetcher): Promise<StopSnapshot> {
  entry.inflight ??= load(city, fetcher)
    .then(
      (snapshot) => {
        entry.snapshot = snapshot;
        entry.lastFailureAt = undefined;
        return snapshot;
      },
      (error: unknown) => {
        entry.lastFailureAt = Date.now();
        throw error;
      },
    )
    .finally(() => {
      entry.inflight = undefined;
    });
  return entry.inflight;
}

export async function getStopSnapshot(city: CityId, fetcher: JsonFetcher = nextFetcher): Promise<StopSnapshotResult> {
  const entry = cache.get(city) ?? {};
  cache.set(city, entry);
  const { snapshot } = entry;

  // 冷啟動：手上沒有任何資料，只能讓使用者等這一輪抓完；失敗就往上拋，讓 route handler 回 502。
  if (!snapshot) {
    const loaded = await startLoad(city, entry, fetcher);
    return { ...loaded, stale: false, expired: false };
  }

  if (Date.now() - snapshot.loadedAt.getTime() < TTL_MS) return { ...snapshot, stale: false, expired: false };

  // 已過期但有舊資料：立刻回舊資料，不讓使用者等上游好幾秒。清運班表一年難得改幾次，
  // 過期幾分鐘的版本幾乎一定仍正確；真正要讓使用者知道的是「刷新失敗了」，那才標 stale。
  const failedRecently = entry.lastFailureAt !== undefined && Date.now() - entry.lastFailureAt < REFRESH_RETRY_BACKOFF_MS;
  const stale = entry.lastFailureAt !== undefined;

  // 已經有人在刷新（它會自己註冊 after），或剛失敗還在退避期：只回舊資料，不再發動。
  if (entry.inflight || failedRecently) return { ...snapshot, stale, expired: true };

  const backgroundRefresh = startLoad(city, entry, fetcher).then(
    () => undefined,
    (error: unknown) => {
      // 不能吞掉（AGENTS.md § 3.4 silent failure 視為 P0）：記錄下來，並透過 lastFailureAt 讓之後的回應帶 stale。
      console.error("[stop-cache] background refresh failed, serving previous snapshot", city, error);
    },
  );
  return { ...snapshot, stale, expired: true, backgroundRefresh };
}

export interface StopSnapshotPeek {
  snapshot?: StopSnapshot;
  /**
   * 手上沒有快照，且最近一次抓取失敗（成功後清除）。
   * 呼叫端要把「抓取失敗」與「還在載入」分開告訴使用者（AGENTS.md § 3.4，PR #6 review）。
   */
  loadFailed: boolean;
}

/**
 * 只看手上現有的快照（過期也照給），不觸發任何上游抓取。
 * 給 /api/trucks 用：車輛位置每 30 秒輪詢，不能因為這台機器的班表還沒載入就讓使用者等 27 頁上游（冷啟動約 5 秒）；
 * 過期的班表用來對站序也夠準（班表一年難得改幾次）。載入與刷新交給 keepStopSnapshotWarm。
 */
export function peekStopSnapshot(city: CityId): StopSnapshotPeek {
  const entry = cache.get(city);
  return { snapshot: entry?.snapshot, loadFailed: !entry?.snapshot && entry?.lastFailureAt !== undefined };
}

/**
 * 讓快照保持可用：沒有就載入、過期就刷新、還新鮮就立刻結束。保證不會 reject，呼叫端交給 after() 即可。
 * 為什麼 /api/trucks 每次都要呼叫：只 peek 不刷新的話，若 /api/nearby 都被 CDN 或別的機器接走，
 * 這台機器的班表會一直停在第一次載入的版本（PR #6 review）。
 * 冷啟動失敗後同樣退避：輪詢每 30 秒一次，不退避的話上游故障時每個輪詢都會再打一輪 27 頁。
 */
export async function keepStopSnapshotWarm(city: CityId, fetcher: JsonFetcher = nextFetcher): Promise<void> {
  const entry = cache.get(city);
  const coldFailedRecently =
    !entry?.snapshot && entry?.lastFailureAt !== undefined && Date.now() - entry.lastFailureAt < REFRESH_RETRY_BACKOFF_MS;
  if (coldFailedRecently) return;
  try {
    const result = await getStopSnapshot(city, fetcher);
    await result.backgroundRefresh;
  } catch (error) {
    // 不吞掉（AGENTS.md § 3.4）：記錄下來，並透過 lastFailureAt 讓 peek 回報 loadFailed，畫面說「班表抓取失敗」。
    console.error("[stop-cache] warm-up failed", city, error);
  }
}

// 以快照的 stops 陣列為鍵：快照換新時舊索引跟著被回收，不必另外管失效。
const routeIndexCache = new WeakMap<readonly GarbageStop[], Map<string, GarbageStop[]>>();

/** 快照的「路線 → 所有站」索引；2.6 萬筆只分組一次，之後每個請求直接查。 */
export function stopsByRoute(snapshot: StopSnapshot): ReadonlyMap<string, readonly GarbageStop[]> {
  let index = routeIndexCache.get(snapshot.stops);
  if (!index) {
    index = groupStopsByRoute(snapshot.stops);
    routeIndexCache.set(snapshot.stops, index);
  }
  return index;
}

/** 測試專用：清空快取，避免測試之間互相污染。 */
export function resetStopCacheForTests() {
  cache.clear();
}
