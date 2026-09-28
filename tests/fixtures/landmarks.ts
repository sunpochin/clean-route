// 檔案用途：測試共用的公開地標座標（已是 domain 的 LatLng，不含任何縣市原始欄位）。
// 所在層：tests/fixtures；不得放真實住家位置（AGENTS.md § 3.5）。
// 主要關聯：tests/unit/*.test.ts、src/providers/new-taipei/test-fixtures.ts。

import type { LatLng } from "@/domain/types";

/** 板橋車站（公開地標）。 */
export const BANQIAO_STATION: LatLng = { lat: 25.0143, lng: 121.4638 };
