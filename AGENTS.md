<!--
檔案用途：本 repository 的 AI 協作憲法，只放「不能違反的不變量」與「每次任務都要走的最短流程」。
所在層：repository root；所有 Agent（Claude Code、Codex、Gemini…）與人類貢獻者的唯一規則來源，旁支文件只能補細節、不能放寬。
主要關聯：CLAUDE.md（轉接檔）、docs/DECISIONS.md（定案決策）、docs/agents/*（按需閱讀的細則，見第 6 節索引）。
-->

# 核心憲法 — clean-route（垃圾車雷達）

所有 AI Agent 必須遵守本檔。旁支文件可以補充，不得放寬本檔。

**分層契約**：本檔只放不變量與必讀流程。每多一條規則，每個 Agent 每次任務都要多讀一條，真正致命的規則就會被稀釋。所以：

- **新規則預設放旁支。** 只有同時滿足「適用所有任務」與「漏掉會造成實質傷害」才進第 3 節；其餘放 `docs/agents/`，並在第 6 節補一列觸發入口。
- **能自動檢查的就不要只寫成文字。** 一條測試斷言、lint rule 或 git hook 比一段叮嚀可靠。
- **跨檔引用本檔用章節名稱**（可附編號），不用行號。
- **長度約 150 行是警戒線。** 超線時先搬東西出去，不要往下加。

---

## 1. 產品北極星

**一句話定位**：打開就知道「我家附近的垃圾車幾點到、現在開到哪」，不用再站在門口等、也不用追著車跑。

設計鐵律（每個 Feature 動工前先過這五關）：

1. **10 秒原則**：授權定位後，從打開 App 到看到「最近清運點的下一班時間」≤ 10 秒、零額外操作。做不到就砍功能。
2. **推播寧缺勿濫**：只推「現在該出門倒垃圾」這一種需要立刻行動的事；其他資訊留在畫面上。
3. **資料誠實（Fail loudly）**：抓不到資料 ≠ 附近沒有車；過期的 GPS ≠ 即時位置；表定時間 ≠ 實際到達時間。詳見 § 3.4。
4. **戶外單手可用**：大字、高對比、按鈕夠大；狀態不得只靠顏色表達（長輩與色弱使用者也要看得懂）。
5. **位置隱私**：使用者位置只用於當次查詢，不記錄、不外傳。詳見 § 3.5。

---

## 2. 最高原則（Prime Directive）

每次修改，不論大小，都必須做完四件事：

1. **ELI5 解說**：在回應裡用完全不懂技術的人也看得懂的話說明改了什麼。
2. **Why-Not-What 註解**：修改的程式碼裡用繁體中文註解說明「為什麼」；有坑、非直覺決策與執行順序要特別標。
3. **技術文件**：只讀、只改與本次變更相關的 `docs/`；新增決策寫進 [`docs/DECISIONS.md`](docs/DECISIONS.md)，修完 bug 在 [`docs/LESSONS.md`](docs/LESSONS.md) 補一條。
4. **Commit**：每完成一件可獨立 review 的事就 commit；push／開 PR 依第 4 節流程。

每個新建或修改的人工維護檔案，開頭都要有繁體中文導覽（檔案用途／所在層／主要關聯）；格式與例外見 [`docs/agents/code-conventions.md`](docs/agents/code-conventions.md)。

---

## 3. 不變量（Invariants）

以下每一條都是專案不變量，不是風格偏好；不論任務大小或急迫程度都適用。

### 3.1 破壞性操作與受保護資源

未經使用者明確同意，絕不執行：`rm -rf`（scratch／build 產物除外）、`git reset --hard`、`git clean -fd`、`git push --force`、`drop table`、`truncate table`、`supabase db reset`、`vercel deploy --prod`、覆寫 `.env*` 檔。
受保護資源：`.env*`、VAPID 私鑰、Supabase service role key、任何 API token、production 資料庫。

### 3.2 城市資料隔離（Provider 邊界）

- 各縣市 Open Data 的原始欄位（例如新北的 `lineid`、`garbagemonday`）**只准出現在** `src/providers/<city>/` 內，包括原始格式的測試假資料（放在該資料夾的 `test-fixtures.ts`）。
- 唯一例外是測試：`tests/unit/` 可以 import provider 內部檔案來測試它，但只能透過該 provider 的 `test-fixtures.ts` 產生原始資料，不得在 `tests/` 內自行定義原始欄位。
- Provider 必須把資料正規化成 [`src/domain/types.ts`](src/domain/types.ts) 的型別後才能離開該資料夾；`src/app`、`src/components`、`src/domain` 不得 import 任何 provider 內部檔案，只能透過 `src/providers/registry.ts`。
- 新增城市 = 新增一個 provider 資料夾 + 在 registry 註冊一行；如果需要改前端才能支援新城市，代表 domain 型別設計有漏洞，先修型別。
- 為什麼：政府 API 的 schema 會變、各縣市長得完全不一樣；綁死在 UI 上，換一個城市就要重寫整個前端。

### 3.3 時區不變量

所有清運時間、星期幾、「今天／明天」的判斷一律以 **`Asia/Taipei`** 計算（統一走 `src/domain/time.ts`）。不得直接用 `new Date().getDay()`／`getHours()`：伺服器（Vercel 為 UTC）與使用者手機的時區都不可信，晚上 8 點以後會整整差一天。

### 3.4 資料誠實（Fail loudly）

- **讀取失敗與「查無結果」必須是不同的畫面狀態**，不得共用同一個變數或同一句文案。上游 API 掛掉時要明說「資料抓取失敗」，絕不能顯示成「附近沒有清運點」。
- 即時 GPS 一律顯示資料時間；超過 `STALE_TRUCK_MS`（見 `src/domain/freshness.ts`）的位置必須標示為「位置可能過期」。
- 表定時間與即時位置要在文案上區分（「表定 19:40」vs「車輛目前距離 1.2 km」）；在有可靠的估算模型之前，不得把表定時間說成「預計到達」。
- 任何 silent failure（吞掉 exception、回傳空陣列假裝成功）都視為 P0 bug。

### 3.5 位置隱私

- 使用者座標只用於當次查詢：伺服器端不得記錄（含 `console.log`、analytics、錯誤回報）或持久化原始座標。
- 送往自家 API 的座標先降精度（`src/domain/geo.ts` 的 `coarsenCoordinate`，約 100 m 格），精確距離在瀏覽器端重算。
- Git 追蹤內容（程式碼、測試 fixture、文件、Issue、PR、截圖）不得包含真實住家地址或座標；測試與範例一律用公開地標（例如板橋車站）。
- 未來儲存推播訂閱時，只存「訂閱的清運點 id」，不存使用者位置。

### 3.6 審查意見處理閘門

- **不得盲修 review**：bot、工具或真人的意見都先判斷是否技術正確、與本次任務相關、符合本憲法；驗證後同意才修。不同意時要說明理由與證據，不可為了消除 review 而改程式。
- 收到 PR review 回饋時，先用 ELI5 白話分析每條建議並表態是否認同；認同（或部分認同）就直接實作並 commit，使用者事後不同意可要求 revert。
- 只有意見已確認、修正已通過驗證，才能標記 resolved。

---

## 4. 開發與工作流程

- **套件管理與測試一律用 bun**：`bun install`、`bun run test`（= `bun test tests/unit`）、`bun run typecheck`、`bun run lint`。不要 `npm install`：會跟 `bun.lock` 對不上。
- **全面 TypeScript**：新檔一律 `.ts`／`.tsx`，不新增 `.js`（設定檔若工具只吃 `.mjs` 除外）。
- **禁止硬編碼絕對路徑**：程式碼、設定、測試、文件一律用相對路徑（不得出現 `/Users/...`、`file:///`）。
- **Next.js 16 不是你記憶中的 Next.js**：寫 routing／caching／route handler 之前，先讀 `node_modules/next/dist/docs/` 對應章節（見文末區塊）。
- **Commit message**：`type: Title` + 空行 + 為什麼要改（type：feat／fix／docs／refactor／test／chore）。
- **分支**：每個獨立任務從最新 `main` 開 `feature/*`、`fix/*`、`docs/*` 分支；PR 一律開向 `main`、非 Draft。只有使用者明確要求延續同一個任務／PR 時才留在原分支。
- **Pre-commit gate**：`.githooks/pre-commit` 會擋 `.env`、疑似 secret，並跑 typecheck + unit test；`bun install` 會自動啟用（`prepare` script）。不得用 `--no-verify` 繞過，除非使用者明確同意。
- **實作計畫雙語**：產出實作計畫時，採「中文在前半段、英文在後半段」的對照格式。
- **驗證範圍**：先跑受影響的 unit test 與 typecheck；UI 變更要實際在瀏覽器看過（手機寬度）。完整 build 交給 CI。
- **兩次失敗即停**：同一問題連續兩次實質修正仍失敗，停止原方向 patch、重新找 root cause；出現「改 test → 改 mock → 加 `any`」的模式時立刻視為已達門檻。
- **工具指令**：驗證／測試指令不得接 `| grep`、`| tail` 之類管線吞掉 exit code。

---

## 5. 工具定位

- **Primary Engineer（Claude Code）**：架構決策、正式程式碼、資料邊界與其他 Agent 產出的最終審查。
- **Secondary Assistant（Codex／Gemini 等）**：規劃、UI 原型、瀏覽器驗證、低風險修補；觸及 § 3 不變量的變更必須由 Claude Code 或使用者審查。

---

## 6. 按需閱讀索引

只在情境出現時才讀對應文件，不要預先全部載入。

| 情境 | 讀這份 |
| --- | --- |
| 產品範圍、分期路線、為什麼現在不做某功能 | [`docs/PLAN.md`](docs/PLAN.md) |
| 想改技術選型或架構（框架、資料庫、部署、地圖） | [`docs/DECISIONS.md`](docs/DECISIONS.md) |
| 系統資料流、目錄職責、API 端點 | [`docs/architecture.md`](docs/architecture.md) |
| 動到新北 provider、欄位意義、API 分頁與快取 | [`docs/data-sources/new-taipei.md`](docs/data-sources/new-taipei.md) |
| 寫或改 `src/`：檔頭導覽、註解、檔案大小、畫面狀態（載入／錯誤／空） | [`docs/agents/code-conventions.md`](docs/agents/code-conventions.md) |
| `bun`／`gh`／`git` 在沙盒失敗、工具降級 | [`docs/agents/local-tools.md`](docs/agents/local-tools.md) |
| 修完 bug、想知道某條規則從哪個坑來的 | [`docs/LESSONS.md`](docs/LESSONS.md) |

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
