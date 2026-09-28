"use client";

// 檔案用途：取得使用者目前位置的狀態機（檢查權限 → 需要授權 → 定位中 → 完成／拒絕／失敗），另提供「示範位置」。
// 所在層：src/hooks；瀏覽器專用。位置只存在 React state，不寫入 storage、不送去自家 API 以外的地方（AGENTS.md § 3.5）。
// 主要關聯：src/components/NearbyView.tsx、src/components/LocationGate.tsx。

import { useCallback, useEffect, useState } from "react";
import type { LatLng } from "@/domain/types";

export type GeoState =
  | { status: "checking" }
  | { status: "needs-permission" }
  | { status: "locating" }
  | { status: "ready"; position: LatLng; accuracyM: number | null; isDemo: boolean }
  | { status: "denied" }
  | { status: "unsupported" }
  | { status: "error"; message: string };

/** 示範位置用公開地標，讓沒授權定位的人（或桌機）也能看到 App 在做什麼；畫面上必須標示「示範」。 */
export const DEMO_POSITION: LatLng = { lat: 25.0143, lng: 121.4638 };
export const DEMO_PLACE = "板橋車站周邊";
export const DEMO_LABEL = `${DEMO_PLACE}（示範）`;

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 15_000,
  // 一分鐘內的快取位置就夠用：清運點間距通常上百公尺，重新冷啟 GPS 只會拖慢 10 秒原則。
  maximumAge: 60_000,
};

export function useGeolocation() {
  const [state, setState] = useState<GeoState>({ status: "checking" });

  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setState({ status: "unsupported" });
      return;
    }
    setState({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setState({
          status: "ready",
          position: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          accuracyM: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
          isDemo: false,
        }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setState({ status: "denied" });
        else if (err.code === err.TIMEOUT) setState({ status: "error", message: "定位逾時，請移到窗邊或戶外再試一次" });
        else setState({ status: "error", message: "暫時無法取得位置，請稍後再試" });
      },
      GEO_OPTIONS,
    );
  }, []);

  const chooseDemo = useCallback(() => {
    setState({ status: "ready", position: DEMO_POSITION, accuracyM: null, isDemo: true });
  }, []);

  useEffect(() => {
    let cancelled = false;
    // 為什麼先查權限而不是一打開就跳授權視窗：沒說明理由就跳系統對話框，很多人會直接按拒絕，
    // 之後就要進瀏覽器設定才救得回來。只有「之前已經允許過」才自動定位，兼顧 10 秒原則。
    async function check() {
      if (!("geolocation" in navigator)) {
        if (!cancelled) setState({ status: "unsupported" });
        return;
      }
      try {
        const permission = await navigator.permissions?.query({ name: "geolocation" });
        if (cancelled) return;
        if (permission?.state === "granted") locate();
        else if (permission?.state === "denied") setState({ status: "denied" });
        else setState({ status: "needs-permission" });
      } catch {
        // 舊版 Safari 不支援查詢 geolocation 權限：退回「先說明、再由使用者按按鈕」。
        if (!cancelled) setState({ status: "needs-permission" });
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, [locate]);

  return { state, locate, chooseDemo };
}
