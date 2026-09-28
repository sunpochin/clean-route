"use client";

// 檔案用途：單一清運地點的詳情——下一班、以及這個地點所有路線（下午班、晚上班…）的完整週班表；取代列表顯示，只談這一個點。
// 所在層：src/components；純呈現元件，週班表由 src/domain/place.ts 的 weeklySchedule 推算。
// 主要關聯：src/components/NearbyView.tsx（開關與返回）、src/components/TruckStatus.tsx；資料誠實規則見 AGENTS.md § 3.4。

import { useEffect, useRef } from "react";
import { upcomingVisits, WEEK_ORDER, weeklySchedule, type RouteWeek, type StopPlace } from "@/domain/place";
import { nextPickup } from "@/domain/schedule";
import { taipeiClock } from "@/domain/time";
import type { Weekday } from "@/domain/types";
import { formatCountdown, formatDayLabel, formatDistance, formatWeekdayList, SERVICE_LABEL, WEEKDAY_SHORT } from "@/lib/format";
import { TruckStatus, type TruckNearStop } from "./TruckStatus";

interface Props {
  index: number;
  place: StopPlace;
  distanceM: number;
  truckByStopId: ReadonlyMap<string, TruckNearStop>;
  availableRouteIds: ReadonlySet<string>;
  onBack: () => void;
  now: Date;
}

export function PlaceDetail({ index, place, distanceM, truckByStopId, availableRouteIds, onBack, now }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [next] = upcomingVisits(place, now);
  const week = weeklySchedule(place);
  // 「今天」用台北時間判斷（AGENTS.md § 3.3），不能用手機的 getDay()。
  const today = taipeiClock(now).weekday;

  // 換地點時把焦點移到標題：螢幕閱讀器會念出新地點名稱，鍵盤使用者也從詳情開頭繼續，而不是停在已消失的卡片上。
  useEffect(() => {
    headingRef.current?.focus();
  }, [place.id]);

  // Esc 關閉詳情，和手機的返回鍵、畫面上的返回按鈕效果相同。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onBack();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  return (
    <article aria-labelledby="place-detail-title" className="flex flex-col gap-4">
      <button type="button" onClick={onBack} className="btn-small self-start">
        <span aria-hidden>‹ </span>返回附近清運點
      </button>

      <header className="rounded-2xl border-2 border-accent bg-accent-soft p-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-base font-bold text-on-accent"
          >
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              {/* tabIndex=-1：只讓程式能把焦點移過來，不會多一個 Tab 停留點。 */}
              <h2 id="place-detail-title" ref={headingRef} tabIndex={-1} className="text-xl font-bold outline-none">
                {place.name}
              </h2>
              <span className="shrink-0 text-sm text-muted">{formatDistance(distanceM)}</span>
            </div>
            <p className="text-sm text-muted">
              {place.district}
              {place.stops[0]?.village && `・${place.stops[0].village}`}・共 {place.stops.length} 個班次
            </p>
            {next ? (
              <>
                <p className="mt-2 text-sm font-medium">下一班</p>
                <p className="text-2xl font-bold">
                  {formatDayLabel(next.pickup)} 表定 {next.stop.timeOfDay}
                </p>
                {formatCountdown(next.pickup) && (
                  <p className="text-base font-medium text-accent-strong">{formatCountdown(next.pickup)}</p>
                )}
              </>
            ) : (
              <p className="mt-2 text-base text-muted">無法推算下一班時間</p>
            )}
          </div>
        </div>
      </header>

      <section aria-labelledby="weekly-title" className="flex flex-col gap-3">
        <h3 id="weekly-title" className="text-lg font-bold">
          每週班表
        </h3>
        <ol className="flex flex-col gap-3">
          {week.map((route) => (
            <RouteWeekCard
              key={route.stop.id}
              route={route}
              isNext={route.stop.id === next?.stop.id}
              today={today}
              truck={truckByStopId.get(route.stop.id) ?? null}
              trucksAvailable={availableRouteIds.has(route.stop.routeId)}
              now={now}
            />
          ))}
        </ol>
      </section>

      {[...new Set(place.stops.map((s) => s.note).filter(Boolean))].map((note) => (
        <p key={note} className="text-sm text-warn">
          備註：{note}
        </p>
      ))}
    </article>
  );
}

