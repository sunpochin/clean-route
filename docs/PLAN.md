<!--
檔案用途：產品範圍與分期路線；包含對最初 GPT 技術規劃的逐點審核（認同／延後／修正）。
所在層：docs；AGENTS.md § 6 索引「產品範圍、分期路線」入口。
主要關聯：docs/DECISIONS.md（每個定案的理由）、docs/architecture.md（Phase 1 實際架構）。
-->

# 產品計畫 / Product Plan

> 格式：中文在前半段，英文在後半段（AGENTS.md § 4）。

---

## 中文版

### 一、要解決的問題

在新北市，倒垃圾要配合垃圾車的時間與地點。常見的痛點有三個：不知道離家最近的清運點在哪、不知道今天幾點到、不知道車現在開到哪裡。這個 App 要做到：**打開 → 自動定位 → 看到附近清運點的下一班時間，以及垃圾車的即時位置。**

### 二、對 GPT 規劃的審核

| GPT 建議 | 我的判斷 | 說明 |
| --- | --- | --- |
| 不用 Nuxt 3（已 EOL），改 Next.js + React + TypeScript | ✅ 認同 | Next.js 16 的 App Router 可以當 SPA 使用，route handler 又能直接當後端代理；也跟 family-care-ops 的 React 技術棧一致。見 D1。 |
| Tailwind CSS | ✅ 認同 | create-next-app 預設就有，v4 不需要設定檔。 |
| MapLibre GL JS | ✅ 認同 | 開源、免 API key。底圖用 OpenFreeMap（免費、免金鑰），見 D5。 |
| TanStack Query | ✅ 認同 | 垃圾車位置需要每 30 秒輪詢，TanStack Query 的 `refetchInterval` 與錯誤狀態正好用得上。 |
| **Provider／normalize 分層，前端不綁新北 schema** | ✅ **強烈認同** | 這是整份規劃最有價值的一點，已寫進憲法 § 3.2。 |
| `GarbageStop.scheduledAt: string` | ⚠️ 修正 | 清運點不是「一個時間」：它是「每天固定的時刻 + 每週哪幾天 + 收哪幾種（一般垃圾／資源回收／廚餘）」。GPT 的型別會讓「下一班是什麼時候」無法計算。已改成 `timeOfDay` + `weeklyServices`，見 `src/domain/types.ts`。 |
| Supabase + PostGIS 第一天就上 | ⏸ 延後到 Phase 2 | 新北全市約 2.6 萬個清運點，在記憶體裡算距離平均不到 0.1 ms（實測）；Phase 1 沒有任何需要存的使用者資料（收藏先放 localStorage）。等到要存推播訂閱時才需要資料庫。見 D2。 |
| Cloudflare Worker + Cron 第一天就上 | ⏸ 延後到 Phase 2 | Phase 1 用 Next.js route handler 做代理與正規化就夠，少一個部署平台。Provider 寫成不依賴 Next 的純 TypeScript，Phase 2 可以原封不動搬進 Worker。真正需要 Worker 的理由是「每分鐘檢查要不要發推播」，Vercel Hobby 的 cron 一天只能跑一次。見 D3。 |
| Web Push／PWA／VAPID | ⏸ Phase 2 | 這是殺手功能，但依賴排程器與訂閱儲存。另外要注意 iOS 只有「加入主畫面」後才能收 Web Push，UX 上要引導。 |
| 台北、高雄 provider | ⏸ Phase 3 | 先把新北做對。台北的公開資料沒有同等品質的即時 GPS，要先調查。 |
| 「作品集價值很高」作為選型理由 | ➖ 不採用 | 選型以產品需求與維護成本為準，不以履歷好看為準。 |

GPT 漏掉、但 Phase 1 必須處理的事：

1. **時區**：Vercel 伺服器是 UTC，晚上 8 點以後 `new Date().getDay()` 會算成隔天。所有時間計算統一以 `Asia/Taipei` 處理（憲法 § 3.3）。
2. **資料誠實**：API 掛掉不能顯示成「附近沒有車」；GPS 資料有時間戳，過期要標示（憲法 § 3.4）。
3. **位置隱私**：使用者的家就是他的定位；送出前降精度、伺服器不記錄（憲法 § 3.5）。
4. **即時車輛如何對應清運點**：已驗證新北即時 GPS 的 `lineid` 可以直接對上清運點資料的 `lineid`，所以能顯示「負責這個點的那台車，現在離這裡多遠」。

### 三、分期路線

**Phase 1 — 附近清運點 + 即時車輛（本 PR 開始）**
- [x] 專案骨架（Next.js 16、Tailwind v4、bun、TypeScript）、憲法與 pre-commit gate
- [x] Domain 型別、Asia/Taipei 時間工具、距離計算
- [x] 新北 provider：清運點（分頁抓取＋快取）、即時 GPS
- [x] `/api/nearby`、`/api/trucks` route handler
- [x] 首頁：定位 → 附近清運點列表（下一班時間、收哪幾種、距離）→ 地圖顯示清運點與即時車輛
- [x] 顯示「車在第幾站附近、離這一站還差約幾站」（GPS 對站序；路線繞回分不出時明說，見 D9）
- [ ] 手動選點（不授權定位、或想看別的地址時）
- [ ] 收藏清運點（localStorage）
- [ ] 部署到 Vercel、加上 CI

