import { belgradeDayKey } from "@/lib/baseload";
import type { CapturePoint } from "@/lib/capture.functions";

export const ROUND_TRIP_EFFICIENCY = 0.85;

export type BessDayMetric = {
  day: string;
  charge2: number;
  discharge2: number;
  gross2: number;
  net2: number;
  charge4: number | null;
  discharge4: number | null;
  gross4: number | null;
  net4: number | null;
};

export type BessAggregate = {
  days: number;
  avgCharge2: number | null;
  avgDischarge2: number | null;
  avgGross2: number | null;
  avgNet2: number | null;
  avgCharge4: number | null;
  avgDischarge4: number | null;
  avgGross4: number | null;
  avgNet4: number | null;
};

export type CapturePeriodMetrics = {
  baseloadEurPerMWh: number | null;
  solarCaptureEurPerMWh: number | null;
  windCaptureEurPerMWh: number | null;
  solarCaptureRate: number | null;
  windCaptureRate: number | null;
  solarNegativeExposure: number | null;
  windNegativeExposure: number | null;
  solarNegativeGeneration: number;
  windNegativeGenerationMWh: number;
  solarGenerationWeight: number;
  windGenerationMWh: number;
  negativePriceHours: number;
  solarHours: number;
  windHours: number;
  priceHours: number;
  priceStandardDeviationEurPerMWh: number | null;
  bess: BessAggregate;
};

export type MonthlyCaptureRow = CapturePeriodMetrics & {
  month: string;
  coveragePct: number;
  solarSource: "entsoe" | "modelled" | "none";
};

export type HourlyProfileRow = {
  hour: number;
  label: string;
  priceEurPerMWh: number | null;
  solar: number | null;
  windMW: number | null;
};

const emptyBess: BessAggregate = {
  days: 0,
  avgCharge2: null,
  avgDischarge2: null,
  avgGross2: null,
  avgNet2: null,
  avgCharge4: null,
  avgDischarge4: null,
  avgGross4: null,
  avgNet4: null,
};

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function localHour(timestamp: string): number {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Belgrade",
    hour: "2-digit",
    hour12: false,
  })
    .formatToParts(new Date(timestamp))
    .find((part) => part.type === "hour")?.value;
  return Number(hour ?? new Date(timestamp).getUTCHours()) % 24;
}

function monthKey(timestamp: string): string {
  return belgradeDayKey(new Date(timestamp)).slice(0, 7);
}

export function calculateBessDays(points: CapturePoint[]): BessDayMetric[] {
  const pricesByDay = new Map<string, number[]>();
  for (const point of points) {
    if (!Number.isFinite(point.price)) continue;
    const day = belgradeDayKey(new Date(point.ts));
    const prices = pricesByDay.get(day) ?? [];
    prices.push(point.price);
    pricesByDay.set(day, prices);
  }

  const days: BessDayMetric[] = [];
  for (const [day, prices] of pricesByDay) {
    if (prices.length < 4) continue;
    const sorted = prices.slice().sort((a, b) => a - b);
    const charge2 = mean(sorted.slice(0, 2))!;
    const discharge2 = mean(sorted.slice(-2))!;
    const charge4 = prices.length >= 8 ? mean(sorted.slice(0, 4)) : null;
    const discharge4 = prices.length >= 8 ? mean(sorted.slice(-4)) : null;
    days.push({
      day,
      charge2,
      discharge2,
      gross2: discharge2 - charge2,
      net2: discharge2 * ROUND_TRIP_EFFICIENCY - charge2,
      charge4,
      discharge4,
      gross4: charge4 == null || discharge4 == null ? null : discharge4 - charge4,
      net4:
        charge4 == null || discharge4 == null ? null : discharge4 * ROUND_TRIP_EFFICIENCY - charge4,
    });
  }
  return days;
}

