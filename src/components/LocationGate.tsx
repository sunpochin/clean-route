"use client";

// 檔案用途：還沒有位置時的畫面——先說明為什麼需要定位、由使用者按鈕觸發，並處理拒絕／不支援／失敗。
// 所在層：src/components；純呈現，狀態來自 src/hooks/useGeolocation.ts。
// 主要關聯：src/components/NearbyView.tsx；「先說明再請求權限」的理由見 useGeolocation.ts 註解。

import type { GeoState } from "@/hooks/useGeolocation";
import { DEMO_PLACE } from "@/hooks/useGeolocation";

interface Props {
  state: Exclude<GeoState, { status: "ready" }>;
  onLocate: () => void;
  onDemo: () => void;
}

export function LocationGate({ state, onLocate, onDemo }: Props) {
  if (state.status === "checking" || state.status === "locating") {
    return (
      <section className="flex flex-col items-center gap-3 p-8 text-center" aria-live="polite">
        <div className="size-10 animate-spin rounded-full border-4 border-line border-t-accent motion-reduce:animate-none" />
        <p className="text-lg">{state.status === "locating" ? "正在取得你的位置…" : "準備中…"}</p>
      </section>
    );
  }

  const message = {
    "needs-permission": null,
    denied: "你已拒絕定位權限。請到瀏覽器或手機設定中允許本網站使用位置，再按下方按鈕。",
    unsupported: "這個瀏覽器不支援定位功能。",
    error: state.status === "error" ? state.message : null,
  }[state.status];

  return (
    <section className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h2 className="text-2xl font-bold">找出離你最近的垃圾車</h2>
      <p className="text-lg leading-relaxed">
        需要你的位置，才能列出附近的清運點與垃圾車。位置只用來查這一次，<strong>不會被記錄或保存</strong>。
      </p>
      {message && (
        <p role="alert" className="rounded-xl border-2 border-warn bg-warn-soft p-3 text-base">
          {message}
        </p>
      )}
      {state.status !== "unsupported" && (
        <button type="button" onClick={onLocate} className="btn-primary">
          📍 使用我的位置
        </button>
      )}
      <button type="button" onClick={onDemo} className="btn-secondary">
        先用示範位置看看（{DEMO_PLACE}）
      </button>
    </section>
  );
}