function RouteWeekCard({
  route,
  isNext,
  today,
  truck,
  trucksAvailable,
  now,
}: {
  route: RouteWeek;
  isNext: boolean;
  today: Weekday;
  truck: TruckNearStop | null;
  trucksAvailable: boolean;
  now: Date;
}) {
  const { stop, groups, days } = route;
  const pickup = nextPickup(stop, now);
  const offDays = WEEK_ORDER.filter((d) => !days.includes(d));
  const countdown = pickup ? formatCountdown(pickup) : null;

  return (
    <li className={`rounded-2xl border-2 bg-surface p-4 ${isNext ? "border-accent" : "border-line"}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {/* 時刻是這張卡最重要的資訊（「下午那班還是晚上那班」），用最大字。 */}
        <p className="text-2xl font-bold tabular-nums">{stop.timeOfDay}</p>
        <p className="text-base">{stop.routeName}</p>
        {isNext && <span className="rounded-md bg-accent px-2 py-0.5 text-sm font-bold text-on-accent">下一班</span>}
      </div>
      <p className="text-sm text-muted">第 {stop.sequence} 站</p>

      {/* 日期格只是視覺輔助（aria-hidden）；「哪幾天收、哪幾天不收」由下方文字完整說明，不只靠顏色或刪除線。 */}
      <div aria-hidden className="mt-3 grid grid-cols-7 gap-1 text-center">
        {WEEK_ORDER.map((day) => {
          const on = days.includes(day);
          return (
            <div key={day} className="flex flex-col items-center gap-0.5">
              <span
                className={`flex h-10 w-full items-center justify-center rounded-lg text-base ${
                  on ? "bg-accent-soft font-bold" : "border border-dashed border-line text-muted line-through"
                } ${day === today ? "outline-2 outline-offset-1 outline-foreground" : ""}`}
              >
                {WEEKDAY_SHORT[day]}
              </span>
              <span className="h-4 text-xs leading-4 font-medium">{day === today ? "今天" : ""}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex flex-col gap-2">
        {groups.map((group) => (
          <div key={group.days.join()} className="flex flex-col gap-1">
            {/* 每天收的種類都一樣時，不重複列日期（上方已有），只列種類。 */}
            {groups.length > 1 && <p className="text-sm font-medium">{formatWeekdayList(group.days)}</p>}
            <ul className="flex flex-wrap gap-1.5" aria-label={`${formatWeekdayList(group.days)} 收運種類`}>
              {group.services.map((service) => (
                <li key={service} className={`chip chip--${service}`}>
                  {SERVICE_LABEL[service]}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {/* 畫面上日期格已看得出哪天收，文字只補「哪天不收」，避免手機上一長串換行；
            完整的收運日給螢幕閱讀器（日期格對它是隱藏的）。 */}
        <p className="text-sm text-muted">
          {offDays.length === 0 ? (
            "每天都收"
          ) : (
            <>
              <span className="sr-only">收運日：{formatWeekdayList(days)}。</span>
              {formatWeekdayList(offDays)}停收
            </>
          )}
        </p>
      </div>

      {pickup && (
        <p className="mt-2 text-base">
          這班下一次：<span className="font-bold">{formatDayLabel(pickup)}</span>
          {countdown && <span className="ml-1 text-accent-strong">（{countdown}）</span>}
        </p>
      )}
      {/* 只有今天這班才顯示即時車輛，理由同 PlaceCard：別讓人以為明天的車已經在路上（AGENTS.md § 3.4）。 */}
      {pickup?.dayOffset === 0 && <TruckStatus truck={truck} trucksAvailable={trucksAvailable} now={now} />}
    </li>
  );
}
