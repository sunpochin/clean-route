"use client";

// 檔案用途：單一清運地點卡片——這個地點下一次有車的時間、收運種類、距離、負責那一班的垃圾車離這裡多遠，以及其他班次。
// 所在層：src/components；純呈現元件，排程由 src/domain/place.ts 推算。
// 主要關聯：src/components/NearbyView.tsx、src/lib/format.ts；資料誠實規則見 AGENTS.md § 3.4。

import { ageMs, isStale } from "@/domain/freshness";
import type { StopPlace } from "@/domain/place";
import { upcomingVisits } from "@/domain/place";
import type { GarbageTruck } from "@/domain/types";
import { formatAge, formatCountdown, formatDayLabel, formatDistance, SERVICE_LABEL } from "@/lib/format";

export interface TruckNearStop {
  truck: GarbageTruck;
  distanceM: number;
}

interface Props {
  index: number;
  place: StopPlace;
  distanceM: number;
  /** 以清運點（路線）id 查車；地點內每條路線各自對應自己的車。 */
  truckByStopId: ReadonlyMap<string, TruckNearStop>;
  /** 有成功查到即時位置的路線；不在其中的路線只能說「無法取得」，不能說「沒有車在線上」。 */
  availableRouteIds: ReadonlySet<string>;
  selected: boolean;
  onSelect: () => void;
  now: Date;
}

export function PlaceCard({ index, place, distanceM, truckByStopId, availableRouteIds, selected, onSelect, now }: Props) {
  const [next, ...others] = upcomingVisits(place, now);
  const countdown = next ? formatCountdown(next.pickup) : null;

  return (
    // id 讓地圖點選時能捲動到這張卡片（NearbyView 的 selectPlace）。
    <li id={`place-${place.id}`} className="scroll-mt-3">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`w-full rounded-2xl border-2 p-4 text-left transition-colors ${
          selected ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-accent/60"
        }`}
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-base font-bold text-on-accent"
          >
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="truncate text-lg font-bold">{place.name}</h3>
              <span className="shrink-0 text-sm text-muted">{formatDistance(distanceM)}</span>
            </div>

            {next ? (
              <>
                <p className="mt-1 text-xl font-bold">
                  {formatDayLabel(next.pickup)} 表定 {next.stop.timeOfDay}
                </p>
                {countdown && <p className="text-base font-medium text-accent-strong">{countdown}</p>}
                <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="這一班收運種類">
                  {next.pickup.services.map((service) => (
                    // 用文字標示種類而不是只用顏色，色弱與長輩也能分辨（AGENTS.md § 1 鐵律 4）。
                    <li key={service} className={`chip chip--${service}`}>
                      {SERVICE_LABEL[service]}
                    </li>
                  ))}
                </ul>
                {/* 只有今天這班才顯示即時車輛：同一路線的車若正在跑今天的行程，掛在「明天／下週」那班底下
                    會讓人誤以為明天的車已經在路上（AGENTS.md § 3.4）。 */}
                {next.pickup.dayOffset === 0 && (
                  <TruckStatus
                    truck={truckByStopId.get(next.stop.id) ?? null}
                    trucksAvailable={availableRouteIds.has(next.stop.routeId)}
                    now={now}
                  />
                )}
                <p className="mt-2 text-sm text-muted">
                  {place.district}・{next.stop.routeName}・第 {next.stop.sequence} 站
                </p>
              </>
            ) : (
              <p className="mt-1 text-base text-muted">無法推算下一班時間</p>
            )}

            {others.length > 0 && (
              <p className="mt-1 text-sm text-muted">
                其他班次：
                {others.map((v) => `${formatDayLabel(v.pickup)} ${v.stop.timeOfDay}`).join("、")}
              </p>
            )}
            {[...new Set(place.stops.map((s) => s.note).filter(Boolean))].map((note) => (
              <p key={note} className="mt-1 text-sm text-warn">
                備註：{note}
              </p>
            ))}
          </div>
        </div>
      </button>
    </li>
  );
}

function TruckStatus({ truck, trucksAvailable, now }: { truck: TruckNearStop | null; trucksAvailable: boolean; now: Date }) {
  if (!trucksAvailable) return <p className="mt-2 text-sm text-muted">即時位置暫時無法取得</p>;
  if (!truck) return <p className="mt-2 text-sm text-muted">這一班的車目前沒有回報位置（可能尚未出車）</p>;

  const stale = isStale(truck.truck.recordedAt, now);
  const age = ageMs(truck.truck.recordedAt, now);
  return (
    <p className={`mt-2 text-base font-medium ${stale ? "text-warn" : "text-live"}`}>
      🚛 車輛距此 {formatDistance(truck.distanceM)}
      <span className="ml-1 text-sm font-normal">
        （{age === null ? "時間不明" : `${formatAge(age)}回報`}
        {stale && "，位置可能過期"}）
      </span>
    </p>
  );
}
