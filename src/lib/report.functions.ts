import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { belgradeDayKey } from "@/lib/baseload";
import { fetchCaptureSeries, type CapturePoint } from "@/lib/capture.functions";
import { fetchMarketPrices } from "@/lib/market.functions";
import {
  fetchRegionalSnapshot,
  RS_NEIGHBOURS,
  type FlowSummary,
  type RegionalSnapshot,
  type ZoneCode,
  type ZonePrice,
} from "@/lib/regional.functions";
import {
  buildDeskSummary,
  captureSummary,
  dailyBaseloadRows,
  dailyCaptureRows,
  flowSnapshotRows,
  hourlyHeatmapRows,
  marketSummaries,
  type CaptureSummary,
  type DailyCaptureRow,
  type FlowSnapshotRow,
  type MarketPriceSummary,
} from "@/lib/report.analytics";

export type ReportCoverageItem = {
  dataset: string;
  status: "live" | "cache" | "empty" | "error";
  rows: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  message?: string;
};

export type CeaTraderReport = {
  period: {
    from: string;
    to: string;
    timezone: "Europe/Belgrade";
    generatedAt: string;
  };
  deskSummary: string[];
  prices: {
    dailyBaseload: Array<Record<string, string | number | null>>;
    marketSummary: MarketPriceSummary[];
    serbiaHeatmap: ReturnType<typeof hourlyHeatmapRows>;
  };
  capture: {
    summary: CaptureSummary | null;
    daily: DailyCaptureRow[];
    solarSource: "entsoe" | "modelled" | "none" | null;
  };
  flows: {
    latest24h: FlowSnapshotRow[];
    note: string;
    coverageFrom: string | null;
    coverageTo: string | null;
  };
  coverage: ReportCoverageItem[];
};

function firstLast(points: Array<{ ts: string }>): {
  firstTimestamp: string | null;
  lastTimestamp: string | null;
} {
  const sorted = [...points].sort((a, b) => a.ts.localeCompare(b.ts));
  return {
    firstTimestamp: sorted[0]?.ts ?? null,
    lastTimestamp: sorted[sorted.length - 1]?.ts ?? null,
  };
}

