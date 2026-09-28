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

## D7 — 點選地點改為「單一地點詳情」，並接上返回鍵但不改網址（2026-09-28）

- **決定**：點地圖標記或列表卡片時，列表整個換成該地點的詳情（下一班＋所有路線的完整週班表），不再只是在長列表中高亮。開啟詳情時 `history.pushState` 推一筆**同網址**紀錄，並在 `history.state` 標記地點 id；手機返回鍵／瀏覽器上一頁／畫面上的返回按鈕／Esc 都是回到列表，下一頁或開著詳情重新整理則依標記還原詳情；在詳情之間切換用 `replaceState`，不再多推紀錄。
- **理由**：使用者回饋「點到這個點，就只想看這個點所有的時間（含晚上班），不用看別的點」。原本卡片只列每條路線的「下一班」，看不到完整週班表，其他地點的時間也混在旁邊。沒接返回鍵的話，手機使用者習慣性按返回會直接離開網站。
- **為什麼不把地點放進網址（`?place=`）**：地點 id 含約 11 m 精度座標，網址會進瀏覽紀錄、分享連結與 CDN log，違反 AGENTS.md § 3.5。`history.state` 只存在該分頁的瀏覽器內、不會送出，所以可以放 id。代價是詳情無法用連結分享；若日後需要，改用不含座標的 id（例如路線 id + 站序）。

## D8 — 班表快取過期時先回舊資料、背景刷新（stale-while-revalidate）（2026-09-29）

- **決定**：`src/server/stop-cache.ts` 超過 12 小時 TTL 時，若手上有舊快照就立刻回傳，同時發動一輪背景刷新，由 `/api/nearby` 交給 `next/server` 的 `after()` 跑完。背景刷新失敗會記錄錯誤、之後的回應帶 `dataStale: true`，並在 5 分鐘內不再重試。只有冷啟動（完全沒有資料）才讓使用者等上游。
- **理由**：實測抓完新北 27 頁約 4.6 秒，加上正規化與寫入快取，舊做法讓每 12 小時的第一位使用者白等好幾秒；而清運班表一年難得改幾次，過期幾分鐘的版本幾乎一定仍正確。
- **為什麼 stale 不在「一過期」就標**：過期只代表「該換了」，不代表資料有問題；真正需要讓使用者知道的是「更新失敗、這是舊資料」（AGENTS.md § 3.4）。
- **為什麼一定要 `after()`**：serverless 在回應送出後可能凍結程序，沒註冊的背景 Promise 會跑不完，快取就一直停在舊版。
- **尚未解決**：冷啟動仍要等整輪上游抓取；建置時產生班表快照的做法另開 issue 追蹤。
