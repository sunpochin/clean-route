<!--
檔案用途：修 bug 或踩坑後留下的教訓；每條寫「症狀 → 根因 → 現在的防線」。
所在層：docs；AGENTS.md § 2 規定修完 bug 要在這裡補一條。
主要關聯：docs/agents/local-tools.md（工具類的坑）、docs/DECISIONS.md。
-->

# 教訓 / Lessons

## L1 — MapLibre v6 在 Next.js 打包後「Worker failed to load」（2026-09-28）

- **症狀**：地圖空白，console 出現 `Failed to load module script … MIME type "text/html"` 與 `Worker failed to load`。
- **根因**：MapLibre v6 是 ESM，用 `new URL("./maplibre-gl-worker.mjs", import.meta.url)` 找 worker，而 worker 又 import 相鄰的 `maplibre-gl-shared.mjs`；Turbopack 打包後 `import.meta.url` 指向 chunk，相鄰檔案不存在，Next 回了 404 HTML。
- **防線**：`scripts/copy-maplibre-worker.ts`（`predev`／`prebuild` 自動執行）從已安裝套件複製兩個檔案到 `public/maplibre/`，`StopMap` 以 `setWorkerUrl` 指向它。升級 maplibre-gl 時版本自動對齊。

## L2 — 同一路口有下午班與晚上班兩條路線（2026-09-28）

- **症狀**：依距離排序時每個地址出現兩次，且「明天 14:36」排在「今天 19:38」之前。
- **根因**：上游資料以「路線 × 站序」為單位，不是以地點為單位。
- **防線**：`src/domain/place.ts` 依名稱＋座標合併成地點，卡片主顯示最快到的一班，其餘列為「其他班次」；`tests/unit/place.test.ts` 鎖住 18:00 時今晚班次必須排前面。

## L3 — 測試裡的 `expect(promise).rejects` 沒有 await（2026-09-28）

- **症狀**：斷言失敗時測試可能仍然通過。
- **根因**：`rejects` 回傳 promise；沒 await 時測試函式先結束。
- **防線**：一律寫 `await expect(...).rejects…`；新增這類測試時，暫時把被測條件改壞確認測試會紅。

## L4 — 「降級沿用舊資料」與「查不到」都必須一路傳到畫面（2026-09-28，PR #1 review）

- **症狀**：班表刷新失敗時沿用舊快取卻回 200 且無標記；車輛資料全數解析失敗時回傳 `[]`；超過 40 條路線時多出的路線沒查卻顯示「車沒回報」；今天的車被掛在「明天」那班底下。
- **根因**：只在伺服器端做了「不要整個掛掉」，沒把降級狀態當成資料的一部分往前傳。
- **防線**：`/api/nearby` 回傳 `dataStale`、`skippedUpstreamRows`；車輛解析失敗比例過高改回 502；`useTrucks` 分批查詢並回報 `availableRouteIds`；卡片只在今天這班顯示即時車輛。原則：**任何降級都要讓使用者看得見**。

## L5 — `Date.UTC` 會把超出範圍的欄位進位（2026-09-28，PR #1 review）

- **症狀**：`2026/02/31 12:00:00` 被解析成 3 月 3 日，而不是被拒絕。
- **防線**：`parseTaipeiLocalDateTime` 解析後逐欄比對確認沒有進位；`tests/unit/time.test.ts` 鎖住 2/31、13 月、24:30、12:60。

## L6 — 第一次打開只看到一張沒有任何標記的空地圖（2026-09-28，使用者回饋）

- **症狀**：冷啟動時地圖空白十幾秒，沒有任何說明；使用者分不出是「讀取中」、「壞了」還是「附近沒有車」。
- **根因**：伺服器快取是空的時，要向新北市抓完整份班表（27 頁、約 2.6 萬筆，實測約 8 秒）才能回應；「查詢中」只寫在列表裡，桌機版列表在左下角、地圖佔大半個畫面，手機版則要往下看才看得到。
- **防線**：地圖上方加 `MapStatusBanner`，查詢中／失敗／查無結果各有不同文案，超過 3 秒補充「第一次要下載整份班表」；底圖未載完另有「底圖載入中…」；列表改為骨架卡片。原則：**畫面上最大的區塊是空的時候，必須就地說明為什麼**。

