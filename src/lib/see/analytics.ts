// Pure regional analytics: hourly series, price statistics, spreads, flows.
// No I/O and no framework imports, so everything here is unit-tested.
//
// Conventions
// - A Series is hourly and keyed by UTC epoch hour (ms / 3_600_000), ascending.
// - Delivery days, peak hours and hour-of-day use market time (CET/CEST).
// - A missing hour is absent from the series. Nothing here turns a gap into a number.

export interface Series {
  t: number[];
  v: number[];
}

export interface IntervalValue {
  ts: string;
  value: number;
  durationMinutes?: number;
}

export const EMPTY_SERIES: Series = { t: [], v: [] };
const HOUR_MS = 3_600_000;

/**
 * Collapses interval points (15, 30 or 60 minutes) to hourly means. An hour is kept only
 * when its intervals are aligned to the resolution and cover the full 60 minutes.
 */
export function toHourlySeries(points: IntervalValue[]): Series {
  const acc = new Map<number, { sum: number; minutes: number }>();
  for (const point of points) {
    if (!Number.isFinite(point.value)) continue;
    const ms = Date.parse(point.ts);
    if (!Number.isFinite(ms)) continue;
    const duration =
      point.durationMinutes && point.durationMinutes > 0 ? point.durationMinutes : 60;
    if (duration > 60) continue;
    const minuteOfHour = Math.round((ms % HOUR_MS) / 60_000);
    if (minuteOfHour % duration !== 0) continue;
    const hour = Math.floor(ms / HOUR_MS);
    const bucket = acc.get(hour) ?? { sum: 0, minutes: 0 };
    bucket.sum += point.value * duration;
    bucket.minutes += duration;
    acc.set(hour, bucket);
  }
  const hours = [...acc.keys()].sort((a, b) => a - b);
  const out: Series = { t: [], v: [] };
  for (const hour of hours) {
    const bucket = acc.get(hour)!;
    if (bucket.minutes !== 60) continue;
    out.t.push(hour);
    out.v.push(bucket.sum / 60);
  }
  return out;
}

export function seriesMap(series: Series): Map<number, number> {
  const map = new Map<number, number>();
  for (let i = 0; i < series.t.length; i++) map.set(series.t[i], series.v[i]);
  return map;
}

export function sliceSeries(series: Series, fromHour: number, toHourExclusive: number): Series {
  const out: Series = { t: [], v: [] };
  for (let i = 0; i < series.t.length; i++) {
    if (series.t[i] >= fromHour && series.t[i] < toHourExclusive) {
      out.t.push(series.t[i]);
      out.v.push(series.v[i]);
    }
  }
  return out;
}

// --- Market time -------------------------------------------------------------

export interface MarketTime {
  day: string;
  hour: number;
  weekend: boolean;
}

const MARKET_TZ = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Belgrade",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});
const marketTimeCache = new Map<number, MarketTime>();

/** Market-time (CET/CEST) calendar day, hour and weekend flag of a UTC epoch hour. */
export function marketTime(epochHour: number): MarketTime {
  const cached = marketTimeCache.get(epochHour);
  if (cached) return cached;
  const parts = MARKET_TZ.formatToParts(new Date(epochHour * HOUR_MS));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = get("weekday");
  const value: MarketTime = {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    weekend: weekday === "Sat" || weekday === "Sun",
  };
  if (marketTimeCache.size > 50_000) marketTimeCache.clear();
  marketTimeCache.set(epochHour, value);
  return value;
}

/** Peak = Monday to Friday, 08:00-20:00 market time. Public holidays are not excluded. */
export function isPeak(epochHour: number): boolean {
  const { hour, weekend } = marketTime(epochHour);
  return !weekend && hour >= 8 && hour < 20;
}