function firstLastTimestamps(points: Array<{ datetime: string }>): {
  firstTimestamp: string | null;
  lastTimestamp: string | null;
} {
  const sorted = [...points].sort((a, b) => a.datetime.localeCompare(b.datetime));
  return {
    firstTimestamp: sorted[0]?.datetime ?? null,
    lastTimestamp: sorted[sorted.length - 1]?.datetime ?? null,
  };
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function emptyRegional(): RegionalSnapshot {
  return {
    ok: false,
    generatedAt: new Date().toISOString(),
    windowFrom: "",
    windowTo: "",
    prices: [],
    flows: [],
    source: "none",
    reason: "regional_fetch_failed",
  };
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function todayBelgradeISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDaysISO(dayISO: string, n: number): string {
  const d = new Date(`${dayISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function belgradeOffsetHours(dayISO: string): number {
  const noonUtc = new Date(`${dayISO}T12:00:00Z`);
  const part =
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Belgrade",
      timeZoneName: "shortOffset",
    })
      .formatToParts(noonUtc)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT+1";
  const match = /GMT([+-]\d+)/.exec(part);
  return match ? Number(match[1]) : 1;
}

function belgradeDayBoundaryUtc(dayISO: string): Date {
  const [year, month, day] = dayISO.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, -belgradeOffsetHours(dayISO), 0, 0, 0));
}

function resolveSevenDayReportRange(
  requested: { from: string; to: string; preset?: string },
  serbiaPoints: Array<{ ts: string; price: number }>,
): { from: string; to: string; usedTomorrow: boolean } {
  if (requested.preset !== "7d") {
    return { from: requested.from, to: requested.to, usedTomorrow: false };
  }

  const today = todayBelgradeISO();
  const tomorrow = addDaysISO(today, 1);
  const hasTomorrow = serbiaPoints.some((point) => belgradeDayKey(new Date(point.ts)) === tomorrow);
  const to = hasTomorrow ? tomorrow : today;
  return {
    from: addDaysISO(to, -6),
    to,
    usedTomorrow: hasTomorrow,
  };
}

type FlowPeriodResult = {
  flows: FlowSummary[];
  rows: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
};

async function fetchSerbiaFlowPeriodAverage(from: string, to: string): Promise<FlowPeriodResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const fromUtc = belgradeDayBoundaryUtc(from);
  const toUtc = belgradeDayBoundaryUtc(addDaysISO(to, 1));
  const flowRows = await supabaseAdmin
    .from("cross_border_flows_hourly")
    .select("datetime, from_zone, to_zone, flow_mw")
    .gte("datetime", fromUtc.toISOString())
    .lt("datetime", toUtc.toISOString())
    .order("datetime", { ascending: true });

  const rows = (flowRows.data ?? []) as Array<{
    datetime: string;
    from_zone: string;
    to_zone: string;
    flow_mw: number | string | null;
  }>;
  const usedRows: typeof rows = [];
  const acc = new Map<string, { sum: number; n: number }>();
  for (const row of rows) {
    const fromZone = row.from_zone as ZoneCode;
    const toZone = row.to_zone as ZoneCode;
    if (!(
      (fromZone === "RS" && RS_NEIGHBOURS.includes(toZone)) ||
      (toZone === "RS" && RS_NEIGHBOURS.includes(fromZone))
    )) {
      continue;
    }
    const value = Number(row.flow_mw);
    if (!Number.isFinite(value)) continue;
    usedRows.push(row);
    const key = `${fromZone}|${toZone}`;
    const next = acc.get(key) ?? { sum: 0, n: 0 };
    next.sum += value;
    next.n += 1;
    acc.set(key, next);
  }

  const flows = RS_NEIGHBOURS.map((neighbour) => {
    const exportAcc = acc.get(`RS|${neighbour}`);
    const importAcc = acc.get(`${neighbour}|RS`);
    if (!exportAcc && !importAcc) return null;
    const exportAvg = exportAcc ? exportAcc.sum / exportAcc.n : 0;
    const importAvg = importAcc ? importAcc.sum / importAcc.n : 0;
    const netMw = exportAvg - importAvg;
    return {
      from: "RS" as ZoneCode,
      to: neighbour,
      netMw: Math.round(netMw),
      absMw: Math.round(Math.abs(netMw)),
    };
  }).filter((flow): flow is FlowSummary => flow != null && flow.absMw > 0);

  return {
    flows: flows.sort((a, b) => b.absMw - a.absMw),
    rows: usedRows.length,
    ...firstLastTimestamps(usedRows),
  };
}

function serbiaZoneFromMarket(points: Array<{ ts: string; price: number }>): ZonePrice | null {
  const clean = points
    .filter((point) => Number.isFinite(point.price))
    .sort((a, b) => a.ts.localeCompare(b.ts));
  if (!clean.length) return null;
  const prices = clean.map((point) => point.price);
  const last24 = clean.slice(-24).map((point) => point.price);
  const latest = clean[clean.length - 1];
  return {
    zone: "RS",
    name: "Serbia",
    avg24h: average(last24),
    baseload: average(prices),
    windCapture: null,
    solarCapture: null,
    windCaptureRatio: null,
    solarCaptureRatio: null,
    latest: latest?.price ?? null,
    latestTs: latest?.ts ?? null,
    priceHours: clean.length,
    negHours: clean.filter((point) => point.price < 0).length,
    points: clean,
  };
}

function mergeSerbiaFullRange(
  regionalPrices: ZonePrice[],
  serbiaFullRange: ZonePrice | null,
): ZonePrice[] {
  if (!serbiaFullRange) return regionalPrices;
  const others = regionalPrices.filter((price) => price.zone !== "RS");
  return [serbiaFullRange, ...others];
}

export const getCeaTraderReport = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        preset: z.enum(["7d", "30d", "mtd", "prev_month", "ytd", "custom"]).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<CeaTraderReport> => {
    const [serbiaMarketResult] = await Promise.allSettled([fetchMarketPrices({ data })]);

    const serbiaMarket =
      serbiaMarketResult.status === "fulfilled"
        ? serbiaMarketResult.value
        : {
            ok: false,
            source: "none" as const,
            points: [] as Array<{ ts: string; price: number }>,
            reason: errorMessage(serbiaMarketResult.reason),
          };

    const effectiveRange = resolveSevenDayReportRange(data, serbiaMarket.points ?? []);
    const effectiveData = { from: effectiveRange.from, to: effectiveRange.to };

    const [regionalResult, captureResult] = await Promise.allSettled([
      fetchRegionalSnapshot({ data: effectiveData }),
      fetchCaptureSeries({ data: effectiveData }),
    ]);

    const regional = regionalResult.status === "fulfilled" ? regionalResult.value : emptyRegional();
    const capture =
      captureResult.status === "fulfilled"
        ? captureResult.value
        : {
            ok: false,
            source: "none" as const,
            reason: errorMessage(captureResult.reason),
            points: [] as CapturePoint[],
            solarSource: "none" as const,
          };

    const serbiaPoints = (serbiaMarket.points ?? []).filter((point) => {
      const day = belgradeDayKey(new Date(point.ts));
      return day >= effectiveRange.from && day <= effectiveRange.to;
    });
    const serbiaFullRange = serbiaZoneFromMarket(serbiaPoints);
    const priceMarkets = mergeSerbiaFullRange(regional.prices ?? [], serbiaFullRange);
    const summaries = marketSummaries(priceMarkets);
    const dailyBaseload = dailyBaseloadRows(priceMarkets);
    const rsPoints =
      serbiaFullRange?.points ?? priceMarkets.find((p) => p.zone === "RS")?.points ?? [];
    const serbiaHeatmap = hourlyHeatmapRows(rsPoints);
    const capturePoints = capture.points ?? [];
    const captureStats = capturePoints.length ? captureSummary(capturePoints) : null;
    const captureDaily = capturePoints.length ? dailyCaptureRows(capturePoints) : [];
    const flowPeriod = await fetchSerbiaFlowPeriodAverage(effectiveRange.from, effectiveRange.to);
    const latestFlows = flowSnapshotRows(flowPeriod.flows);

    const coverage: ReportCoverageItem[] = [];
    const regionalComparisonRows = (regional.prices ?? [])
      .filter((price) => price.zone !== "RS")
      .reduce((sum, p) => sum + p.points.length, 0);
    coverage.push({
      dataset: "Serbia day-ahead prices",
      status:
        serbiaMarketResult.status === "rejected"
          ? "error"
          : serbiaPoints.length
            ? serbiaMarket.source === "entsoe"
              ? "live"
              : "cache"
            : "empty",
      rows: serbiaPoints.length,
      ...firstLast(serbiaPoints),
      message:
        serbiaMarketResult.status === "rejected"
          ? errorMessage(serbiaMarketResult.reason)
          : effectiveRange.usedTomorrow
            ? "Last 7 days includes tomorrow because published Serbia DA prices are available; 15-minute MTUs are averaged into hourly prices."
            : data.preset === "7d"
              ? "Last 7 days includes today because tomorrow Serbia DA prices are not available yet; 15-minute MTUs are averaged into hourly prices."
              : "Range-aware Serbia fetch; 15-minute MTUs are averaged into hourly prices.",
    });
    coverage.push({
      dataset: "Regional comparison prices",
      status: regional.source === "live" ? "live" : regional.source === "cache" ? "cache" : "empty",
      rows: regionalComparisonRows,
      ...firstLast(
        (regional.prices ?? []).filter((price) => price.zone !== "RS").flatMap((p) => p.points),
      ),
      message:
        regionalResult.status === "rejected"
          ? errorMessage(regionalResult.reason)
          : "Regional snapshot is used for comparison markets; Serbia is fetched separately for the full selected range.",
    });
    coverage.push({
      dataset: "Serbia RES capture inputs",
      status:
        captureResult.status === "rejected"
          ? "error"
          : capture.source === "entsoe"
            ? "live"
            : capture.source === "cache"
              ? "cache"
              : "empty",
      rows: capturePoints.length,
      ...firstLast(capturePoints),
      message:
        captureResult.status === "rejected" ? errorMessage(captureResult.reason) : capture.reason,
    });
    coverage.push({
      dataset: "Serbia physical-flow period average",
      status: flowPeriod.rows ? (regional.source === "live" ? "live" : "cache") : "empty",
      rows: flowPeriod.rows,
      firstTimestamp: flowPeriod.firstTimestamp,
      lastTimestamp: flowPeriod.lastTimestamp,
      message:
        flowPeriod.rows > 0
          ? "Average physical flow by Serbia border over available cached rows in the selected period. Positive values indicate RS exports."
          : "No cached physical-flow rows found inside the selected period.",
    });

    return {
      period: {
        from: effectiveRange.from,
        to: effectiveRange.to,
        timezone: "Europe/Belgrade",
        generatedAt: new Date().toISOString(),
      },
      deskSummary: buildDeskSummary({
        summaries,
        capture: captureStats,
        flows: latestFlows,
      }),
      prices: {
        dailyBaseload,
        marketSummary: summaries,
        serbiaHeatmap,
      },
      capture: {
        summary: captureStats,
        daily: captureDaily,
        solarSource: capture.solarSource ?? null,
      },
      flows: {
        latest24h: latestFlows,
        note:
          flowPeriod.firstTimestamp && flowPeriod.lastTimestamp
            ? `Physical flows are averaged over available data from ${flowPeriod.firstTimestamp} to ${flowPeriod.lastTimestamp}. Positive values indicate RS exports.`
            : "No cached physical-flow rows found inside the selected period.",
        coverageFrom: flowPeriod.firstTimestamp,
        coverageTo: flowPeriod.lastTimestamp,
      },
      coverage,
    };
  });
