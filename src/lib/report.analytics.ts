import { belgradeDayKey } from "@/lib/baseload";
import type { CapturePoint } from "@/lib/capture.functions";
import { calculatePricePeriodStats, normalizeToHourlyPrices } from "@/lib/price-analysis";
import type { FlowSummary, ZonePrice } from "@/lib/regional.functions";

export type MarketPriceSummary = {
  zone: string;
  name: string;
  baseload: number | null;
  peakload: number | null;
  offpeak: number | null;
  min: number | null;
  max: number | null;
  volatility: number | null;
  p10: number | null;
  p90: number | null;
  negativeHours: number;
  availableHours: number;
  spreadVsRs: number | null;
  absSpreadVsRs: number | null;
  cheaperThanRsPct: number | null;
  moreExpensiveThanRsPct: number | null;
  correlationVsRs: number | null;
};

export type CaptureSummary = {
  baseload: number | null;
  solarCapture: number | null;
  windCapture: number | null;
  solarCaptureRate: number | null;
  windCaptureRate: number | null;
  solarNegativeShare: number | null;
  windNegativeShare: number | null;
  negativeHours: number;
  priceHours: number;
  solarHours: number;
  windHours: number;
  bessNet2h: number | null;
  bessNet4h: number | null;
};

export type DailyCaptureRow = {
  date: string;
  baseload: number | null;
  solarCapture: number | null;
  windCapture: number | null;
  solarMwh: number;
  windMwh: number;
  negativeHours: number;
};

export type FlowSnapshotRow = {
  border: string;
  direction: string;
  netMw: number;
  absMw: number;
};

const HOUR_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Belgrade",
  hour: "2-digit",
  hour12: false,
});

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo] ?? null;
  const a = sorted[lo];
  const b = sorted[hi];
  if (!finite(a) || !finite(b)) return null;
  return a + (b - a) * (idx - lo);
}

function pearson(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 2) return null;
  const ma = mean(a);
  const mb = mean(b);
  if (ma == null || mb == null) return null;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i += 1) {
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : null;
}

function localHour(ts: string): number {
  return Number(HOUR_FMT.formatToParts(new Date(ts)).find((p) => p.type === "hour")?.value ?? 0);
}

export function dailyBaseloadRows(
  markets: ZonePrice[],
): Array<Record<string, string | number | null>> {
  const byDay = new Map<string, Record<string, number[]>>();
  for (const market of markets) {
    for (const p of market.points) {
      if (!finite(p.price)) continue;
      const day = belgradeDayKey(new Date(p.ts));
      const row = byDay.get(day) ?? {};
      row[market.zone] = [...(row[market.zone] ?? []), p.price];
      byDay.set(day, row);
    }
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => {
      const row: Record<string, string | number | null> = { date };
      for (const [zone, prices] of Object.entries(values)) {
        row[zone] = mean(prices);
      }
      return row;
    });
}

export function marketSummaries(markets: ZonePrice[]): MarketPriceSummary[] {
  const rs = markets.find((m) => m.zone === "RS");
  const rsHourly = normalizeToHourlyPrices(rs?.points ?? []);
  const rsByTs = new Map(rsHourly.map((p) => [p.ts, p.price]));

  return markets
    .map((market) => {
      const points = normalizeToHourlyPrices(market.points).filter((p) => finite(p.price));
      const prices = points.map((p) => p.price);
      const days = [...new Set(points.map((p) => belgradeDayKey(new Date(p.ts))))].sort();
      const periodStats = calculatePricePeriodStats(points, days);

      const overlaps: Array<{ rs: number; other: number }> = [];
      if (market.zone !== "RS") {
        for (const p of points) {
          const rsPrice = rsByTs.get(p.ts);
          if (finite(rsPrice)) overlaps.push({ rs: rsPrice, other: p.price });
        }
      }
      const spreads = overlaps.map((p) => p.rs - p.other);

      return {
        zone: market.zone,
        name: market.name,
        baseload: periodStats.baseloadAverage,
        peakload: periodStats.peakAverage,
        offpeak: periodStats.offPeakAverage,
        min: periodStats.minimum,
        max: periodStats.maximum,
        volatility: periodStats.volatility,
        p10: percentile(prices, 0.1),
        p90: percentile(prices, 0.9),
        negativeHours: prices.filter((p) => p < 0).length,
        availableHours: prices.length,
        spreadVsRs: market.zone === "RS" ? null : mean(spreads),
        absSpreadVsRs: market.zone === "RS" ? null : mean(spreads.map(Math.abs)),
        cheaperThanRsPct:
          market.zone === "RS" || !overlaps.length
            ? null
            : overlaps.filter((p) => p.other < p.rs).length / overlaps.length,
        moreExpensiveThanRsPct:
          market.zone === "RS" || !overlaps.length
            ? null
            : overlaps.filter((p) => p.other > p.rs).length / overlaps.length,
        correlationVsRs:
          market.zone === "RS" || !overlaps.length
            ? null
            : pearson(
                overlaps.map((p) => p.rs),
                overlaps.map((p) => p.other),
              ),
      };
    })
    .filter((row) => row.availableHours > 0)
    .sort((a, b) => (b.baseload ?? -Infinity) - (a.baseload ?? -Infinity));
}

