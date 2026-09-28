// 檔案用途：GET /api/trucks?routes=a,b,c —— 回傳指定路線目前在線上的垃圾車即時位置，以及每台車推估開到路線上的第幾站。
// 所在層：src/app/api（Next.js route handler）；上游 GPS 由 Next data cache 快取 20 秒（docs/DECISIONS.md D4）。
// 主要關聯：src/providers/registry.ts、src/lib/api-contract.ts、src/hooks/useTrucks.ts、
//           src/domain/route-progress.ts 與 src/server/stop-cache.ts（站序比對，docs/DECISIONS.md D9）。

import { after } from "next/server";
import { matchRouteProgress } from "@/domain/route-progress";
import { TRUCKS_MAX_ROUTES, type ApiErrorBody, type TrackedTruck, type TrucksResponse } from "@/lib/api-contract";
import { getProvider, UpstreamError } from "@/providers/registry";
import { nextFetcher } from "@/server/next-fetcher";
import { getStopSnapshot, peekStopSnapshot, stopsByRoute } from "@/server/stop-cache";

const ROUTE_ID_PATTERN = /^[\w-]{1,32}$/;

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("routes") ?? "";
  const routeIds = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];

  if (routeIds.length === 0 || routeIds.length > TRUCKS_MAX_ROUTES || !routeIds.every((id) => ROUTE_ID_PATTERN.test(id))) {
    return Response.json(
      { error: "bad_request", message: `routes 需為 1–${TRUCKS_MAX_ROUTES} 個路線代碼，以逗號分隔` } satisfies ApiErrorBody,
      { status: 400 },
    );
  }

  try {
    const wanted = new Set(routeIds);
    const trucks = (await getProvider("new-taipei").fetchTrucks(nextFetcher)).filter((t) => wanted.has(t.routeId));

    // 站序比對只用這台機器上現成的班表，不等上游：即時位置比「第幾站」重要，不能讓冷啟動的 27 頁抓取拖慢它。
    // 班表還沒載入時在回應後背景載入（after 保證 serverless 不會中途凍結），下一輪 30 秒輪詢就有站序了。
    const snapshot = peekStopSnapshot("new-taipei");
    if (!snapshot) {
      after(() =>
        getStopSnapshot("new-taipei").then(
          () => undefined,
          // 不吞掉（AGENTS.md § 3.4）：記錄下來；畫面上這些車的 progress 是 null，會說「暫時無法判斷」。
          (error: unknown) => console.error("[api/trucks] stop snapshot warm-up failed", error),
        ),
      );
    }
    const index = snapshot ? stopsByRoute(snapshot) : null;
    const tracked: TrackedTruck[] = trucks.map((truck) => {
      // 班表裡找不到這條路線時給 null（無法比對），不能拿空陣列去比、再說成「車不在路線上」。
      const routeStops = index?.get(truck.routeId);
      return { ...truck, progress: routeStops ? matchRouteProgress(routeStops, truck.location, truck.recordedAt) : null };
    });

    const body: TrucksResponse = { trucks: tracked, fetchedAt: new Date().toISOString() };
    return Response.json(body, { headers: { "cache-control": "public, s-maxage=15" } });
  } catch (error) {
    console.error("[api/trucks] upstream failure", error instanceof UpstreamError ? error.source : "", error);
    return Response.json(
      { error: "upstream_unavailable", message: "垃圾車即時位置暫時無法取得" } satisfies ApiErrorBody,
      { status: 502 },
    );
  }
}
