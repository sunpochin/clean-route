"use client";

// 檔案用途：浮在地圖上方的清運點查詢狀態條——查詢中／失敗／查無結果時說明「為什麼地圖上沒有點」，成功後自動消失。
// 所在層：src/components；純呈現元件，狀態來自 src/hooks/useNearbyStops.ts。
// 主要關聯：src/components/NearbyView.tsx；三種狀態必須長得不一樣（AGENTS.md § 3.4、docs/agents/code-conventions.md § 3）。
//
// 為什麼地圖上也要有：桌機版地圖佔了大半個畫面，列表的「查詢中」文字在左下角很容易被忽略；
// 使用者看到一張沒有任何標記的地圖，第一個念頭是「附近沒有垃圾車」或「壞掉了」——正是鐵律 3 要避免的誤會。

import type { ReactNode } from "react";
import { NEARBY_DEFAULT_RADIUS_M } from "@/lib/api-contract";
import { formatDistance } from "@/lib/format";
import { useSlowFlag } from "@/hooks/useSlowFlag";

/** 超過這個時間還沒回來才補充「第一次比較慢」的說明；快取熱時查詢通常 1 秒內完成。 */
export const SLOW_QUERY_HINT_MS = 3_000;

interface Props {
  isPending: boolean;
  isError: boolean;
  errorMessage?: string;
  placeCount: number;
  onRetry: () => void;
}

export function MapStatusBanner({ isPending, isError, errorMessage, placeCount, onRetry }: Props) {
  const slow = useSlowFlag(isPending, SLOW_QUERY_HINT_MS);

  let body: ReactNode = null;
  if (isPending) {
    body = (
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-1 size-5 shrink-0 animate-spin rounded-full border-[3px] border-line border-t-accent motion-reduce:animate-none"
        />
        <div>
          <p className="text-base font-bold">正在查詢附近的清運點…</p>
          {/* 冷啟動時伺服器要向新北市政府下載整份班表（27 頁、約 2.6 萬筆），實測約 8～15 秒。 */}
          {slow && <p className="text-sm">第一次查詢要下載整份新北市班表，可能需要十幾秒，請稍候。</p>}
        </div>
      </div>
    );
  } else if (isError) {
    body = (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold">清運點資料抓取失敗</p>
          <p className="text-sm">{errorMessage ? `${errorMessage}。` : ""}這不代表附近沒有垃圾車。</p>
        </div>
        <button type="button" onClick={onRetry} className="btn-small">
          再試一次
        </button>
      </div>
    );
  } else if (placeCount === 0) {
    body = (
      <p className="text-base">
        方圓 {formatDistance(NEARBY_DEFAULT_RADIUS_M)} 內沒有清運點
        <span className="block text-sm text-muted">目前只支援新北市。</span>
      </p>
    );
  }

  return (
    // 外層永遠存在並帶 aria-live：live region 必須先在 DOM 裡，內容變動才會被螢幕閱讀器念出來。
    // left/right 留白避開右上角的縮放按鈕；外層不吃點擊，地圖在狀態條兩側仍可拖曳。
    <div aria-live="polite" className="pointer-events-none absolute top-3 right-14 left-3 z-10 flex justify-center">
      {body && (
        <div
          role={isError ? "alert" : undefined}
          className={`pointer-events-auto w-full max-w-md rounded-xl border-2 px-4 py-3 shadow-lg ${
            isError ? "border-warn bg-warn-soft" : "border-line bg-surface"
          }`}
        >
          {body}
        </div>
      )}
    </div>
  );
}
