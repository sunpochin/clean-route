<!--
檔案用途：已定案的技術決策紀錄（輕量 ADR）；改架構或換技術前必查。
所在層：docs；AGENTS.md § 6 索引「想改技術選型或架構」入口。
主要關聯：docs/PLAN.md（產品分期）、docs/architecture.md（實際落地的結構）。
-->

# 定案決策 / Decisions

推翻任何一條之前，先寫出「當初的理由哪裡不再成立」，再新增一條取代它（不要直接改舊條目）。

## D1 — 前端框架：Next.js 16（App Router）+ React + TypeScript（2026-09-28）

- **決定**：用 Next.js 16，而非 Nuxt 4 或 React + Vite。
- **理由**：頁面本質是 SPA（定位、地圖、輪詢），但需要一個伺服器端代理來抓政府 API、正規化與快取；Next.js 的 route handler 讓 Phase 1 只需一個部署目標。與 family-care-ops 的 React 技術棧一致，知識可以共用。
- **約束**：不追求 RSC／Server Action 全家桶；互動頁面直接用 client component。

## D2 — Phase 1 不用資料庫（2026-09-28）

- **決定**：Phase 1 不接 Supabase／PostGIS。附近查詢在 route handler 的記憶體內做線性掃描。
- **理由**：新北約 2.6 萬個清運點，方框粗篩 + haversine 實測單次約 0.09 ms（2026-09，M 系列 Mac、真實資料）；Phase 1 沒有需要持久化的使用者資料。
- **何時推翻**：需要儲存推播訂閱（Phase 2），或擴展到全台、點位數量讓記憶體掃描不再划算時。

## D3 — Phase 1 不用 Cloudflare Worker；Provider 必須與框架無關（2026-09-28）

- **決定**：上游資料的抓取與正規化放在 `src/providers/`，以純 TypeScript（只依賴 `fetch`）撰寫；由 Next.js route handler 呼叫。
- **理由**：少一個部署平台；同時保留 Phase 2 把 provider 原樣搬進 Worker（cron 推播）的能力。
- **約束**：`src/providers/` 與 `src/domain/` 不得 import `next/*` 或 React。

## D4 — 快取策略：上游 fetch 用 Next data cache（2026-09-28）

- **決定**：清運點資料每頁 1000 筆分頁抓取（每頁約 680 KB，低於 Next data cache 單筆 2 MB 上限），`revalidate` 12 小時；即時 GPS `revalidate` 20 秒。
- **理由**：清運點資料一天變動極少；GPS 上游約每 15～30 秒更新，每個使用者各自打上游沒有意義。
- **注意**：`size=5000` 雖然上游支援，但單頁約 3.4 MB 會超過 data cache 上限而每次重抓。

## D5 — 地圖：MapLibre GL JS v6 + OpenFreeMap 底圖（2026-09-28）

- **決定**：MapLibre GL JS，底圖樣式 `https://tiles.openfreemap.org/styles/liberty`。
- **理由**：免 API key、免費、無流量計費；日後要換底圖只改一個常數。
- **注意**：MapLibre v6 為 ESM-only，必須在 client component 內以 dynamic import 載入。

## D6 — 位置先降精度再送出（2026-09-28）

- **決定**：瀏覽器送往 `/api/nearby` 的座標四捨五入到小數點後 3 位（約 100 m），伺服器以「查詢半徑 + 降精度誤差」回傳候選點，瀏覽器再用精確座標重算距離與排序。
- **理由**：落實憲法 § 3.5，伺服器與任何中間層（CDN log、Vercel log）都拿不到精確住家位置，而使用者看到的距離依然精確。
