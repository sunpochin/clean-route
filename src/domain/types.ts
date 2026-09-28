// 檔案用途：與城市無關的核心資料型別（清運點、垃圾車、座標），是 provider 正規化後的唯一出口格式。
// 所在層：src/domain；純型別，不依賴 Next.js、React 或任何縣市 API。
// 主要關聯：src/providers/*（產生這些型別）、src/app/api/*（回傳）、src/components/*（顯示）。

export type CityId = "new-taipei";

/** 清運服務種類。新北資料分三種；其他縣市若只有「一般垃圾」也用同一組值表達。 */
export type ServiceType = "garbage" | "recycling" | "foodScraps";

/** 0 = 星期日 … 6 = 星期六，與 JS `Date#getUTCDay` 一致，避免轉換時差一。 */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GarbageStop {
  /** 全域唯一：`<city>:<routeId>:<sequence>`。同一地點若有多條路線經過，會是多筆不同的 stop。 */
  id: string;
  city: CityId;
  district: string;
  village: string;
  name: string;
  routeId: string;
  routeName: string;
  /** 路線上的站序（1 起算）。Phase 2 會用來估算「車還有幾站到」。 */
  sequence: number;
  location: LatLng;
  /**
   * 表定到站時刻，`HH:MM`，Asia/Taipei 當地時間。
   * 為什麼不存成完整日期時間：清運點是「每週固定幾天、固定時刻」的週期性行程，
   * 「下一班」必須由 src/domain/schedule.ts 依當下時間推算。
   */
  timeOfDay: string;
  /** 索引為 Weekday；空陣列表示該天不收。 */
  weeklyServices: readonly (readonly ServiceType[])[];
  /** 給使用者看的備註（例如「國定假日、連假隔天會加收」）；上游的內部維護註記已在 provider 濾掉。 */
  note?: string;
}

export interface GarbageTruck {
  /** 車牌；上游公開資料即提供。 */
  id: string;
  city: CityId;
  routeId: string;
  location: LatLng;
  /** 上游 GPS 定位時間（ISO 8601，含時區）。顯示時必須一併呈現，見 AGENTS.md § 3.4。 */
  recordedAt: string;
  /** 上游反查的門牌地址，可能為空。 */
  address?: string;
  district?: string;
}