function weightedCapture(points: CapturePoint[], key: "solar" | "wind"): number | null {
  let numerator = 0;
  let denominator = 0;
  for (const p of points) {
    const generation = Math.max(0, p[key]);
    if (!finite(p.price) || !finite(generation) || generation <= 0) continue;
    numerator += p.price * generation;
    denominator += generation;
  }
  return denominator > 0 ? numerator / denominator : null;
}

function dailyBessNet(points: CapturePoint[], hours: 2 | 4): number | null {
  const byDay = new Map<string, number[]>();
  for (const p of points) {
    if (!finite(p.price)) continue;
    const day = belgradeDayKey(new Date(p.ts));
    byDay.set(day, [...(byDay.get(day) ?? []), p.price]);
  }
  const spreads: number[] = [];
  for (const prices of byDay.values()) {
    if (prices.length < hours * 2) continue;
    const sorted = [...prices].sort((a, b) => a - b);
    const low = sorted.slice(0, hours);
    const high = sorted.slice(-hours);
    const charge = mean(low);
    const discharge = mean(high);
    if (charge != null && discharge != null) {
      spreads.push(discharge * 0.85 - charge);
    }
  }
  return mean(spreads);
}

export function captureSummary(points: CapturePoint[]): CaptureSummary {
  const prices = points.map((p) => p.price).filter(finite);
  const baseload = mean(prices);
  const solarCapture = weightedCapture(points, "solar");
  const windCapture = weightedCapture(points, "wind");
  const solarMwh = points.reduce((sum, p) => sum + Math.max(0, finite(p.solar) ? p.solar : 0), 0);
  const windMwh = points.reduce((sum, p) => sum + Math.max(0, finite(p.wind) ? p.wind : 0), 0);
  const solarNegativeMwh = points.reduce(
    (sum, p) => sum + (p.price < 0 ? Math.max(0, finite(p.solar) ? p.solar : 0) : 0),
    0,
  );
  const windNegativeMwh = points.reduce(
    (sum, p) => sum + (p.price < 0 ? Math.max(0, finite(p.wind) ? p.wind : 0) : 0),
    0,
  );

  return {
    baseload,
    solarCapture,
    windCapture,
    solarCaptureRate: baseload && solarCapture != null ? solarCapture / baseload : null,
    windCaptureRate: baseload && windCapture != null ? windCapture / baseload : null,
    solarNegativeShare: solarMwh > 0 ? solarNegativeMwh / solarMwh : null,
    windNegativeShare: windMwh > 0 ? windNegativeMwh / windMwh : null,
    negativeHours: prices.filter((p) => p < 0).length,
    priceHours: prices.length,
    solarHours: points.filter((p) => p.solar > 0).length,
    windHours: points.filter((p) => p.wind > 0).length,
    bessNet2h: dailyBessNet(points, 2),
    bessNet4h: dailyBessNet(points, 4),
  };
}