export function aggregateBess(days: BessDayMetric[]): BessAggregate {
  type NumericBessKey = Exclude<keyof BessDayMetric, "day">;
  const values = (key: NumericBessKey): number[] =>
    days
      .map((day) => day[key])
      .filter((value) => typeof value === "number" && Number.isFinite(value)) as number[];
  return {
    days: days.length,
    avgCharge2: mean(values("charge2")),
    avgDischarge2: mean(values("discharge2")),
    avgGross2: mean(values("gross2")),
    avgNet2: mean(values("net2")),
    avgCharge4: mean(values("charge4")),
    avgDischarge4: mean(values("discharge4")),
    avgGross4: mean(values("gross4")),
    avgNet4: mean(values("net4")),
  };
}

export function computeProducerMetrics(points: CapturePoint[]): CapturePeriodMetrics {
  let priceSum = 0;
  let priceHours = 0;
  let solarPriceWeighted = 0;
  let solarGenerationWeight = 0;
  let solarNegativeGeneration = 0;
  let solarHours = 0;
  let windPriceWeighted = 0;
  let windGenerationMWh = 0;
  let windNegativeGenerationMWh = 0;
  let windHours = 0;
  let negativePriceHours = 0;
  const prices: number[] = [];

  for (const point of points) {
    if (!Number.isFinite(point.price)) continue;
    priceSum += point.price;
    priceHours += 1;
    prices.push(point.price);
    if (point.price < 0) negativePriceHours += 1;

    const solar = Number.isFinite(point.solar) && point.solar > 0 ? point.solar : 0;
    const windMW = Number.isFinite(point.wind) && point.wind > 0 ? point.wind : 0;
    if (solar > 0) {
      solarPriceWeighted += point.price * solar;
      solarGenerationWeight += solar;
      solarHours += 1;
      if (point.price < 0) solarNegativeGeneration += solar;
    }
    if (windMW > 0) {
      // Capture data is aligned to hourly price intervals, so hourly MW is
      // numerically MWh for measured wind. Solar may be a dimensionless proxy.
      windPriceWeighted += point.price * windMW;
      windGenerationMWh += windMW;
      windHours += 1;
      if (point.price < 0) windNegativeGenerationMWh += windMW;
    }
  }

  const baseloadEurPerMWh = priceHours ? priceSum / priceHours : null;
  const solarCaptureEurPerMWh =
    solarGenerationWeight > 0 ? solarPriceWeighted / solarGenerationWeight : null;
  const windCaptureEurPerMWh = windGenerationMWh > 0 ? windPriceWeighted / windGenerationMWh : null;
  const priceMean = mean(prices);
  const variance =
    priceMean == null
      ? null
      : prices.reduce((sum, value) => sum + (value - priceMean) ** 2, 0) / prices.length;

  return {
    baseloadEurPerMWh,
    solarCaptureEurPerMWh,
    windCaptureEurPerMWh,
    solarCaptureRate:
      baseloadEurPerMWh && solarCaptureEurPerMWh != null
        ? solarCaptureEurPerMWh / baseloadEurPerMWh
        : null,
    windCaptureRate:
      baseloadEurPerMWh && windCaptureEurPerMWh != null
        ? windCaptureEurPerMWh / baseloadEurPerMWh
        : null,
    solarNegativeExposure:
      solarGenerationWeight > 0 ? solarNegativeGeneration / solarGenerationWeight : null,
    windNegativeExposure:
      windGenerationMWh > 0 ? windNegativeGenerationMWh / windGenerationMWh : null,
    solarNegativeGeneration,
    windNegativeGenerationMWh,
    solarGenerationWeight,
    windGenerationMWh,
    negativePriceHours,
    solarHours,
    windHours,
    priceHours,
    priceStandardDeviationEurPerMWh: variance == null ? null : Math.sqrt(variance),
    bess: aggregateBess(calculateBessDays(points)),
  };
}

