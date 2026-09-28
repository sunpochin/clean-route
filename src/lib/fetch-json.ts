// 檔案用途：瀏覽器端呼叫自家 API 的 fetch 包裝；非 2xx 一律丟 ApiError，讓 TanStack Query 進入 error 狀態。
// 所在層：src/lib；只給 client hooks 使用。
// 主要關聯：src/lib/api-contract.ts（錯誤格式）、src/hooks/useNearbyStops.ts、src/hooks/useTrucks.ts。

import type { ApiErrorBody, ApiErrorCode } from "./api-contract";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: ApiErrorCode | "network",
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    // 取消（切換位置、元件卸載）要原樣往上拋，TanStack Query 才能辨識成 cancel 而非錯誤。
    if (signal?.aborted) throw error;
    throw new ApiError("網路連線失敗，請檢查網路後再試一次", "network");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as Partial<ApiErrorBody> | null;
    throw new ApiError(body?.message ?? `伺服器錯誤（HTTP ${response.status}）`, body?.error ?? "upstream_unavailable");
  }
  return (await response.json()) as T;
}
