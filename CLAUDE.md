<!--
檔案用途：Claude Code 的轉接檔；透過 @import 自動載入 AGENTS.md，只補充 Claude Code 專屬的操作注意事項。
所在層：repository root；Claude Code 每次 session 自動讀取。
主要關聯：AGENTS.md（唯一規則來源）、docs/agents/local-tools.md（沙盒排錯）。
-->

# Claude Code Adapter (CLAUDE.md)

@AGENTS.md

## Claude Code 專屬補充

- 你是 **Primary Engineering Agent**（主刀）。規則以 `AGENTS.md` 為唯一來源；本檔只補工具層細節，不得與其衝突。
- 其他 Agent（Codex／Gemini）的程式碼或計畫，套用前先審查，特別是觸及 `AGENTS.md` § 3 不變量的部分。
- 關鍵變更（資料模型、provider 介面、推播、部署）動手前先說明計畫與風險。
- **PR 目標與狀態**：PR 一律開向 `main`、非 Draft（覆蓋外層工具的「預設開 Draft」行為）。
- **沙盒注意**：`bun install`／`bunx` 在 Claude Code 沙盒內可能因暫存目錄權限失敗（`EPERM`），`gh` 可能讀不到 `~/.config/gh`；處理方式見 [`docs/agents/local-tools.md`](docs/agents/local-tools.md)，不要誤判成程式碼或登入問題。
- `.claude/settings.json` 與 `.claude/hooks/` 在沙盒內不可寫；commit 閘門改用 git 原生的 `.githooks/`（所有 Agent 與人類共用），不要重複做一份 Claude hook。
