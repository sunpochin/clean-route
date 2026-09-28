// 檔案用途：把垃圾車的即時 GPS 對到它所屬路線的站序，推估「車開到第幾站」，以及距離某一站還差幾站。
// 所在層：src/domain；純函式，與城市無關（只用 GarbageStop 的 routeId／sequence／location／timeOfDay）。
// 主要關聯：src/app/api/trucks/route.ts（伺服器端比對）、src/components/TruckStatus.tsx（顯示）、
//           tests/unit/route-progress.test.ts、docs/DECISIONS.md D9（門檻值的實測依據）。
//
// 為什麼不能只找「最近的一站」：2026-09 實測新北 648 條路線中有 415 條會繞回已經收過的地方
// （60 m 內、站序相差 5 站以上，中位數相差 12 站），車停在那裡時最近的站可能是第 6 站也可能是第 18 站。
// 所以先把候選站依站序分成「路段」，多個路段時再用表定時刻挑；仍分不出來就明說「無法判斷」，不猜（AGENTS.md § 3.4）。

import { parseTimeOfDay, taipeiClock } from "./time";
import type { GarbageStop, LatLng } from "./types";
import { distanceMeters } from "./geo";

/**
 * 車離站多遠以內才算「在這一站附近」。實測相鄰兩站距離中位數 79 m；
 * 以 80 m 加 30 m GPS 雜訊模擬，能回答的情況中 ±1 站以內約 99%。放寬到 100 m 會讓更多繞回的路段落入候選而變得無法判斷。
 */
export const ROUTE_MATCH_RADIUS_M = 80;

/** 候選站的站序相差不超過這個值，就視為同一段路（同一次經過）。 */
export const SAME_PASS_MAX_SEQUENCE_GAP = 3;

/**
 * 有多段路都在附近時，表定時刻最接近的那段必須領先第二名這麼多分鐘才採用。
 * 垃圾車常晚到 10～20 分鐘；實測繞回的兩段表定時刻中位數只差 11 分鐘，門檻太小就會被晚到騙。
 * 模擬晚到 20 分鐘時，20 分鐘門檻下回答正確（±2 站）仍約 99%。
 */
export const PASS_TIME_MARGIN_MINUTES = 20;

export type RouteProgress =
  /** sequence：車目前最接近的站序；distanceM：車到那一站的直線距離。 */
  | { status: "matched"; sequence: number; distanceM: number }
  /** 路線在這一帶經過不只一次，且表定時刻分不出是哪一次。 */
  | { status: "ambiguous" }
  /** 附近沒有這條路線的站：可能正在前往路線起點、兩站相距很遠的途中，或已收班回場。 */
  | { status: "offRoute" };

interface Candidate {
  stop: GarbageStop;
  distanceM: number;
}

/**
 * @param routeStops 同一條路線的所有站（順序不拘）。
 * @param recordedAt GPS 定位時間（ISO）；用它而不是「現在」判斷表定時刻，位置過期時才不會用錯時間去挑路段。
 */
export function matchRouteProgress(routeStops: readonly GarbageStop[], position: LatLng, recordedAt: string): RouteProgress {
  const candidates: Candidate[] = [];
  for (const stop of routeStops) {
    const distanceM = distanceMeters(stop.location, position);
    if (distanceM <= ROUTE_MATCH_RADIUS_M) candidates.push({ stop, distanceM });
  }
  if (candidates.length === 0) return { status: "offRoute" };

  // 依站序切成「路段」：站序相連（差距 ≤ 門檻）的候選屬於同一次經過。
  candidates.sort((a, b) => a.stop.sequence - b.stop.sequence);
  const passes: Candidate[][] = [];
  for (const candidate of candidates) {
    const current = passes.at(-1);
    const last = current?.at(-1);
    if (current && last && candidate.stop.sequence - last.stop.sequence <= SAME_PASS_MAX_SEQUENCE_GAP) current.push(candidate);
    else passes.push([candidate]);
  }

  const pass = passes.length === 1 ? passes[0] : pickPassBySchedule(passes, recordedAt);
  if (!pass) return { status: "ambiguous" };
  const nearest = pass.reduce((a, b) => (b.distanceM < a.distanceM ? b : a));
  return { status: "matched", sequence: nearest.stop.sequence, distanceM: nearest.distanceM };
}

/** 多段都在附近時，挑表定時刻最接近 GPS 時間的那段；領先不夠明顯就回 null。 */
function pickPassBySchedule(passes: Candidate[][], recordedAt: string): Candidate[] | null {
  const recorded = Date.parse(recordedAt);
  // 不知道定位時間就沒有依據挑路段；寧可說無法判斷，也不要隨便挑一段。
  if (Number.isNaN(recorded)) return null;
  const minute = taipeiClock(new Date(recorded)).minuteOfDay;

  const scored = passes
    .map((pass) => ({ pass, gap: scheduleGapMinutes(pass, minute) }))
    .sort((a, b) => a.gap - b.gap);
  const [best, second] = scored;
  if (!Number.isFinite(best.gap) || second.gap - best.gap < PASS_TIME_MARGIN_MINUTES) return null;
  return best.pass;
}

/** GPS 時間離這段路的表定時段有多遠（在時段內為 0）；整段都沒有可解析的時刻時回傳 Infinity。 */
function scheduleGapMinutes(pass: readonly Candidate[], minute: number): number {
  const times = pass.map((c) => parseTimeOfDay(c.stop.timeOfDay)).filter((t): t is number => t !== null);
  if (times.length === 0) return Infinity;
  const start = Math.min(...times);
  const end = Math.max(...times);
  if (minute < start) return start - minute;
  if (minute > end) return minute - end;
  return 0;
}

/**
 * 從車目前的站到 targetSequence 還差幾站；負值代表車的站序已超過目標站（可能已經過了）。
 * 直接用站序相減：實測全市只有 3 處站序跳號，誤差遠小於比對本身的 ±1 站。
 */
export function stopsUntil(progress: Extract<RouteProgress, { status: "matched" }>, targetSequence: number): number {
  return targetSequence - progress.sequence;
}

/** 依 routeId 分組，給伺服器一次建好索引、每個請求只取需要的路線。 */
export function groupStopsByRoute(stops: readonly GarbageStop[]): Map<string, GarbageStop[]> {
  const byRoute = new Map<string, GarbageStop[]>();
  for (const stop of stops) {
    const list = byRoute.get(stop.routeId);
    if (list) list.push(stop);
    else byRoute.set(stop.routeId, [stop]);
  }
  return byRoute;
}
