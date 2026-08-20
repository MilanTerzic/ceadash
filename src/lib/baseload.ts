/**
 * Shared baseload / peakload helpers.
 *
 * Methodology — aligned with SEEPEX day-ahead convention:
 *  - Hourly DA prices are grouped by Europe/Belgrade calendar day (CET/CEST),
 *    NOT UTC, so DST shifts don't split days incorrectly.
 *  - A day is complete only when every expected hourly delivery interval is
 *    present. Europe/Belgrade delivery days contain 23, 24 or 25 hourly
 *    intervals depending on DST.
 *  - Period baseload = arithmetic mean of hourly prices on complete days only.
 *  - Volatility (σ) uses the same complete-day hourly sample as baseload.
 *  - Negative-hour counts and min/max include all observed hours in the range.
 *  - Peakload = mean of hours Mon–Fri 08:00–20:00 local Belgrade time on
 *    complete days only.
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
  return Number(
    BELGRADE_PARTS.formatToParts(d).find((p) => p.type === "hour")?.value ?? d.getUTCHours(),
  );
}

function belgradeWeekday(d: Date): string {
  return BELGRADE_PARTS.formatToParts(d).find((p) => p.type === "weekday")?.value ?? "";
}

export function isBelgradePeakHour(d: Date): boolean {
  const h = belgradeHour(d);
  const wd = belgradeWeekday(d);
  if (wd === "Sat" || wd === "Sun") return false;
  return h >= 8 && h < 20;
}

export type DayBucket = {
  key: string;
  date: Date;
  hours: HourlyPrice[];
  complete: boolean;
  expectedHours: number;
  baseload: number;
  peakload: number | null;
};

const HOUR_MS = 60 * 60 * 1000;

/**
 * Return the UTC instant corresponding to local midnight in Europe/Belgrade.
 * Serbia currently uses UTC+1 in winter and UTC+2 in summer. Trying these
 * offsets keeps this helper dependency-free while still deriving the boundary
 * from Intl rather than assuming which offset applies on a given date.
 */
function belgradeMidnightUtc(key: string): number {
  const [year, month, day] = key.split("-").map(Number);
  const nominalUtc = Date.UTC(year, month - 1, day);
  for (const offsetHours of [1, 2]) {
    const candidate = nominalUtc - offsetHours * HOUR_MS;
    if (belgradeDayKey(new Date(candidate)) === key && belgradeHour(new Date(candidate)) === 0) {
      return candidate;
    }
  }
  throw new Error(`Unable to resolve Europe/Belgrade midnight for ${key}`);
}

function nextDayKey(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export function expectedBelgradeDeliveryHours(key: string): number {
  const start = belgradeMidnightUtc(key);
  const end = belgradeMidnightUtc(nextDayKey(key));
  return Math.round((end - start) / HOUR_MS);
}

function isCompleteDeliveryDay(key: string, hours: HourlyPrice[]): boolean {
  const start = belgradeMidnightUtc(key);
  const expectedHours = expectedBelgradeDeliveryHours(key);
  const expected = new Set(
    Array.from({ length: expectedHours }, (_, index) =>
      new Date(start + index * HOUR_MS).toISOString(),
    ),
  );
  const observed = new Set(hours.map((point) => point.ts.toISOString()));
  return observed.size === expected.size && Array.from(expected).every((stamp) => observed.has(stamp));
}

export function bucketByBelgradeDay(points: HourlyPrice[]): DayBucket[] {
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
      const peak = hrs.filter((p) => isBelgradePeakHour(p.ts));
      const baseload = hrs.reduce((a, b) => a + b.price, 0) / hrs.length;
      const peakload = peak.length ? peak.reduce((a, b) => a + b.price, 0) / peak.length : null;
      return {
        key,
        date: dateFromBelgradeKey(key),
        hours: hrs,
        complete: isCompleteDeliveryDay(key, hrs),
        expectedHours: expectedBelgradeDeliveryHours(key),
        baseload,
        peakload,
      };
    });
}

export type PeriodAggregate = {
  baseload: number;
  peakload: number | null;
  hoursCount: number;
  daysCount: number;
  completeDaysCount: number;
  firstDay?: string;
  lastDay?: string;
  negHours: number;
  lowHours: number;
  highHours: number;
  minHour: number;
  maxHour: number;
  sd: number;
};

export function aggregatePeriod(
  buckets: DayBucket[],
  fromKey?: string,
  toKey?: string,
): PeriodAggregate {
  const inRange = buckets.filter(
    (b) => (!fromKey || b.key >= fromKey) && (!toKey || b.key <= toKey),
  );
  const completeOnly = inRange.filter((b) => b.complete);
  const allHours = inRange.flatMap((b) => b.hours);
  const prices = allHours.map((p) => p.price);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const completeHours = completeOnly.flatMap((d) => d.hours).map((p) => p.price);
  const baseload = mean(completeHours);
  const peakHours = completeOnly
    .flatMap((d) => d.hours)
    .filter((p) => isBelgradePeakHour(p.ts))
    .map((p) => p.price);
  const peakload = peakHours.length ? mean(peakHours) : null;
  const completeMean = mean(completeHours);
  const variance = completeHours.length
    ? completeHours.reduce((a, b) => a + (b - completeMean) ** 2, 0) / completeHours.length
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