export function captureMetricsByMonth(
  points: CapturePoint[],
  solarSource: MonthlyCaptureRow["solarSource"],
): MonthlyCaptureRow[] {
  const groups = new Map<string, CapturePoint[]>();
  for (const point of points) {
    const month = monthKey(point.ts);
    const group = groups.get(month) ?? [];
    group.push(point);
    groups.set(month, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, monthPoints]) => {
      const metrics = computeProducerMetrics(monthPoints);
      const matched = monthPoints.filter((point) => point.solar > 0 || point.wind > 0).length;
      return {
        month,
        ...metrics,
        coveragePct: monthPoints.length ? (matched / monthPoints.length) * 100 : 0,
        solarSource,
      };
    });
}

export function hourlyProfile(points: CapturePoint[]): HourlyProfileRow[] {
  const buckets = Array.from({ length: 24 }, () => ({
    prices: [] as number[],
    solar: [] as number[],
    wind: [] as number[],
  }));
  for (const point of points) {
    const bucket = buckets[localHour(point.ts)];
    if (Number.isFinite(point.price)) bucket.prices.push(point.price);
    if (Number.isFinite(point.solar)) bucket.solar.push(point.solar);
    if (Number.isFinite(point.wind)) bucket.wind.push(point.wind);
  }
  return buckets.map((bucket, hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}:00`,
    priceEurPerMWh: mean(bucket.prices),
    solar: mean(bucket.solar),
    windMW: mean(bucket.wind),
  }));
}

export function buildProducerInsights(metrics: CapturePeriodMetrics): string[] {
  const insights: string[] = [];
  if (metrics.solarCaptureRate != null) {
    insights.push(
      `Solar capture was ${Math.abs((1 - metrics.solarCaptureRate) * 100).toFixed(1)} percentage points ${
        metrics.solarCaptureRate >= 1 ? "above" : "below"
      } baseload.`,
    );
  }
  if (
    metrics.solarCaptureEurPerMWh != null &&
    metrics.windCaptureEurPerMWh != null &&
    metrics.solarCaptureEurPerMWh !== metrics.windCaptureEurPerMWh
  ) {
    insights.push(
      `${metrics.windCaptureEurPerMWh > metrics.solarCaptureEurPerMWh ? "Wind" : "Solar"} achieved the higher capture price.`,
    );
  }
  if (metrics.negativePriceHours > 0) {
    insights.push(`Negative prices occurred in ${metrics.negativePriceHours} price intervals.`);
  }
  if (metrics.bess.avgNet2 != null) {
    insights.push(
      `The indicative 2-hour BESS net spread averaged ${metrics.bess.avgNet2.toFixed(1)} EUR/MWh.`,
    );
  }
  return insights.slice(0, 4);
}

export function producerSignal(metrics: CapturePeriodMetrics): {
  label: string;
  detail: string;
  tone: "positive" | "warning" | "critical" | "neutral";
} {
  const rates = [metrics.solarCaptureRate, metrics.windCaptureRate].filter(
    (value): value is number => value != null && Number.isFinite(value),
  );
  if (!rates.length) {
    return {
      label: "Limited data",
      detail: "A reliable capture-rate signal is not available for the selected period.",
      tone: "neutral",
    };
  }
  const weakest = Math.min(...rates);
  if (weakest >= 0.95) {
    return {
      label: "Strong capture",
      detail: `The weaker technology retained ${(weakest * 100).toFixed(1)}% of baseload.`,
      tone: "positive",
    };
  }
  if (weakest >= 0.8) {
    return {
      label: "Moderate capture discount",
      detail: `The weaker technology traded at a ${((1 - weakest) * 100).toFixed(1)}% discount to baseload.`,
      tone: "warning",
    };
  }
  return {
    label: "High capture discount",
    detail: `The weaker technology traded at a ${((1 - weakest) * 100).toFixed(1)}% discount to baseload.`,
    tone: "critical",
  };
}
