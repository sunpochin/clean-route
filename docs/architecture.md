<!--
檔案用途：Phase 1 的系統資料流、目錄職責與自家 API 說明。
所在層：docs；AGENTS.md § 6 索引「系統資料流、目錄職責、API 端點」入口。
主要關聯：docs/DECISIONS.md（為什麼這樣設計）、src/*（實作）。
-->

# 架構 / Architecture（Phase 1）

## 資料流

```text
瀏覽器（Next.js client components）
  │ 1. navigator.geolocation → 精確座標（只留在瀏覽器）
  │ 2. 降精度到 ~100 m → GET /api/nearby?lat&lng&radius
  │ 3. 用精確座標重算距離、篩半徑、依地點合併
  │ 4. 每 30 秒 GET /api/trucks?routes=…
  ▼
Next.js route handlers（src/app/api）
  │ 參數驗證、再降精度一次、組回應；絕不記錄座標
  ▼
src/server（Next 專屬接點）
  │ stop-cache：程序內快取 12h、同時請求合併；過期先回舊資料並以 after() 背景刷新，失敗退避 5 分鐘
  │ /api/trucks 另用現成快照的「路線 → 站」索引，把每台車對到站序（不等上游）
  │ next-fetcher：把 provider 的快取秒數轉成 Next data cache 的 next.revalidate
  ▼
src/providers/registry → src/providers/new-taipei（純 TypeScript，可搬進 Worker）
  │ 分頁抓取、正規化、資料量／格式健全性檢查（fail loudly）
  ▼
新北市資料開放平台（清運點 27 頁 × 1000 筆；即時 GPS 1 頁）
```

## 目錄職責

| 目錄 | 職責 | 不准做的事 |
| --- | --- | --- |
| `src/domain/` | 城市無關的型別與純函式：時間（Asia/Taipei）、距離、下一班、地點合併、資料新鮮度、車輛站序比對 | import `next/*`、React、任何 provider |
| `src/providers/` | 各縣市原始 API → domain 型別 | import `next/*`、React；讓原始欄位流出本資料夾 |
| `src/server/` | provider 與 Next.js 的接點（快取、fetcher） | 被 client component import |
| `src/app/api/` | HTTP 介面：驗證、回應格式、錯誤碼 | 記錄使用者座標；直接 import provider 內部檔案 |
| `src/hooks/` | 瀏覽器端資料狀態（定位、查詢、輪詢） | 把位置寫進 storage |
| `src/components/` | 呈現；區分載入／失敗／查無結果（列表與地圖狀態條都要）；列表 ↔ 單一地點詳情切換 | 直接呼叫 fetch |
| `src/lib/` | 前後端共用的 API 合約、格式化、fetch 包裝 | 放商業邏輯 |

## 自家 API

### `GET /api/nearby?lat=&lng=&radius=`

- `lat`／`lng`：必須在台灣範圍內；伺服器會再降精度到小數 3 位。
- `radius`：100–2000 公尺，預設 600。伺服器實際以 `radius + 80 m`（降精度誤差）搜尋，最多 120 筆。
- 200：`{ stops: GarbageStop[], radiusM, dataLoadedAt, dataStale, skippedUpstreamRows }`，`Cache-Control: public, s-maxage=600`；班表已過期（背景刷新中或刷新失敗）時只快取 60 秒，避免 CDN 擋住隨後的 `dataStale`。
  - `dataStale: true`：班表超過 12 小時且最近一次背景刷新失敗，回傳的是舊版本；畫面顯示警示條與資料日期。過期但刷新尚未失敗時（剛觸發背景刷新）仍是 `false`。
  - `skippedUpstreamRows > 0`：上游有資料列格式不符被略過；畫面提示結果可能不完整。
- 400 `bad_request`；502 `upstream_unavailable`（上游失敗且沒有任何舊快取）。

### `GET /api/trucks?routes=a,b,c`

- `routes`：1–40 個路線代碼。
- 200：`{ trucks: TrackedTruck[], fetchedAt }`，`Cache-Control: public, s-maxage=15`。
  - `TrackedTruck` = `GarbageTruck` + `progress`：`{ status: "matched", sequence, distanceM }`（車在第幾站附近）、`{ status: "ambiguous" }`（路線繞回、分不出是哪次經過）、`{ status: "offRoute" }`（附近沒有這條路線的站），或 `null`（這台伺服器的班表尚未載入，已在背景載入；或班表沒有這條路線）。比對方式見 [`DECISIONS.md`](DECISIONS.md) D9。空陣列代表「這些路線目前沒有車回報位置」，是合法狀態；上游有資料但超過 20% 解析失敗時改回 502。
- 前端路線超過 40 條時分批查詢；只有「該批成功」的路線才能顯示「沒有車回報」，其餘顯示「無法取得」。
- 400 `bad_request`；502 `upstream_unavailable`。

## 地圖

MapLibre GL JS v6 + OpenFreeMap。v6 的 Web Worker 需要由 `scripts/copy-maplibre-worker.ts` 複製到 `public/maplibre/`（`predev`／`prebuild` 自動執行），原因見 [`LESSONS.md`](LESSONS.md)。
