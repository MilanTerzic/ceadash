import { MARKET_PRESETS, PRICE_MARKETS, type PriceMarketCode } from "./price-markets";
import {
  completenessForSeries,
  expectedIntervalsForBelgradeDay,
  type PricePoint,
} from "./trading-calculations";

export interface PriceMarketStats {
  market: PriceMarketCode;
  baseloadAverage: number | null;
  peakAverage: number | null;
  offPeakAverage: number | null;
  minimum: number | null;
  maximum: number | null;
  volatility: number | null;
  negativePriceIntervals: number;
  averageSpreadVsSerbia: number | null;
  minSpreadVsSerbia: number | null;
  maxSpreadVsSerbia: number | null;
  pctAboveSerbia: number | null;
  pctBelowSerbia: number | null;
  correlationWithSerbia: number | null;
  receivedIntervals: number;
  expectedIntervals: number;
  completenessPct: number;
  status: "Current" | "Partial" | "Unavailable";
  reason?: string;
}

export interface PricePeriodStats {
  baseloadAverage: number | null;
  dailyBaseloadAverage: number | null;
  profileAverage: number | null;
  peakAverage: number | null;
  offPeakAverage: number | null;
  minimum: number | null;
  maximum: number | null;
  volatility: number | null;
  negativePriceIntervals: number;
  receivedIntervals: number;
  expectedIntervals: number;
  completenessPct: number;
  daysWithData: number;
  completeDays: number;
  incompleteDays: string[];
  hourlyProfile: Array<number | null>;
}

export function normalizeToHourlyPrices(points: PricePoint[]): PricePoint[] {
  const acc = new Map<string, { sum: number; count: number }>();
  for (const point of points) {
    if (!Number.isFinite(point.price)) continue;
    const hour = new Date(point.ts);
    if (Number.isNaN(hour.getTime())) continue;
    hour.setUTCMinutes(0, 0, 0);
    const key = hour.toISOString();
    const next = acc.get(key) ?? { sum: 0, count: 0 };
    next.sum += point.price;
    next.count += 1;
    acc.set(key, next);
  }
  return [...acc.entries()]
    .map(([ts, value]) => ({ ts, price: value.sum / value.count, durationMinutes: 60 }))
    .sort((a, b) => a.ts.localeCompare(b.ts));
}

export function calculatePricePeriodStats(points: PricePoint[], days: string[]): PricePeriodStats {
  const daySet = new Set(days);
  const hourly = normalizeToHourlyPrices(points).filter((point) =>
    daySet.has(belgradeDay(point.ts)),
  );
  const values = hourly.map((point) => point.price).filter((value) => Number.isFinite(value));
  const peakValues: number[] = [];
  const offPeakValues: number[] = [];
  const profileSums = new Array<number>(24).fill(0);
  const profileCounts = new Array<number>(24).fill(0);
  const byDay = new Map<string, number[]>();

  for (const point of hourly) {
    const day = belgradeDay(point.ts);
    const dayValues = byDay.get(day) ?? [];
    dayValues.push(point.price);
    byDay.set(day, dayValues);

    const hour = belgradeHour(point.ts);
    if (hour >= 0 && hour < 24) {
      profileSums[hour] += point.price;
      profileCounts[hour] += 1;
    }
    const weekday = belgradeWeekday(point.ts);
    const isPeak = weekday !== "Sat" && weekday !== "Sun" && hour >= 8 && hour < 20;
    (isPeak ? peakValues : offPeakValues).push(point.price);
  }

  const dailyRows = [...byDay.entries()].map(([day, dayValues]) => {
    const expected = expectedIntervalsForBelgradeDay(day, 60);
    return {
      day,
      expected,
      received: dayValues.length,
      average: mean(dayValues),
    };
  });
  const completeDays = dailyRows.filter((day) => day.received >= day.expected);
  const expectedIntervals = days.reduce(
    (sum, day) => sum + expectedIntervalsForBelgradeDay(day, 60),
    0,
  );
  const hourlyProfile = profileSums.map((sum, index) =>
    profileCounts[index] ? sum / profileCounts[index] : null,
  );
  const finiteProfile = hourlyProfile.filter((value): value is number => value != null);
  const baseloadAverage = mean(values);

  return {
    baseloadAverage,
    dailyBaseloadAverage: mean(dailyRows.map((day) => day.average).filter(isFiniteNumber)),
    profileAverage: mean(finiteProfile),
    peakAverage: mean(peakValues),
    offPeakAverage: mean(offPeakValues),
    minimum: values.length ? Math.min(...values) : null,
    maximum: values.length ? Math.max(...values) : null,
    volatility:
      baseloadAverage != null && values.length > 1
        ? Math.sqrt(
            values.reduce((sum, value) => sum + (value - baseloadAverage) ** 2, 0) / values.length,
          )
        : null,
    negativePriceIntervals: values.filter((value) => value < 0).length,
    receivedIntervals: values.length,
    expectedIntervals,
    completenessPct: expectedIntervals ? (values.length / expectedIntervals) * 100 : 0,
    daysWithData: dailyRows.length,
    completeDays: completeDays.length,
    incompleteDays: dailyRows
      .filter((day) => day.received < day.expected)
      .map((day) => `${day.day} (${day.received}/${day.expected})`),
    hourlyProfile,
  };
}

