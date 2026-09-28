"use client";

// 檔案用途：單一清運地點卡片——這個地點下一次有車的時間、收運種類、距離、負責那一班的垃圾車離這裡多遠，以及其他班次；點下去打開該地點的完整週班表。
// 所在層：src/components；純呈現元件，排程由 src/domain/place.ts 推算。
// 主要關聯：src/components/NearbyView.tsx、src/components/PlaceDetail.tsx（點卡片後的詳情）、src/lib/format.ts；資料誠實規則見 AGENTS.md § 3.4。

import type { StopPlace } from "@/domain/place";
import { upcomingVisits } from "@/domain/place";
import { formatCountdown, formatDayLabel, formatDistance, SERVICE_LABEL } from "@/lib/format";
import { TruckStatus, type TruckNearStop } from "./TruckStatus";

interface Props {
  index: number;
  place: StopPlace;
  distanceM: number;
  /** 以清運點（路線）id 查車；地點內每條路線各自對應自己的車。 */
  truckByStopId: ReadonlyMap<string, TruckNearStop>;
  /** 有成功查到即時位置的路線；不在其中的路線只能說「無法取得」，不能說「沒有車在線上」。 */
  availableRouteIds: ReadonlySet<string>;
  onSelect: () => void;
  now: Date;
}

export function PlaceCard({ index, place, distanceM, truckByStopId, availableRouteIds, onSelect, now }: Props) {
  const [next, ...others] = upcomingVisits(place, now);
  const countdown = next ? formatCountdown(next.pickup) : null;

  return (
    // id 讓詳情按「返回」後能捲回並聚焦這張卡片（NearbyView），使用者不會迷失在長列表中。
    <li id={`place-${place.id}`} className="scroll-mt-3">
      <button
        type="button"
        onClick={onSelect}
        className="w-full rounded-2xl border-2 border-line bg-surface p-4 text-left transition-colors hover:border-accent/60 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
            {/* 明示「點了會怎樣」：整張卡片可點，但沒有提示的話，多數人只會把它當成靜態資訊。 */}
            <p className="mt-2 text-sm font-medium text-accent-strong">
              看完整週班表 <span aria-hidden>›</span>
            </p>
          </div>
        </div>
      </button>
    </li>
  );
}