/** Hours in a market-time delivery day: 23 or 25 on DST change days, otherwise 24. */
export function deliveryHours(dayISO: string): number {
  const offset = (iso: string) => {
    const part =
      new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Belgrade", timeZoneName: "shortOffset" })
        .formatToParts(new Date(`${iso}T00:00:00Z`))
        .find((p) => p.type === "timeZoneName")?.value ?? "GMT+1";
    const match = /([+-]?\d+)/.exec(part);
    return match ? parseInt(match[1], 10) : 1;
  };
  const next = new Date(`${dayISO}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const nextISO = next.toISOString().slice(0, 10);
  // Offsets are sampled at UTC midnight, i.e. 01:00 or 02:00 local: before the 02:00/03:00 switch.
  return 24 + offset(dayISO) - offset(nextISO);
}

// --- Basic statistics --------------------------------------------------------

export function mean(values: number[]): number | null {
  if (!values.length) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

export function stdev(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values)!;
  let acc = 0;
  for (const value of values) acc += (value - m) ** 2;
  return Math.sqrt(acc / (values.length - 1));
}

/** Linear-interpolated quantile, q in [0, 1]. */
export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (pos - lower);
}

/** Pearson correlation on hours present in both series; null below 3 matched hours. */
export function correlation(a: Series, b: Series): number | null {
  const mapB = seriesMap(b);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < a.t.length; i++) {
    const other = mapB.get(a.t[i]);
    if (other === undefined) continue;
    xs.push(a.v[i]);
    ys.push(other);
  }
  if (xs.length < 3) return null;
  const mx = mean(xs)!;
  const my = mean(ys)!;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

// --- Prices ------------------------------------------------------------------

export interface PriceStats {
  hours: number;
  base: number | null;
  peak: number | null;
  offPeak: number | null;
  min: number | null;
  max: number | null;
  /** Standard deviation of hourly prices, EUR/MWh. */
  volatility: number | null;
  negativeHours: number;
  /** Mean of the daily max-min range over complete delivery days. */
  dailySpread: number | null;
  last: { t: number; v: number } | null;
}

export function priceStats(series: Series): PriceStats {
  const peak: number[] = [];
  const offPeak: number[] = [];
  let negativeHours = 0;
  for (let i = 0; i < series.t.length; i++) {
    (isPeak(series.t[i]) ? peak : offPeak).push(series.v[i]);
    if (series.v[i] < 0) negativeHours += 1;
  }
  const days = dailyStats(series).filter((day) => day.complete);
  const n = series.t.length;
  return {
    hours: n,
    base: mean(series.v),
    peak: mean(peak),
    offPeak: mean(offPeak),
    min: n ? Math.min(...series.v) : null,
    max: n ? Math.max(...series.v) : null,
    volatility: stdev(series.v),
    negativeHours,
    dailySpread: mean(days.map((day) => day.max - day.min)),
    last: n ? { t: series.t[n - 1], v: series.v[n - 1] } : null,
  };
}

export interface DayStats {
  day: string;
  hours: number;
  expected: number;
  complete: boolean;
  base: number;
  peak: number | null;
  min: number;
  max: number;
  negativeHours: number;
}

export function dailyStats(series: Series): DayStats[] {
  const byDay = new Map<string, { values: number[]; peak: number[] }>();
  for (let i = 0; i < series.t.length; i++) {
    const { day } = marketTime(series.t[i]);
    const bucket = byDay.get(day) ?? { values: [], peak: [] };
    bucket.values.push(series.v[i]);
    if (isPeak(series.t[i])) bucket.peak.push(series.v[i]);
    byDay.set(day, bucket);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, bucket]) => {
      const expected = deliveryHours(day);
      return {
        day,
        hours: bucket.values.length,
        expected,
        complete: bucket.values.length >= expected,
        base: mean(bucket.values)!,
        peak: mean(bucket.peak),
        min: Math.min(...bucket.values),
        max: Math.max(...bucket.values),
        negativeHours: bucket.values.filter((value) => value < 0).length,
      };
    });
}

/** Mean value per market-time hour of day (0-23); null where no observation exists. */
export function hourProfile(series: Series): Array<number | null> {
  const sums = new Array<number>(24).fill(0);
  const counts = new Array<number>(24).fill(0);
  for (let i = 0; i < series.t.length; i++) {
    const { hour } = marketTime(series.t[i]);
    sums[hour] += series.v[i];
    counts[hour] += 1;
  }
  return sums.map((sum, hour) => (counts[hour] ? sum / counts[hour] : null));
}

/** Values sorted high to low with the share of hours at or above each value. */
export function durationCurve(series: Series): Array<{ pct: number; value: number }> {
  const sorted = [...series.v].sort((a, b) => b - a);
  const n = sorted.length;
  return sorted.map((value, index) => ({ pct: n > 1 ? (index / (n - 1)) * 100 : 0, value }));
}

// --- Spreads -----------------------------------------------------------------

/** to - from on hours where both prices exist. Positive: power is dearer in `to`. */
export function spreadSeries(from: Series, to: Series): Series {
  const mapTo = seriesMap(to);
  const out: Series = { t: [], v: [] };
  for (let i = 0; i < from.t.length; i++) {
    const other = mapTo.get(from.t[i]);
    if (other === undefined) continue;
    out.t.push(from.t[i]);
    out.v.push(other - from.v[i]);
  }
  return out;
}

export interface SpreadStats {
  hours: number;
  mean: number | null;
  median: number | null;
  p10: number | null;
  p90: number | null;
  /** Mean of max(spread, 0): the value of capacity that is only used when in the money. */
  meanPositive: number | null;
  /** Share of hours with spread > 0, in [0, 1]. */
  positiveShare: number | null;
  /** Share of hours with |spread| above the split threshold, in [0, 1]. */
  splitShare: number | null;
}

/** Price difference below which two zones are treated as converged, EUR/MWh. */
export const PRICE_SPLIT_THRESHOLD = 0.5;

export function spreadStats(spread: Series, splitThreshold = PRICE_SPLIT_THRESHOLD): SpreadStats {
  const n = spread.v.length;
  if (!n) {
    return {
      hours: 0,
      mean: null,
      median: null,
      p10: null,
      p90: null,
      meanPositive: null,
      positiveShare: null,
      splitShare: null,
    };
  }
  let positive = 0;
  let positiveSum = 0;
  let split = 0;
  for (const value of spread.v) {
    if (value > 0) {
      positive += 1;
      positiveSum += value;
    }
    if (Math.abs(value) > splitThreshold) split += 1;
  }
  return {
    hours: n,
    mean: mean(spread.v),
    median: quantile(spread.v, 0.5),
    p10: quantile(spread.v, 0.1),
    p90: quantile(spread.v, 0.9),
    meanPositive: positiveSum / n,
    positiveShare: positive / n,
    splitShare: split / n,
  };
}

// --- Flows -------------------------------------------------------------------

/**
 * Net flow a -> b (positive) from the two directional series. An hour is kept only when
 * BOTH directions were reported; a direction that is missing is not treated as zero.
 */
export function netFlow(aToB: Series, bToA: Series): Series {
  const reverse = seriesMap(bToA);
  const out: Series = { t: [], v: [] };
  for (let i = 0; i < aToB.t.length; i++) {
    const back = reverse.get(aToB.t[i]);
    if (back === undefined) continue;
    out.t.push(aToB.t[i]);
    out.v.push(aToB.v[i] - back);
  }
  return out;
}

export interface FlowStats {
  hours: number;
  /** Mean net flow a -> b, MW. Negative means the average direction is b -> a. */
  meanNet: number | null;
  meanAbs: number | null;
  maxAtoB: number | null;
  maxBtoA: number | null;
  /** Share of hours flowing a -> b, in [0, 1]. */
  shareAtoB: number | null;
  /** Net energy a -> b over the period, MWh (hourly series, so MW x 1 h). */
  energyMWh: number | null;
}

export function flowStats(net: Series): FlowStats {
  const n = net.v.length;
  if (!n) {
    return {
      hours: 0,
      meanNet: null,
      meanAbs: null,
      maxAtoB: null,
      maxBtoA: null,
      shareAtoB: null,
      energyMWh: null,
    };
  }
  let sum = 0;
  let abs = 0;
  let forward = 0;
  let maxF = 0;
  let maxB = 0;
  for (const value of net.v) {
    sum += value;
    abs += Math.abs(value);
    if (value > 0) forward += 1;
    if (value > maxF) maxF = value;
    if (-value > maxB) maxB = -value;
  }
  return {
    hours: n,
    meanNet: sum / n,
    meanAbs: abs / n,
    maxAtoB: maxF,
    maxBtoA: maxB,
    shareAtoB: forward / n,
    energyMWh: sum,
  };
}

/**
 * Hourly utilisation of transfer capacity: |net flow| divided by the capacity published
 * for the direction the power is moving. Hours without a positive capacity are skipped.
 */
export function utilisation(net: Series, ntcAtoB: Series, ntcBtoA: Series): Series {
  const forward = seriesMap(ntcAtoB);
  const backward = seriesMap(ntcBtoA);
  const out: Series = { t: [], v: [] };
  for (let i = 0; i < net.t.length; i++) {
    const capacity = net.v[i] >= 0 ? forward.get(net.t[i]) : backward.get(net.t[i]);
    if (capacity === undefined || !(capacity > 0)) continue;
    out.t.push(net.t[i]);
    out.v.push(Math.abs(net.v[i]) / capacity);
  }
  return out;
}

export interface FlowSpreadAlignment {
  hours: number;
  /** Share of hours where power flows towards the dearer zone, in [0, 1]. */
  withSpread: number | null;
  /** Share of hours where power flows towards the cheaper zone, in [0, 1]. */
  againstSpread: number | null;
}

/**
 * Compares the direction of the net flow a -> b with the sign of the spread (b - a).
 * Hours with a converged price or no flow are counted in `hours` but in neither share.
 */
export function flowSpreadAlignment(
  net: Series,
  spreadAtoB: Series,
  splitThreshold = PRICE_SPLIT_THRESHOLD,
): FlowSpreadAlignment {
  const spread = seriesMap(spreadAtoB);
  let hours = 0;
  let withSpread = 0;
  let against = 0;
  for (let i = 0; i < net.t.length; i++) {
    const s = spread.get(net.t[i]);
    if (s === undefined) continue;
    hours += 1;
    if (Math.abs(s) <= splitThreshold || net.v[i] === 0) continue;
    if (Math.sign(net.v[i]) === Math.sign(s)) withSpread += 1;
    else against += 1;
  }
  return {
    hours,
    withSpread: hours ? withSpread / hours : null,
    againstSpread: hours ? against / hours : null,
  };
}

// --- Directional route economics ---------------------------------------------

export interface RouteEconomics {
  hours: number;
  /** Mean of (destination - source), EUR/MWh. */
  meanSpread: number | null;
  /** Mean of max(destination - source, 0): capacity used only in profitable hours. */
  meanPositiveSpread: number | null;
  positiveShare: number | null;
  /** Capacity price per MWh of transfer right, when an auction price was observed. */
  capacityPrice: number | null;
  /** meanPositiveSpread - capacityPrice - otherCosts; null without a capacity price. */
  illustrativeNet: number | null;
}

/**
 * Indicative spread = destination price - source price.
 * Illustrative net spread = mean positive spread - capacity cost - other modelled costs.
 * Excludes losses, balancing exposure, nomination deadlines, fees not passed in
 * `otherCosts`, and any mismatch between auction product and delivery hours.
 */
export function routeEconomics(
  source: Series,
  destination: Series,
  capacityPrice: number | null,
  otherCosts = 0,
): RouteEconomics {
  const stats = spreadStats(spreadSeries(source, destination));
  const hasCapacity = capacityPrice !== null && Number.isFinite(capacityPrice);
  return {
    hours: stats.hours,
    meanSpread: stats.mean,
    meanPositiveSpread: stats.meanPositive,
    positiveShare: stats.positiveShare,
    capacityPrice: hasCapacity ? capacityPrice : null,
    illustrativeNet:
      hasCapacity && stats.meanPositive !== null
        ? stats.meanPositive - capacityPrice! - otherCosts
        : null,
  };
}

// --- Period comparison -------------------------------------------------------

export function delta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return current - previous;
}

/** Robust z-score of the latest value against the earlier ones (median / MAD). */
export function latestZScore(values: number[]): number | null {
  if (values.length < 8) return null;
  const history = values.slice(0, -1);
  const median = quantile(history, 0.5)!;
  const mad = quantile(
    history.map((value) => Math.abs(value - median)),
    0.5,
  )!;
  if (mad === 0) return null;
  return (values[values.length - 1] - median) / (1.4826 * mad);
}

// --- Calendar aggregation ----------------------------------------------------

export type Bucket = "day" | "week" | "month" | "quarter" | "year";

/** Bucket label of a market-time day: 2026-11-14, 2026-W46, 2026-11, 2026-Q4, 2026. */
export function bucketKey(dayISO: string, bucket: Bucket): string {
  if (bucket === "day") return dayISO;
  if (bucket === "month") return dayISO.slice(0, 7);
  if (bucket === "year") return dayISO.slice(0, 4);
  if (bucket === "quarter") {
    return `${dayISO.slice(0, 4)}-Q${Math.floor((Number(dayISO.slice(5, 7)) - 1) / 3) + 1}`;
  }
  // ISO 8601 week: the week containing the year's first Thursday is week 1.
  const date = new Date(`${dayISO}T00:00:00Z`);
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((date.getTime() - firstThursday.getTime()) / 86400_000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export interface BucketStats {
  key: string;
  hours: number;
  base: number;
  peak: number | null;
  offPeak: number | null;
  min: number;
  max: number;
  negativeHours: number;
}

/** Hour-weighted statistics per calendar bucket in market time. */
export function aggregateBy(series: Series, bucket: Bucket): BucketStats[] {
  const groups = new Map<string, { all: number[]; peak: number[]; off: number[] }>();
  for (let i = 0; i < series.t.length; i++) {
    const key = bucketKey(marketTime(series.t[i]).day, bucket);
    const group = groups.get(key) ?? { all: [], peak: [], off: [] };
    group.all.push(series.v[i]);
    (isPeak(series.t[i]) ? group.peak : group.off).push(series.v[i]);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, group]) => ({
      key,
      hours: group.all.length,
      base: mean(group.all)!,
      peak: mean(group.peak),
      offPeak: mean(group.off),
      min: Math.min(...group.all),
      max: Math.max(...group.all),
      negativeHours: group.all.filter((value) => value < 0).length,
    }));
}

/** Series rebased so its first value is 100. Empty if the first value is not positive. */
export function indexTo100(series: Series): Series {
  const first = series.v[0];
  if (!(first > 0)) return EMPTY_SERIES;
  return { t: series.t, v: series.v.map((value) => (value / first) * 100) };
}

// --- Distributions -----------------------------------------------------------

export interface HistogramBin {
  from: number;
  to: number;
  count: number;
  /** Share of all values in this bin, in [0, 1]. */
  share: number;
}

/**
 * Equal-width histogram on "nice" bin edges. The outer 1% on each side is folded into
 * the first and last bins so a single spike does not flatten the picture.
 */
export function histogram(values: number[], targetBins = 20): HistogramBin[] {
  if (values.length < 2) return [];
  const lo = quantile(values, 0.01)!;
  const hi = quantile(values, 0.99)!;
  if (!(hi > lo)) return [{ from: lo, to: hi, count: values.length, share: 1 }];
  const raw = (hi - lo) / targetBins;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((candidate) => candidate >= raw)!;
  const start = Math.floor(lo / step) * step;
  const count = Math.max(1, Math.ceil((hi - start) / step));
  const bins: HistogramBin[] = Array.from({ length: count }, (_, index) => ({
    from: start + index * step,
    to: start + (index + 1) * step,
    count: 0,
    share: 0,
  }));
  for (const value of values) {
    const index = Math.min(count - 1, Math.max(0, Math.floor((value - start) / step)));
    bins[index].count += 1;
  }
  for (const bin of bins) bin.share = bin.count / values.length;
  return bins;
}