**Phase 2 — 推播提醒（PWA）**
- Web App Manifest、Service Worker、加入主畫面引導（iOS 16.4+）
- Supabase：`push_subscriptions`（只存清運點 id，不存位置）
- Cloudflare Worker cron：每分鐘判斷「車距離訂閱的點 < N 站或 < X 公尺」就推播
- 到站預估（ETA）：在「還差幾站」（Phase 1 已完成）之上，用 GPS 軌跡估算每站實際耗時

**Phase 3 — 多城市**
- 台北、桃園等 provider；評估是否需要 PostGIS 做全台空間索引

---

## English Version

### 1. Problem

In New Taipei, residents must meet the garbage truck at a scheduled stop and time. The pain points: which stop is closest, when does it come today, and where is the truck right now. Goal: **open → auto-locate → see the next pickup at nearby stops plus live truck positions.**

### 2. Review of the GPT proposal

| GPT suggestion | Verdict | Notes |
| --- | --- | --- |
| Drop Nuxt 3 (EOL); use Next.js + React + TS | ✅ Agree | Next.js 16 App Router works as an SPA, and route handlers serve as the backend proxy. Matches the family-care-ops React stack. See D1. |
| Tailwind CSS | ✅ Agree | Default in create-next-app; v4 needs no config file. |
| MapLibre GL JS | ✅ Agree | Open source, no API key. Basemap from OpenFreeMap (free, keyless). See D5. |
| TanStack Query | ✅ Agree | Truck positions poll every 30 s; `refetchInterval` and error states fit well. |
| **Provider / normalize layer; UI never binds to city schemas** | ✅ **Strongly agree** | The single most valuable idea in the proposal; now constitution § 3.2. |
| `GarbageStop.scheduledAt: string` | ⚠️ Corrected | A stop is not "one time": it is a fixed time of day + which weekdays + which services (garbage / recycling / food scraps). The GPT type makes "next pickup" uncomputable. Replaced with `timeOfDay` + `weeklyServices`. |
| Supabase + PostGIS from day one | ⏸ Deferred to Phase 2 | ~26k stops citywide; an in-memory distance scan averages < 0.1 ms (measured). Phase 1 stores no user data (favorites go to localStorage). A database earns its place with push subscriptions. See D2. |
| Cloudflare Worker + Cron from day one | ⏸ Deferred to Phase 2 | Next.js route handlers can proxy and normalize for Phase 1, which saves a second deploy target. Providers are framework-free TypeScript so they can move into a Worker unchanged. The real need for a Worker is per-minute push checks, since Vercel Hobby cron runs only daily. See D3. |
| Web Push / PWA / VAPID | ⏸ Phase 2 | This is the killer feature, but it needs a scheduler and subscription storage. iOS only delivers Web Push after "Add to Home Screen", so onboarding must guide users. |
| Taipei / Kaohsiung providers | ⏸ Phase 3 | Get New Taipei right first. Taipei's open data lacks equivalent live GPS; needs research. |
| "High portfolio value" as a selection criterion | ➖ Not adopted | Choose by product needs and maintenance cost. |

Gaps in the GPT plan that Phase 1 must handle:

1. **Time zone**: Vercel runs in UTC, so after 8 pm Taipei time `new Date().getDay()` returns tomorrow. All schedule math uses `Asia/Taipei` (constitution § 3.3).
2. **Data honesty**: an API outage must never render as "no trucks nearby"; GPS fixes carry timestamps and stale ones are flagged (§ 3.4).
3. **Location privacy**: a user's location is effectively their home. Coarsen before sending; never log it server-side (§ 3.5).
4. **Truck ↔ stop join**: verified that the live GPS `lineid` matches the stop dataset `lineid`, so we can show how far the truck serving a given stop currently is.

### 3. Roadmap

**Phase 1 — Nearby stops + live trucks (started in this PR)**
- [x] Scaffold (Next.js 16, Tailwind v4, bun, TypeScript), constitution, pre-commit gate
- [x] Domain types, Asia/Taipei time utilities, distance math
- [x] New Taipei provider: stops (paged fetch + cache) and live GPS
- [x] `/api/nearby` and `/api/trucks` route handlers
- [x] Home: locate → nearby stop list (next pickup, services, distance) → map with stops and live trucks
- [x] Show "truck is near stop X, N stops before yours" (GPS matched to route order; says so when a looping route makes it ambiguous, see D9)
- [ ] Manual location picking (no geolocation permission, or checking another address)
- [ ] Favorite stops (localStorage)
- [ ] Deploy to Vercel; CI

**Phase 2 — Push reminders (PWA)**
- Web App Manifest, Service Worker, Add-to-Home-Screen onboarding (iOS 16.4+)
- Supabase `push_subscriptions` (stop ids only, never locations)
- Cloudflare Worker cron: every minute, push when a truck is within N stops or X meters of a subscribed stop
- ETA estimation: build on the Phase 1 "stops remaining" count with per-stop timing from GPS traces

**Phase 3 — More cities**
- Taipei, Taoyuan providers; evaluate PostGIS for a nationwide spatial index
