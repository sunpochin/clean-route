// 檔案用途：把新北原始資料列轉成 domain 的 GarbageStop／GarbageTruck；格式不符的列回傳 null。
// 所在層：src/providers/new-taipei；純函式，方便以 fixture 做單元測試。
// 主要關聯：raw.ts（原始欄位）、src/domain/types.ts（輸出型別）、tests/unit/new-taipei-normalize.test.ts。

import { isInTaiwan } from "@/domain/geo";
import { formatTimeOfDay, parseTaipeiLocalDateTime, parseTimeOfDay } from "@/domain/time";
import type { GarbageStop, GarbageTruck, ServiceType } from "@/domain/types";
import { DAY_KEYS, type RawStop, type RawTruck } from "./raw";

const SERVICE_KEYS: readonly [ServiceType, "garbage" | "recycling" | "foodscraps"][] = [
  ["garbage", "garbage"],
  ["recycling", "recycling"],
  ["foodScraps", "foodscraps"],
];

/**
 * 上游 memo 大多是清潔隊的內部維護紀錄（「經緯度修正」「站序修正」「2025通報」…），
 * 對使用者沒有意義還會造成困惑；只有像「國定假日、連假隔天會加收」這種才該顯示。
 * 用排除清單而非允許清單：未知的新備註寧可顯示出來，也不要默默藏掉可能重要的資訊。
 */
const INTERNAL_MEMO_PATTERN = /修正|調整|通報|^[-\s]*$/;

function parseCoordinate(latText?: string, lngText?: string) {
  const lat = Number(latText);
  const lng = Number(lngText);
  // Number("") 是 0 而不是 NaN，空字串必須靠 isInTaiwan 擋下來。
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const point = { lat, lng };
  return isInTaiwan(point) ? point : null;
}

export function normalizeStop(raw: RawStop): GarbageStop | null {
  const location = parseCoordinate(raw.latitude, raw.longitude);
  const minute = parseTimeOfDay(raw.time ?? "");
  const sequence = Number(raw.rank);
  if (!location || minute === null || !raw.lineid || !Number.isInteger(sequence)) return null;

  const weeklyServices = DAY_KEYS.map((day) =>
    SERVICE_KEYS.filter(([, rawKey]) => raw[`${rawKey}${day}`] === "Y").map(([service]) => service),
  );
  // 一週七天都不收的點無法推算下一班，對使用者也沒有用。
  if (weeklyServices.every((services) => services.length === 0)) return null;

  const memo = raw.memo?.trim();
  return {
    id: `new-taipei:${raw.lineid}:${sequence}`,
    city: "new-taipei",
    district: raw.city?.trim() ?? "",
    village: raw.village?.trim() ?? "",
    name: raw.name?.trim() ?? "",
    routeId: raw.lineid,
    routeName: raw.linename?.trim() ?? "",
    sequence,
    location,
    timeOfDay: formatTimeOfDay(minute),
    weeklyServices,
    ...(memo && !INTERNAL_MEMO_PATTERN.test(memo) ? { note: memo } : {}),
  };
}

export function normalizeTruck(raw: RawTruck): GarbageTruck | null {
  const location = parseCoordinate(raw.latitude, raw.longitude);
  const recordedAt = parseTaipeiLocalDateTime(raw.time ?? "");
  // 沒有可信時間戳的位置無法判斷是否過期（AGENTS.md § 3.4），直接丟棄。
  if (!location || !recordedAt || !raw.lineid || !raw.car) return null;
  return {
    id: raw.car,
    city: "new-taipei",
    routeId: raw.lineid,
    location,
    recordedAt,
    ...(raw.location ? { address: raw.location } : {}),
    ...(raw.cityname ? { district: raw.cityname } : {}),
  };
}
