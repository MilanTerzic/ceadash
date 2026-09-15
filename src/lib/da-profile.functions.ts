import { createServerFn } from "@tanstack/react-start";
import { readCanonicalPrices } from "./canonical-market-data.server";
import { calculatePricePeriodStats } from "./price-analysis";
import { PRICE_MARKET_CODES } from "./price-markets";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type RangeInput = { day?: string; from?: string; to?: string; force?: boolean };

function todayBelgradeISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function clean(value?: string): string | undefined {
  return value && ISO_DATE_RE.test(value) ? value : undefined;
}

function expandRange(fromIn?: string, toIn?: string, dayIn?: string): string[] {
  const from = clean(fromIn);
  const to = clean(toIn);
  const day = clean(dayIn);
  if (!from && !to && !day) return [todayBelgradeISO()];
  if (from && to) {
    const start = Date.parse(`${from}T00:00:00Z`);
    const end = Date.parse(`${to}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [from];
    const result: string[] = [];
    const cappedEnd = Math.min(end, start + 365 * 86_400_000);
    for (let t = start; t <= cappedEnd; t += 86_400_000) {
      result.push(new Date(t).toISOString().slice(0, 10));
    }
    return result;
  }
  return [day ?? from ?? to ?? todayBelgradeISO()];
}

async function allSettledBounded<T>(
  tasks: Array<() => Promise<T>>,
  concurrency = 6,
): Promise<Array<PromiseSettledResult<T>>> {
  const output: Array<PromiseSettledResult<T>> = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const index = next++;
      try {
        output[index] = { status: "fulfilled", value: await tasks[index]() };
      } catch (reason) {
        output[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return output;
}

/**
 * Regional price analytics read only from persisted canonical intervals.
 * The `force` input is retained for UI compatibility but intentionally does not
 * trigger provider traffic. Scheduled ingestion is the only refresh owner.
 */
export const getAverageDAProfile = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const days = expandRange(data?.from, data?.to, data?.day);

    const results = await allSettledBounded(
      PRICE_MARKET_CODES.map((zone) => async () => {
        const canonical = await readCanonicalPrices(zone, days[0], days[days.length - 1]);
        const stats = calculatePricePeriodStats(canonical.points, days);
        const hasData = canonical.points.length > 0;
        const complete = stats.completeDays === days.length && days.length > 0;
        return {
          zone,
          profile: stats.hourlyProfile,
          stats,
          source: hasData ? ("cache" as const) : ("empty" as const),
          reason: !hasData
            ? "canonical_market_data_unavailable"
            : complete
              ? undefined
              : "partial_market_price_coverage",
          fetched_at: new Date().toISOString(),
          cache_source: canonical.cacheSource,
        };
      }),
    );

    const rows = PRICE_MARKET_CODES.map((zone, index) => {
      const result = results[index];
      return result.status === "fulfilled"
        ? result.value
        : {
            zone,
            profile: new Array<number | null>(24).fill(null),
            stats: calculatePricePeriodStats([], days),
            source: "empty" as const,
            reason: result.reason instanceof Error ? result.reason.message : "error",
            fetched_at: new Date().toISOString(),
            cache_source: "empty" as const,
          };
    });

    return { from: days[0], to: days[days.length - 1], zones: PRICE_MARKET_CODES, rows };
  });