export function dailyCaptureRows(points: CapturePoint[]): DailyCaptureRow[] {
  const byDay = new Map<string, CapturePoint[]>();
  for (const p of points) {
    const day = belgradeDayKey(new Date(p.ts));
    byDay.set(day, [...(byDay.get(day) ?? []), p]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rows]) => {
      const prices = rows.map((p) => p.price).filter(finite);
      return {
        date,
        baseload: mean(prices),
        solarCapture: weightedCapture(rows, "solar"),
        windCapture: weightedCapture(rows, "wind"),
        solarMwh: rows.reduce((sum, p) => sum + Math.max(0, finite(p.solar) ? p.solar : 0), 0),
        windMwh: rows.reduce((sum, p) => sum + Math.max(0, finite(p.wind) ? p.wind : 0), 0),
        negativeHours: prices.filter((p) => p < 0).length,
      };
    });
}

export function hourlyHeatmapRows(points: Array<{ ts: string; price: number }>) {
  const byDay = new Map<string, Record<string, number>>();
  for (const p of points) {
    if (!finite(p.price)) continue;
    const day = belgradeDayKey(new Date(p.ts));
    const hour = localHour(p.ts);
    const row = byDay.get(day) ?? {};
    row[String(hour)] = p.price;
    byDay.set(day, row);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, hours]) => ({ date, hours }));
}

export function flowSnapshotRows(flows: FlowSummary[]): FlowSnapshotRow[] {
  return flows
    .map((flow) => {
      const exports = flow.netMw >= 0;
      return {
        border: `RS-${flow.to}`,
        direction: exports ? `RS -> ${flow.to}` : `${flow.to} -> RS`,
        netMw: flow.netMw,
        absMw: flow.absMw,
      };
    })
    .sort((a, b) => b.absMw - a.absMw);
}

export function buildDeskSummary(args: {
  summaries: MarketPriceSummary[];
  capture: CaptureSummary | null;
  flows: FlowSnapshotRow[];
}): string[] {
  const out: string[] = [];
  const rs = args.summaries.find((s) => s.zone === "RS");
  const hu = args.summaries.find((s) => s.zone === "HU");
  if (rs?.baseload != null) {
    out.push(
      `Serbia SEEPEX averaged ${rs.baseload.toFixed(1)} EUR/MWh over ${rs.availableHours} available hours.`,
    );
  }
  if (rs?.baseload != null && hu?.baseload != null) {
    const spread = rs.baseload - hu.baseload;
    out.push(
      `Serbia traded ${Math.abs(spread).toFixed(1)} EUR/MWh ${spread >= 0 ? "above" : "below"} Hungary on average.`,
    );
  }
  if (rs && rs.negativeHours > 0) {
    out.push(`Serbia recorded ${rs.negativeHours} negative-price hours in the selected period.`);
  }
  if (rs?.min != null && rs?.max != null) {
    out.push(
      `Serbian hourly prices ranged from ${rs.min.toFixed(1)} to ${rs.max.toFixed(1)} EUR/MWh.`,
    );
  }
  if (args.capture?.solarCapture != null && args.capture.solarCaptureRate != null) {
    out.push(
      `Solar capture was ${args.capture.solarCapture.toFixed(1)} EUR/MWh, ${(args.capture.solarCaptureRate * 100).toFixed(0)}% of baseload.`,
    );
  }
  if (args.capture?.windCapture != null && args.capture.windCaptureRate != null) {
    out.push(
      `Wind capture was ${args.capture.windCapture.toFixed(1)} EUR/MWh, ${(args.capture.windCaptureRate * 100).toFixed(0)}% of baseload.`,
    );
  }
  if (args.capture?.bessNet4h != null) {
    out.push(
      `Indicative 4h BESS daily net spread averaged ${args.capture.bessNet4h.toFixed(1)} EUR/MWh at 85% efficiency.`,
    );
  }
  if (args.flows[0]) {
    out.push(
      `Physical-flow period average is strongest on ${args.flows[0].direction} at ${args.flows[0].absMw.toFixed(0)} MW.`,
    );
  }
  return out.slice(0, 8);
}
