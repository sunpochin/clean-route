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
