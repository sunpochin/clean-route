// 檔案用途：自家 API（/api/nearby、/api/trucks）的請求參數上下限與回應型別；前後端共用同一份定義。
// 所在層：src/lib；只放型別與常數，瀏覽器與伺服器都可以安全 import。
// 主要關聯：src/app/api/*/route.ts（產生回應）、src/hooks/*（消費回應）、docs/architecture.md（API 說明）。

import type { RouteProgress } from "@/domain/route-progress";
import type { GarbageStop, GarbageTruck } from "@/domain/types";

export const NEARBY_DEFAULT_RADIUS_M = 600;
export const NEARBY_MIN_RADIUS_M = 100;
export const NEARBY_MAX_RADIUS_M = 2000;
// 同一路口通常有下午＋晚上兩條路線，合併成地點後約剩一半，所以候選筆數抓寬一點。
export const NEARBY_MAX_RESULTS = 120;
export const TRUCKS_MAX_ROUTES = 40;

export interface NearbyResponse {
  /** 候選清運點，伺服器依降精度座標排序；瀏覽器要用精確座標重算距離（docs/DECISIONS.md D6）。 */
  stops: GarbageStop[];
  radiusM: number;
  /** 伺服器上這份清運點資料是何時從上游抓到的。 */
  dataLoadedAt: string;
  /** 班表已過期且刷新失敗，這是舊版本；畫面必須明確警示並顯示日期。 */
  dataStale: boolean;
  /** 上游有幾筆清運點因格式不符被略過（全市合計）；> 0 時畫面要提示結果可能不完整。 */
  skippedUpstreamRows: number;
}

export interface TrackedTruck extends GarbageTruck {
  /**
   * 車在路線上開到第幾站（伺服器以全路線班表比對）。
   * null 代表這次無法比對（這台伺服器的班表尚未載入，或班表裡沒有這條路線），和「比對過但分不出來」（ambiguous）是不同的事，畫面說法也不同。
   */
  progress: RouteProgress | null;
}

export interface TrucksResponse {
  trucks: TrackedTruck[];
  fetchedAt: string;
}

export type ApiErrorCode = "bad_request" | "upstream_unavailable";

export interface ApiErrorBody {
  error: ApiErrorCode;
  message: string;
}
