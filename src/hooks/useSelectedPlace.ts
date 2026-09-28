"use client";

// 檔案用途：目前打開詳情的清運地點，並接上瀏覽器／手機的「上一頁／下一頁」——返回是關閉詳情回到列表，而不是離開網站。
// 所在層：src/hooks；瀏覽器專用。
// 主要關聯：src/components/NearbyView.tsx、src/components/PlaceDetail.tsx、docs/DECISIONS.md D7。

import { useCallback, useEffect, useRef, useState } from "react";

/** history.state 上的標記鍵；值是地點 id。有這個鍵的 history 紀錄就是「詳情頁」。 */
const STATE_KEY = "cleanRoutePlaceId";

function placeIdIn(state: unknown): string | null {
  if (typeof state !== "object" || state === null) return null;
  const value = (state as Record<string, unknown>)[STATE_KEY];
  return typeof value === "string" ? value : null;
}

/**
 * 為什麼把地點記在 history.state、而不是只用記憶體裡的旗標：
 * 旗標只知道「剛剛推過一筆」，按上一頁再按下一頁、或開著詳情重新整理後，
 * 回到的那筆紀錄看起來跟列表一模一樣，詳情回不來，還會多出一筆要多按一次返回的空紀錄（PR #2 review）。
 * 標記跟著紀錄走，任何方式回到這筆紀錄都能還原成對應的詳情。
 * 不放網址：id 含約 11 m 精度座標，網址會進瀏覽紀錄、分享連結與 CDN log（AGENTS.md § 3.5）；
 * history.state 只存在這個分頁的瀏覽器內，不會送到任何伺服器。
 */
export function useSelectedPlace() {
  // 開著詳情重新整理時，還原當時的地點；伺服器端 render 沒有 window，一律從列表開始。
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : placeIdIn(window.history.state),
  );

  // 已呼叫 history.back()、還在等 popstate 回來。back() 是非同步的，這段期間若再呼叫一次
  // （連點返回鍵＋Esc、或 NearbyView 的失效檢查在等待中又觸發），會多退一頁直接離開網站。
  const pendingBackRef = useRef(false);

  useEffect(() => {
    // 上一頁、下一頁都走這裡：回到帶標記的紀錄就打開那個地點，沒有標記就是列表。
    const onPopState = (event: PopStateEvent) => {
      pendingBackRef.current = false;
      setSelectedId(placeIdIn(event.state));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const open = useCallback((id: string) => {
    // 保留既有 state：Next.js 路由器把自己的資料也放在 history.state 裡。
    const state = { ...(window.history.state ?? {}), [STATE_KEY]: id };
    // 已經在詳情紀錄上（例如直接點地圖上另一個點）就原地換掉：返回一次就回到列表，而不是逐一退回看過的每個點。
    if (placeIdIn(window.history.state) !== null) window.history.replaceState(state, "");
    else window.history.pushState(state, "");
    setSelectedId(id);
  }, []);

  /**
   * 關閉詳情。也用在「選取的地點已不存在」（重新定位後不在結果內、或還原的 id 已失效）：
   * 只清掉標記不夠——底下那筆列表紀錄長得一模一樣，下一次返回會像沒反應（PR #2 review）；
   * 退回那筆列表紀錄，畫面與歷史紀錄才一致。
   */
  const close = useCallback(() => {
    if (pendingBackRef.current) return;
    // 走 history.back() 讓 popstate 統一收尾，前進／後退堆疊才不會多出一筆孤兒紀錄。
    if (placeIdIn(window.history.state) !== null) {
      pendingBackRef.current = true;
      window.history.back();
    } else {
      setSelectedId(null);
    }
  }, []);

  return { selectedId, open, close };
}
