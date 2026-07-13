import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchCaptureSeries, type CapturePoint } from "@/lib/capture.functions";
import { fetchRegionalSnapshot, type RegionalSnapshot } from "@/lib/regional.functions";
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

export const getCeaTraderReport = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<CeaTraderReport> => {
    const [regionalResult, captureResult] = await Promise.allSettled([
      fetchRegionalSnapshot({ data }),
      fetchCaptureSeries({ data }),
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

    const priceMarkets = regional.prices ?? [];
    const summaries = marketSummaries(priceMarkets);
    const dailyBaseload = dailyBaseloadRows(priceMarkets);
    const rsPoints = priceMarkets.find((p) => p.zone === "RS")?.points ?? [];
    const serbiaHeatmap = hourlyHeatmapRows(rsPoints);
    const capturePoints = capture.points ?? [];
    const captureStats = capturePoints.length ? captureSummary(capturePoints) : null;
    const captureDaily = capturePoints.length ? dailyCaptureRows(capturePoints) : [];
    const latestFlows = flowSnapshotRows(regional.flows ?? []);

    const coverage: ReportCoverageItem[] = [];
    const priceRows = priceMarkets.reduce((sum, p) => sum + p.points.length, 0);
    coverage.push({
      dataset: "Regional day-ahead prices",
      status: regional.source === "live" ? "live" : regional.source === "cache" ? "cache" : "empty",
      rows: priceRows,
      ...firstLast(priceMarkets.flatMap((p) => p.points)),
      message:
        regionalResult.status === "rejected"
          ? errorMessage(regionalResult.reason)
          : regional.reason,
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
      dataset: "Serbia physical-flow snapshot",
      status: latestFlows.length ? (regional.source === "live" ? "live" : "cache") : "empty",
      rows: latestFlows.length,
      firstTimestamp: null,
      lastTimestamp: null,
      message:
        "Existing CEA regional data exposes latest 24h average physical flows, not full-period flow energy.",
    });

    return {
      period: {
        from: data.from,
        to: data.to,
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
        note: "Physical flows use the current CEA regional snapshot: latest 24h average by Serbia border.",
      },
      coverage,
    };
  });
