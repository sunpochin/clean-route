// 檔案用途：新北市資料開放平台原始回應的欄位定義與端點常數。
// 所在層：src/providers/new-taipei；AGENTS.md § 3.2：這些欄位名稱只准出現在本資料夾。
// 主要關聯：normalize.ts（轉成 domain 型別）、index.ts（抓取）、docs/data-sources/new-taipei.md（欄位說明）。

const API_BASE = "https://data.ntpc.gov.tw/api/datasets";

/** 垃圾車路線與清運點（含每週各服務日）。 */
export const STOPS_DATASET_URL = `${API_BASE}/edc3ad26-8ae7-4916-a00b-bc6048d19bf8/json`;
/** 垃圾車即時 GPS。只包含目前有回報位置的車（收班後會消失）。 */
export const TRUCKS_DATASET_URL = `${API_BASE}/28ab4122-60e1-4065-98e5-abccb69aaca6/json`;

type DayKey = "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday";
type ServiceKey = "garbage" | "recycling" | "foodscraps";

/** 上游以 `"Y"` 或 `""` 表示該天是否收運，例如 `garbagemonday: "Y"`。 */
export type RawServiceFlags = { [K in `${ServiceKey}${DayKey}`]?: string };

export interface RawStop extends RawServiceFlags {
  /** 注意：上游叫 `city`，實際內容是「行政區」（例如「萬里區」）。 */
  city?: string;
  lineid?: string;
  linename?: string;
  rank?: string;
  name?: string;
  village?: string;
  longitude?: string;
  latitude?: string;
  /** `HH:MM`，台北當地時間。 */
  time?: string;
  memo?: string;
}

export interface RawTruck {
  lineid?: string;
  car?: string;
  /** `"2026/09/28 17:42:20"`，台北當地時間，無時區標記。 */
  time?: string;
  location?: string;
  longitude?: string;
  latitude?: string;
  cityid?: string;
  cityname?: string;
}

export const DAY_KEYS: readonly DayKey[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
