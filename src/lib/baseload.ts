/**
 * Shared baseload / peakload helpers.
 *
 * Methodology — aligned with SEEPEX day-ahead convention:
 *  - Hourly DA prices are grouped by Europe/Belgrade calendar day (CET/CEST),
 *    NOT UTC, so DST shifts don't split days incorrectly.
 *  - A day's "baseload" = simple arithmetic mean of its 24 hourly prices.
 *  - Incomplete days (DST 23h/25h, missing hours, today-so-far) are EXCLUDED
 *    by default to avoid misleading averages.
 *  - A period "baseload" = simple mean of daily baseloads over complete days
 *    in the range. This matches exchange-published period averages and
 *    avoids over-weighting days that happen to have more data.
 *  - "Peakload" = mean of hours Mon–Fri 08:00–20:00 local Belgrade time.
 */

export type HourlyPrice = { ts: Date; price: number };

const BELGRADE_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Belgrade",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const BELGRADE_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Belgrade",
  hour: "2-digit",
  hour12: false,
  weekday: "short",
});

export function belgradeDayKey(d: Date): string {
  return BELGRADE_DAY.format(d);
}

export function dateFromBelgradeKey(key: string): Date {
  const [y, m, day] = key.split("-").map(Number);
  return new Date(y, m - 1, day);
}

function belgradeHour(d: Date): number {
  // en-GB hour formatter returns "23" or "00"
  return Number(BELGRADE_PARTS.formatToParts(d).find((p) => p.type === "hour")?.value ?? d.getUTCHours());
}

function belgradeWeekday(d: Date): string {
  return BELGRADE_PARTS.formatToParts(d).find((p) => p.type === "weekday")?.value ?? "";
}

export function isBelgradePeakHour(d: Date): boolean {
  const h = belgradeHour(d);
  const wd = belgradeWeekday(d); // Mon, Tue, …, Sat, Sun
  if (wd === "Sat" || wd === "Sun") return false;
  return h >= 8 && h < 20;
}

export type DayBucket = {
  key: string;
  date: Date;
  hours: HourlyPrice[];
  complete: boolean; // exactly 24 distinct hour buckets
  baseload: number;
  peakload: number | null;
};

export function bucketByBelgradeDay(points: HourlyPrice[]): DayBucket[] {
  // Dedupe duplicate hours: same ISO ts wins last.
  const dedup = new Map<string, HourlyPrice>();
  for (const p of points) dedup.set(p.ts.toISOString(), p);
  const cleaned = Array.from(dedup.values()).sort((a, b) => +a.ts - +b.ts);

  const m = new Map<string, HourlyPrice[]>();
  for (const p of cleaned) {
    const k = belgradeDayKey(p.ts);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(p);
  }
  return Array.from(m.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, hrs]) => {
      // count unique local hours-of-day (handles DST 23h/25h days as incomplete)
      const localHours = new Set(hrs.map((p) => belgradeHour(p.ts)));
      const peak = hrs.filter((p) => isBelgradePeakHour(p.ts));
      const baseload = hrs.reduce((a, b) => a + b.price, 0) / hrs.length;
      const peakload = peak.length
        ? peak.reduce((a, b) => a + b.price, 0) / peak.length
        : null;
      return {
        key,
        date: dateFromBelgradeKey(key),
        hours: hrs,
        complete: localHours.size === 24,
        baseload,
        peakload,
      };
    });
}

export type PeriodAggregate = {
  baseload: number; // mean of daily baseloads over completeDays in range
  peakload: number | null;
  hoursCount: number;
  daysCount: number;
  completeDaysCount: number;
  firstDay?: string;
  lastDay?: string;
  negHours: number;
  lowHours: number; // < 10 EUR/MWh
  highHours: number; // > 150 EUR/MWh
  minHour: number;
  maxHour: number;
  sd: number;
};

export function aggregatePeriod(buckets: DayBucket[], fromKey?: string, toKey?: string): PeriodAggregate {
  const inRange = buckets.filter(
    (b) => (!fromKey || b.key >= fromKey) && (!toKey || b.key <= toKey),
  );
  const completeOnly = inRange.filter((b) => b.complete);
  const allHours = inRange.flatMap((b) => b.hours);
  const prices = allHours.map((p) => p.price);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const baseload = mean(completeOnly.map((d) => d.baseload));
  const peakloadDays = completeOnly.map((d) => d.peakload).filter((v): v is number => v != null);
  const peakload = peakloadDays.length ? mean(peakloadDays) : null;
  const variance = prices.length
    ? prices.reduce((a, b) => a + (b - mean(prices)) ** 2, 0) / prices.length
    : 0;
  return {
    baseload,
    peakload,
    hoursCount: allHours.length,
    daysCount: inRange.length,
    completeDaysCount: completeOnly.length,
    firstDay: inRange[0]?.key,
    lastDay: inRange[inRange.length - 1]?.key,
    negHours: prices.filter((p) => p < 0).length,
    lowHours: prices.filter((p) => p < 10).length,
    highHours: prices.filter((p) => p > 150).length,
    minHour: prices.length ? Math.min(...prices) : NaN,
    maxHour: prices.length ? Math.max(...prices) : NaN,
    sd: Math.sqrt(variance),
  };
}
