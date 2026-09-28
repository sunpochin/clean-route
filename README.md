<!--
檔案用途：專案入口說明——做什麼、怎麼跑、文件地圖。
所在層：repository root。
主要關聯：AGENTS.md（開發規則）、docs/*。
-->

# 垃圾車雷達（clean-route）

打開就知道「我家附近的垃圾車幾點到、現在開到哪」。目前支援新北市，資料來自新北市政府資料開放平台。

- 自動定位 → 列出附近清運地點的**下一班表定時間**與收運種類（一般垃圾／資源回收／廚餘）
- 同一路口的下午班、晚上班合併顯示，最快到的一班排最前面
- 負責該班路線的垃圾車**即時位置**與距離，每 30 秒更新；過期位置會明確標示
- 位置先降精度（約 100 m）才送到伺服器，伺服器不記錄座標

## 開發

需要 [bun](https://bun.sh) ≥ 1.4。

```bash
bun install
```

```bash
bun run dev
```

```bash
bun run check
```

`bun install` 會自動啟用 `.githooks/pre-commit`（擋 `.env`／secret，並跑 typecheck 與 unit test）。

## 技術棧

Next.js 16（App Router）· React 19 · TypeScript · Tailwind CSS v4 · TanStack Query · MapLibre GL JS v6 + OpenFreeMap。
Phase 1 沒有資料庫；Phase 2（推播提醒）才加入 Supabase 與 Cloudflare Worker。理由見 [`docs/DECISIONS.md`](docs/DECISIONS.md)。

## 文件地圖

| 文件 | 內容 |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | AI 協作憲法：產品鐵律、不變量、工作流程（人類貢獻者也適用） |
| [`docs/PLAN.md`](docs/PLAN.md) | 產品範圍、分期路線、對最初技術規劃的審核 |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | 定案技術決策 |
| [`docs/architecture.md`](docs/architecture.md) | 資料流、目錄職責、API |
| [`docs/data-sources/new-taipei.md`](docs/data-sources/new-taipei.md) | 新北開放資料欄位與實測品質 |
| [`docs/LESSONS.md`](docs/LESSONS.md) | 踩過的坑 |

## 授權

GPL-3.0，見 [`LICENSE`](LICENSE)。
