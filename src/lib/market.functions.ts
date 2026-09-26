import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { expectedBelgradeDeliveryHours } from "@/lib/baseload";
import { readCanonicalPrices } from "@/lib/canonical-market-data.server";
import { aggregatePricePointsToHourly, type PricePoint } from "@/lib/trading-calculations";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 365 * 5;

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

function daysBetween(fromISO: string, toISO: string): string[] {
  const out: string[] = [];
  const start = Date.parse(`${fromISO}T12:00:00Z`);
  const end = Date.parse(`${toISO}T12:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return out;
  for (let t = start; t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

const BELGRADE_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Belgrade",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function belgradeDayOf(ts: string): string {
  return BELGRADE_DAY.format(new Date(ts));
}

function normalizeRequestedRange(data: { from?: string; to?: string }) {
  const today = todayBelgradeISO();
  const maxPast = addDaysISO(today, -MAX_RANGE_DAYS);
  let from = data.from && ISO_DATE_RE.test(data.from) ? data.from : addDaysISO(today, -30);
  let to = data.to && ISO_DATE_RE.test(data.to) ? data.to : today;
  if (from < maxPast) from = maxPast;
  if (to < from) to = from;
  return { from, to };
}

type AnalysedRange = {
  points: PricePoint[];
  completeDays: string[];
  incompleteDays: string[];
  missingDays: string[];
};

function analyseRange(pointsIn: PricePoint[], from: string, to: string): AnalysedRange {
  const days = daysBetween(from, to);
  const hourly = aggregatePricePointsToHourly(pointsIn).filter((point) => {
    const day = belgradeDayOf(point.ts);
    return day >= from && day <= to;
  });

  const byDay = new Map<string, number>();
  for (const point of hourly) {
    const day = belgradeDayOf(point.ts);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }

  const completeDays: string[] = [];
  const incompleteDays: string[] = [];
  const missingDays: string[] = [];
  for (const day of days) {
    const observed = byDay.get(day) ?? 0;
    const expected = expectedBelgradeDeliveryHours(day);
    if (observed === 0) missingDays.push(day);
    else if (observed !== expected) incompleteDays.push(day);
    else completeDays.push(day);
  }

  return { points: hourly, completeDays, incompleteDays, missingDays };
}

/**
 * Public overview read path.
 *
 * This function deliberately never calls ENTSO-E. Background ingestion owns
 * provider traffic and persists the canonical mixed-MTU interval history.
 */
export const fetchMarketPrices = createServerFn({ method: "GET" })
  .inputValidator((data) =>
    z.object({ from: z.string().optional(), to: z.string().optional() }).parse(data ?? {}),
  )
  .handler(async ({ data }) => {
    const { from, to } = normalizeRequestedRange(data);
    const selectedDays = daysBetween(from, to);
    const canonical = await readCanonicalPrices("RS", from, to);
    const analysed = analyseRange(canonical.points, from, to);

    const source = analysed.points.length ? ("cache" as const) : ("none" as const);
    const loadedFrom = analysed.completeDays[0];
    const loadedTo = analysed.completeDays[analysed.completeDays.length - 1];
    const daysWithAnyData = selectedDays.length - analysed.missingDays.length;
    const reason =
      analysed.points.length === 0
        ? "canonical_market_data_unavailable"
        : analysed.missingDays.length || analysed.incompleteDays.length
          ? "partial_canonical_market_price_coverage"
          : undefined;
    const failedFetches = analysed.missingDays.map((day) => ({
      day,
      reason: "canonical_data_missing",
      attempts: 0,
    }));
    const failureCounts = failedFetches.length
      ? { canonical_data_missing: failedFetches.length }
      : {};
    const debugSummary =
      `Canonical price store: selected ${from} → ${to}; total ${selectedDays.length} d; ` +
      `complete ${analysed.completeDays.length}; incomplete ${analysed.incompleteDays.length}; ` +
      `missing ${analysed.missingDays.length}; cache ${canonical.cacheSource}`;

    return {
      ok: analysed.points.length > 0,
      source,
      reason,
      fetched: 0,
      fetchedDaysCount: daysWithAnyData,
      fetchedHoursCount: analysed.points.length,
      windowFrom: from,
      windowTo: to,
      requestedFrom: from,
      requestedTo: to,
      loadedFrom,
      loadedTo,
      missingDays: analysed.missingDays,
      incompleteDays: analysed.incompleteDays,
      failedFetches,
      failureCounts,
      attemptedDaysCount: 0,
      totalSelectedDays: selectedDays.length,
      capReached: false,
      maxFetchPerCall: 0,
      debugSummary,
      truncated: false,
      reasons: reason ? [reason] : undefined,
      points: analysed.points.map((point) => ({ ts: point.ts, price: point.price })),
    };
  });
