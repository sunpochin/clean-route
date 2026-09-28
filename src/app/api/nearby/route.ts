// 檔案用途：GET /api/nearby?lat=&lng=&radius= —— 回傳查詢點附近的清運點候選清單。
// 所在層：src/app/api（Next.js route handler）；只做參數驗證、降精度與回應格式，資料來自 src/server/stop-cache.ts。
// 主要關聯：src/lib/api-contract.ts、src/domain/geo.ts、src/server/stop-cache.ts（背景刷新交給 after()）；隱私規則見 AGENTS.md § 3.5（本檔禁止記錄查詢座標）。

import { coarsenCoordinate, COARSEN_MAX_ERROR_M, findWithinRadius, isInTaiwan } from "@/domain/geo";
import {
  NEARBY_DEFAULT_RADIUS_M,
  NEARBY_MAX_RADIUS_M,
  NEARBY_MAX_RESULTS,
  NEARBY_MIN_RADIUS_M,
  type ApiErrorBody,
  type NearbyResponse,
} from "@/lib/api-contract";
import { after } from "next/server";
import { UpstreamError } from "@/providers/registry";
import { getStopSnapshot } from "@/server/stop-cache";

function badRequest(message: string) {
  return Response.json({ error: "bad_request", message } satisfies ApiErrorBody, { status: 400 });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const radiusParam = params.get("radius");
  const radius = radiusParam === null ? NEARBY_DEFAULT_RADIUS_M : Number(radiusParam);

  // Number(null) 是 0，所以缺參數會落到 isInTaiwan 被擋下，不需另外判斷 null。
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !isInTaiwan({ lat, lng })) {
    return badRequest("lat/lng 缺少或不在台灣範圍內");
  }
  if (!Number.isFinite(radius) || radius < NEARBY_MIN_RADIUS_M || radius > NEARBY_MAX_RADIUS_M) {
    return badRequest(`radius 需介於 ${NEARBY_MIN_RADIUS_M}–${NEARBY_MAX_RADIUS_M} 公尺`);
  }

  // 前端已經降過精度；伺服器再做一次是縱深防禦：就算有人直接帶精確座標呼叫，也不會在這裡被用到或流進快取鍵。
  const center = coarsenCoordinate({ lat, lng });

  try {
    // Phase 1 只有新北；多城市時改成依座標挑 provider（docs/PLAN.md Phase 3）。
    const snapshot = await getStopSnapshot("new-taipei");
    // 班表過期時快取會先回舊資料、在背景重抓；交給 after() 才能確保 serverless 在回應送出後不會把重抓凍結在半路。
    const { backgroundRefresh } = snapshot;
    if (backgroundRefresh) after(() => backgroundRefresh);
    const hits = findWithinRadius(snapshot.stops, center, radius + COARSEN_MAX_ERROR_M, NEARBY_MAX_RESULTS);
    const body: NearbyResponse = {
      stops: hits.map((hit) => hit.item),
      radiusM: radius,
      dataLoadedAt: snapshot.loadedAt.toISOString(),
      dataStale: snapshot.stale,
      skippedUpstreamRows: snapshot.skipped,
    };
    return Response.json(body, {
      // 降精度後相鄰使用者會打到同一個 URL，CDN 快取 10 分鐘能大幅減少冷啟動重抓。
      // 過期資料只短暫快取：上游恢復後要盡快換掉，不能讓 CDN 把「舊班表」再多供應 10 分鐘。
      headers: {
        "cache-control": snapshot.stale ? "public, s-maxage=60" : "public, s-maxage=600, stale-while-revalidate=3600",
      },
    });
  } catch (error) {
    // 只記錄上游來源與錯誤訊息，絕不記錄 lat/lng（AGENTS.md § 3.5）。
    console.error("[api/nearby] upstream failure", error instanceof UpstreamError ? error.source : "", error);
    return Response.json(
      { error: "upstream_unavailable", message: "新北市開放資料暫時無法取得" } satisfies ApiErrorBody,
      { status: 502 },
    );
  }
}
