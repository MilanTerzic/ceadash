import { createServerFn } from "@tanstack/react-start";
import { fetchDayAheadPricesRange } from "./entsoe.server";
import { readCanonicalPriceCache, writeCanonicalPriceCache } from "./interval-price-cache.server";
import { calculatePricePeriodStats } from "./price-analysis";
import { PRICE_MARKET_CODES, type PriceMarketCode } from "./price-markets";
import { belgradeDeliveryStartUtc } from "./belgrade-delivery-boundary";
import type { PricePoint } from "./trading-calculations";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type RangeInput = {
  day?: string;
  from?: string;
  to?: string;
  force?: boolean;
  markets?: PriceMarketCode[];
};

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

/**
 * Only request explicitly selected markets. Serbia is always included as the
 * reference for spread calculations. Invalid market codes from public requests
 * must never trigger unexpected provider fetches.
 */
function requestedMarketCodes(input?: PriceMarketCode[]): PriceMarketCode[] {
  const selected = Array.isArray(input)
    ? input.filter(
        (code): code is PriceMarketCode =>
          typeof code === "string" && PRICE_MARKET_CODES.includes(code as PriceMarketCode),
      )
    : [];
  return Array.from(new Set<PriceMarketCode>(["RS", ...selected]));
}

function addDaysISO(dayISO: string, days: number): string {
  const date = new Date(`${dayISO}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mergeIntervals(...groups: PricePoint[][]): PricePoint[] {
  const byKey = new Map<string, PricePoint>();
  for (const group of groups) {
    for (const point of group) {
      if (!Number.isFinite(point.price)) continue;
      const timestamp = new Date(point.ts);
      if (Number.isNaN(timestamp.getTime())) continue;
      const durationMinutes = Number(point.durationMinutes ?? 60);
      if (![15, 30, 60].includes(durationMinutes)) continue;
      const normalized: PricePoint = {
        ts: timestamp.toISOString(),
        price: point.price,
        durationMinutes,
      };
      byKey.set(`${normalized.ts}|${durationMinutes}`, normalized);
    }
  }
  return [...byKey.values()].sort((a, b) => a.ts.localeCompare(b.ts));
}

async function allSettledBounded<T>(
  tasks: Array<() => Promise<T>>,
  concurrency = 2,
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

export const getAverageDAProfile = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const days = expandRange(data?.from, data?.to, data?.day);
    const force = Boolean(data?.force);
    const zones = requestedMarketCodes(data?.markets);
    const cacheConfigured = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
    const fromIso = belgradeDeliveryStartUtc(days[0]).toISOString();
    const toIso = belgradeDeliveryStartUtc(addDaysISO(days[days.length - 1], 1)).toISOString();

    const results = await allSettledBounded(
      zones.map((zone) => async () => {
        const market = `DA_${zone}`;
        // Keep previous valid observations even if a forced source refresh fails.
        const cacheResult = await readCanonicalPriceCache(supabaseAdmin, market, fromIso, toIso);
        const cached = cacheResult.points;
        const cachedStats = calculatePricePeriodStats(cached, days);
        const complete = cachedStats.completeDays === days.length && days.length > 0;

        let points = cached;
        let source: "live" | "cache" | "demo" | "empty" = cached.length ? "cache" : "empty";
        let reason: string | undefined = cacheConfigured
          ? undefined
          : "supabase_cache_not_configured";
        let fetchedAt = new Date().toISOString();

        if (force || !complete) {
          const live = await fetchDayAheadPricesRange(
            zone,
            days[0],
            days[days.length - 1],
            false,
            force || !complete,
          );
          const livePoints: PricePoint[] = live.data.points.map((point) => ({
            ts: point.ts,
            price: point.price,
            durationMinutes: point.durationMinutes,
          }));
          if (livePoints.length) {
            try {
              await writeCanonicalPriceCache(supabaseAdmin, market, livePoints, "ENTSO-E");
            } catch (error) {
              const detail = error instanceof Error ? error.message : "unknown";
              console.warn(`[DA profile] Cache write failed for ${zone}: ${detail}`);
              reason = [reason, "price_cache_write_failed"].filter(Boolean).join("; ");
            }
          }
          points = mergeIntervals(cached, livePoints);
          source = live.source === "empty" && points.length ? source : live.source;
          reason = [reason, live.reason].filter(Boolean).join("; ") || undefined;
          fetchedAt = live.fetched_at;
        }

        const stats = calculatePricePeriodStats(points, days);
        if (points.length && stats.completeDays < days.length) {
          reason = [reason, "partial_market_price_coverage"].filter(Boolean).join("; ");
        }
        return {
          zone,
          profile: stats.hourlyProfile,
          stats,
          source,
          reason,
          fetched_at: fetchedAt,
          cache_source: cacheResult.source,
        };
      }),
    );

    const rows = zones.map((zone, index) => {
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

    return { from: days[0], to: days[days.length - 1], zones, rows, cacheConfigured };
  });
