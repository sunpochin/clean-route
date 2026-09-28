"use client";

// 檔案用途：目前打開詳情的清運地點，並接上瀏覽器／手機的「上一頁」——按返回是關閉詳情回到列表，而不是離開網站。
// 所在層：src/hooks；瀏覽器專用。
// 主要關聯：src/components/NearbyView.tsx、src/components/PlaceDetail.tsx。

import { useCallback, useEffect, useRef, useState } from "react";

export function useSelectedPlace() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 是否有我們自己推進去、還沒被退掉的 history 紀錄；只有它存在時，關閉詳情才用 history.back()。
  const pushedRef = useRef(false);

  useEffect(() => {
    const onPopState = () => {
      if (!pushedRef.current) return;
      pushedRef.current = false;
      setSelectedId(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const open = useCallback((id: string) => {
    // 在詳情之間切換（例如直接點地圖上另一個點）只推一次：返回一次就回到列表，而不是逐一退回看過的每個點。
    // 不把地點 id 放進網址：id 含約 11 m 精度座標，網址會進瀏覽紀錄與分享連結（AGENTS.md § 3.5）。
    if (!pushedRef.current) {
      window.history.pushState(window.history.state, "");
      pushedRef.current = true;
    }
    setSelectedId(id);
  }, []);

  const close = useCallback(() => {
    // 走 history.back() 讓 popstate 統一收尾，瀏覽器的前進／後退堆疊才不會多出一筆孤兒紀錄。
    if (pushedRef.current) window.history.back();
    else setSelectedId(null);
  }, []);

  return { selectedId, open, close };
}
