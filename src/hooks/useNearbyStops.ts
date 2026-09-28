"use client";

// 檔案用途：以「降精度座標」向 /api/nearby 查候選清運點，再用精確座標在瀏覽器端重算距離、篩半徑、排序，最後合併成地點。
// 所在層：src/hooks；瀏覽器專用。降精度的理由見 docs/DECISIONS.md D6、AGENTS.md § 3.5。
// 主要關聯：src/lib/api-contract.ts、src/domain/geo.ts、src/components/NearbyView.tsx。

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { coarsenCoordinate, distanceMeters } from "@/domain/geo";
import { groupStopsByPlace, type StopPlace } from "@/domain/place";
import type { LatLng } from "@/domain/types";
import { NEARBY_DEFAULT_RADIUS_M, type NearbyResponse } from "@/lib/api-contract";
import { fetchJson } from "@/lib/fetch-json";

export interface PlaceWithDistance {
  place: StopPlace;
  distanceM: number;
}

export function useNearbyStops(position: LatLng | null, radiusM = NEARBY_DEFAULT_RADIUS_M) {
  // 查詢鍵只用降精度座標：GPS 每次回報都會抖動幾公尺，用精確座標當鍵會讓同一個位置不停重抓。
  const coarse = position ? coarsenCoordinate(position) : null;

  const query = useQuery({
    queryKey: ["nearby", coarse?.lat, coarse?.lng, radiusM],
    enabled: coarse !== null,
    queryFn: ({ signal }) =>
      fetchJson<NearbyResponse>(`/api/nearby?lat=${coarse!.lat}&lng=${coarse!.lng}&radius=${radiusM}`, signal),
    staleTime: 10 * 60 * 1000,
  });

  const places = useMemo<PlaceWithDistance[] | undefined>(() => {
    if (!query.data || !position) return undefined;
    const sorted = query.data.stops
      .map((stop) => ({ stop, distanceM: distanceMeters(position, stop.location) }))
      .filter((s) => s.distanceM <= radiusM)
      .sort((a, b) => a.distanceM - b.distanceM)
      .map((s) => s.stop);
    // 先依精確距離排序再合併，groupStopsByPlace 保留順序，地點自然也是由近到遠。
    return groupStopsByPlace(sorted).map((place) => ({ place, distanceM: distanceMeters(position, place.location) }));
  }, [query.data, position, radiusM]);

  return { ...query, places };
}