export function matchedSpreadPoints(
  marketPoints: PricePoint[],
  serbiaPoints: PricePoint[],
): Array<{ ts: string; spread: number; marketPrice: number; serbiaPrice: number }> {
  const serbiaByTs = new Map(serbiaPoints.map((point) => [point.ts, point.price]));
  return marketPoints.flatMap((point) => {
    const serbiaPrice = serbiaByTs.get(point.ts);
    if (serbiaPrice == null || !Number.isFinite(serbiaPrice) || !Number.isFinite(point.price)) {
      return [];
    }
    return [
      {
        ts: point.ts,
        spread: point.price - serbiaPrice,
        marketPrice: point.price,
        serbiaPrice,
      },
    ];
  });
}

export function resolveMarketPreset(preset: keyof typeof MARKET_PRESETS): PriceMarketCode[] {
  return MARKET_PRESETS[preset].filter((code) => code in PRICE_MARKETS);
}

export function marketAvailabilityStatus(
  points: PricePoint[],
  days: string[],
  reason?: string,
): Pick<
  PriceMarketStats,
  "status" | "receivedIntervals" | "expectedIntervals" | "completenessPct" | "reason"
> {
  const completeness = completenessForSeries(points, days);
  if (!points.length) {
    return {
      status: "Unavailable",
      receivedIntervals: 0,
      expectedIntervals: completeness.expectedIntervals,
      completenessPct: 0,
      reason: reason ?? "No ENTSO-E data",
    };
  }
  return {
    status: completeness.completenessPct >= 98 ? "Current" : "Partial",
    receivedIntervals: completeness.receivedIntervals,
    expectedIntervals: completeness.expectedIntervals,
    completenessPct: completeness.completenessPct,
    reason,
  };
}

export function calculatePriceMarketStats({
  market,
  points,
  serbiaPoints,
  days,
  reason,
}: {
  market: PriceMarketCode;
  points: PricePoint[];
  serbiaPoints: PricePoint[];
  days: string[];
  reason?: string;
}): PriceMarketStats {
  const periodStats = calculatePricePeriodStats(points, days);
  const values = normalizeToHourlyPrices(points)
    .filter((point) => days.includes(belgradeDay(point.ts)))
    .map((point) => point.price);
  const spreads = market === "RS" ? [] : matchedSpreadPoints(points, serbiaPoints);
  const spreadValues = spreads.map((point) => point.spread);
  return {
    market,
    baseloadAverage: periodStats.baseloadAverage,
    peakAverage: periodStats.peakAverage,
    offPeakAverage: periodStats.offPeakAverage,
    minimum: periodStats.minimum,
    maximum: periodStats.maximum,
    volatility: periodStats.volatility,
    negativePriceIntervals: periodStats.negativePriceIntervals,
    averageSpreadVsSerbia: mean(spreadValues),
    minSpreadVsSerbia: spreadValues.length ? Math.min(...spreadValues) : null,
    maxSpreadVsSerbia: spreadValues.length ? Math.max(...spreadValues) : null,
    pctAboveSerbia: spreadValues.length
      ? (spreadValues.filter((spread) => spread > 0).length / spreadValues.length) * 100
      : null,
    pctBelowSerbia: spreadValues.length
      ? (spreadValues.filter((spread) => spread < 0).length / spreadValues.length) * 100
      : null,
    correlationWithSerbia:
      spreads.length >= 3
        ? correlation(
            spreads.map((point) => point.marketPrice),
            spreads.map((point) => point.serbiaPrice),
          )
        : null,
    status:
      periodStats.receivedIntervals === 0
        ? "Unavailable"
        : periodStats.completenessPct >= 98
          ? "Current"
          : "Partial",
    receivedIntervals: periodStats.receivedIntervals,
    expectedIntervals: periodStats.expectedIntervals,
    completenessPct: periodStats.completenessPct,
    reason,
  };
}

export function expectedIntervalsForDays(days: string[], stepMinutes = 60): number {
  return days.reduce((sum, day) => sum + expectedIntervalsForBelgradeDay(day, stepMinutes), 0);
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function isFiniteNumber(value: number | null): value is number {
  return value != null && Number.isFinite(value);
}

function belgradeDay(ts: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ts));
}

function correlation(a: number[], b: number[]) {
  if (a.length !== b.length || a.length < 3) return null;
  const ma = mean(a);
  const mb = mean(b);
  if (ma == null || mb == null) return null;
  const numerator = a.reduce((sum, value, index) => sum + (value - ma) * (b[index] - mb), 0);
  const da = Math.sqrt(a.reduce((sum, value) => sum + (value - ma) ** 2, 0));
  const db = Math.sqrt(b.reduce((sum, value) => sum + (value - mb) ** 2, 0));
  return da && db ? numerator / (da * db) : null;
}

function belgradeHour(ts: string) {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Belgrade",
      hour: "2-digit",
      hour12: false,
    }).format(new Date(ts)),
  );
}

function belgradeWeekday(ts: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Belgrade",
    weekday: "short",
  }).format(new Date(ts));
}
