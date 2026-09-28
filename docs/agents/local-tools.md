<!--
檔案用途：在 Claude Code 沙盒或受限環境裡執行 bun／node／gh 失敗時的排錯與降級方式。
所在層：docs/agents；AGENTS.md § 6 索引「bun／gh／git 在沙盒失敗」入口。
主要關聯：CLAUDE.md（沙盒注意）、docs/LESSONS.md。
-->

# 本機工具與沙盒排錯

| 症狀 | 原因 | 處理 |
| --- | --- | --- |
| `bun install`／`bunx` 出現 `bun is unable to write files to tempdir: EPERM` | 沙盒不允許寫入 bun 預設暫存目錄 | `export BUN_TMPDIR="$TMPDIR/bun-tmp" BUN_INSTALL_CACHE_DIR="$TMPDIR/bun-cache"` 後重跑 |
| `node -e 'fetch(...)'` 出現 `ENOTFOUND` | 沙盒網路走 proxy，Node 的 fetch 預設不讀 `HTTPS_PROXY` | 加 `NODE_USE_ENV_PROXY=1`；bun 的 fetch 會自動使用 proxy |
| Python 抓新北 API 出現 `CERTIFICATE_VERIFY_FAILED: Missing Subject Key Identifier` | Python 3.13+ 預設嚴格 X.509 驗證 | 改用 bun 寫探勘腳本；不要關掉憑證驗證 |
| `gh` 讀不到 `~/.config/gh/config.yml` | 沙盒限制家目錄設定檔 | 使用 `GH_CONFIG_DIR` 指向可寫目錄並提供 `GH_TOKEN`，或在允許的環境執行；不要誤判成登入過期 |
| 無法寫入 `.claude/settings.json`、`.claude/hooks/` | 受保護設定 | commit 閘門放在 `.githooks/`，不要另做 Claude hook |
| `bun run build` 出現 `TurbopackInternalError … binding to a port: Operation not permitted` | Turbopack 以子行程＋本機 port 跑 PostCSS，受限環境不允許綁 port（沙盒外的 agent 執行環境也可能如此） | 本機驗證改用 `bunx next build --webpack`；正式 build 交給 CI（一般環境可綁 port）。dev server 請用 app 的預覽功能啟動 |
