// 檔案用途：把 maplibre-gl 的 Web Worker 模組（worker + shared）從 node_modules 複製到 public/maplibre/。
// 所在層：scripts；由 package.json 的 predev／prebuild 自動執行，產物已列入 .gitignore。
// 主要關聯：src/components/StopMap.tsx（setWorkerUrl 指向這裡）、docs/LESSONS.md（為什麼需要這一步）。
//
// 為什麼：MapLibre v6 是 ESM，worker 位置用 `new URL("./maplibre-gl-worker.mjs", import.meta.url)` 推算，
// 而 worker 又 import 相鄰的 `./maplibre-gl-shared.mjs`。Next.js（Turbopack）打包後 import.meta.url
// 指向 chunk 檔，兩個相鄰檔案都不存在，地圖會報「Worker failed to load」。
// 從「已安裝的套件」複製，而不是把檔案提交進 git：升級 maplibre-gl 時 worker 版本會自動跟著對齊。

import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "maplibre-gl", "dist");
const target = join(root, "public", "maplibre");

mkdirSync(target, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(source, file), join(target, file));
}
console.log(`[copy-maplibre-worker] copied worker files to public/maplibre`);
