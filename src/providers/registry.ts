// 檔案用途：所有縣市 provider 的註冊表；src/providers 以外的程式只能經由本檔取得 provider（AGENTS.md § 3.2）。
// 所在層：src/providers；新增城市 = 新增 provider 資料夾 + 在下方陣列加一行。
// 主要關聯：src/server/stop-cache.ts、src/app/api/*/route.ts。

import type { CityId } from "@/domain/types";
import { newTaipeiProvider } from "./new-taipei";
import type { CityProvider } from "./types";

export const providers: readonly CityProvider[] = [newTaipeiProvider];

export function getProvider(city: CityId): CityProvider {
  const provider = providers.find((p) => p.city === city);
  // CityId 是封閉的 union，走到這裡代表 registry 漏註冊——這是程式錯誤，不是使用者輸入錯誤。
  if (!provider) throw new Error(`Provider not registered: ${city}`);
  return provider;
}

export { UpstreamError, type JsonFetcher } from "./types";
