import { createServerFn } from "@tanstack/react-start";
import {
  fetchDayAheadPrices,
  fetchDayAheadPricesRange,
  fetchExplicitAllocation,
  validatePriceMarket,
} from "../entsoe.server";
import { type PricePoint } from "../trading-calculations";
import { calculatePricePeriodStats } from "../price-analysis";
import { IMPORT_ROUTES, EXPORT_ROUTES } from "../markets";
import { PRICE_MARKET_CODES } from "../price-markets";
import {
  todayISO,
  offsetISO,
  clean,
  expandRange,
  RangeInput,
  DA_ZONES,
  readCachedDaPricePoints,
  mergeDaPricePoints,
  hasCompletePriceCoverage,
  allSettledBounded,
} from "./shared";

export const getDashboardSnapshot = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const days = expandRange(data?.from, data?.to, data?.day);
    const headDay = days[0];

    const priceResults = await allSettledBounded(
      DA_ZONES.map(
        (z) => async () =>
          days.length > 1
            ? await fetchDayAheadPricesRange(z, days[0], days[days.length - 1])
            : await fetchDayAheadPrices(z, headDay),
      ),
    );
    const prices = DA_ZONES.map((z, index) => {
      const result = priceResults[index];
      if (result.status === "fulfilled") {
        return {
          zone: z,
          data: { zone: z, points: result.value.data.points },
          source: result.value.source,
          reason: result.value.reason,
          fetched_at: result.value.fetched_at,
        };
      }
      return {
        zone: z,
        data: {
          zone: z,
          points: [] as Array<{ ts: string; price: number; durationMinutes?: number }>,
        },
        source: "empty" as const,
        reason: result.reason instanceof Error ? result.reason.message : "error",
        fetched_at: new Date().toISOString(),
      };
    });

    const importRoutes = await Promise.all(
      IMPORT_ROUTES.map(async (r) => {
        const cap = await fetchExplicitAllocation(r.from, r.to, "daily", headDay);
        return { ...r, cap };
      }),
    );
    const exportRoutes = await Promise.all(
      EXPORT_ROUTES.map(async (r) => {
        const cap = await fetchExplicitAllocation(r.from, r.to, "daily", headDay);
        return { ...r, cap };
      }),
    );

    const byZone = Object.fromEntries(prices.map((p) => [p.zone, p.data.points]));

    // Probe: are tomorrow's DA prices already published? (SEEPEX gate ≈ 12:45 CET)
    const tomorrow = new Date(Date.parse(headDay + "T00:00:00Z") + 86400_000)
      .toISOString()
      .slice(0, 10);
    let tomorrowRS: {
      day: string;
      points: Array<{ ts: string; price: number }>;
      avg: number | null;
      source: string;
    } | null = null;
    let previousRS: {
      day: string;
      points: Array<{ ts: string; price: number }>;
      avg: number | null;
      source: string;
    } | null = null;
    if (days.length === 1 && headDay === todayISO()) {
      const r = await fetchDayAheadPrices("RS", tomorrow);
      const pts = r.data.points;
      const avg = pts.length ? pts.reduce((a, p) => a + p.price, 0) / pts.length : null;
      tomorrowRS = {
        day: tomorrow,
        points: pts,
        avg: pts.length >= 20 ? avg : null,
        source: r.source,
      };
    }
    if (days.length === 1) {
      const previousDate = new Date(headDay + "T12:00:00Z");
      previousDate.setUTCDate(previousDate.getUTCDate() - 1);
      const previous = previousDate.toISOString().slice(0, 10);
      const r = await fetchDayAheadPrices("RS", previous);
      const pts = r.data.points;
      const avg = pts.length ? pts.reduce((a, p) => a + p.price, 0) / pts.length : null;
      previousRS = { day: previous, points: pts, avg, source: r.source };
    }

    return {
      day: headDay,
      from: days[0],
      to: days[days.length - 1],
      prices,
      importRoutes,
      exportRoutes,
      byZone,
      tomorrowRS,
      previousRS,
    };
  });

// Hourly DA price profile (avg per hour 0..23) across the date range, per zone.
export const getAverageDAProfile = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const days = expandRange(data?.from, data?.to, data?.day);
    const force = Boolean(data?.force);
    const zones = DA_ZONES;
    const outResults = await allSettledBounded(
      zones.map((z) => async () => {
        const cachedPoints = await readCachedDaPricePoints(
          supabaseAdmin,
          z,
          days[0],
          days[days.length - 1],
        );
        let points: PricePoint[] = mergeDaPricePoints(cachedPoints);
        let source: "live" | "cache" | "demo" | "empty" = points.length ? "cache" : "empty";
        let reason: string | undefined;
        let fetchedAt = new Date().toISOString();
        const cacheComplete = hasCompletePriceCoverage(points, days);
        if (force || !cacheComplete) {
          const live = await fetchDayAheadPricesRange(
            z,
            days[0],
            days[days.length - 1],
            false,
            force || !cacheComplete,
          );
          const livePoints = live.data.points.map((point) => ({
            ts: point.ts,
            price: point.price,
            durationMinutes: point.durationMinutes,
          }));
          // Persist newly fetched hourly points to market_prices_hourly so
          // subsequent long-range (YTD) requests are cache hits instead of
          // reissuing dozens of ENTSO-E round-trips.
          if (livePoints.length) {
            try {
              const market = `DA_${z}`;
              const cachedTs = new Set(cachedPoints.map((p) => p.ts));
              const rows = livePoints
                .filter((p) => Number.isFinite(p.price) && !cachedTs.has(p.ts))
                .map((p) => ({
                  datetime: p.ts,
                  market,
                  price_eur_mwh: p.price,
                  source: "ENTSO-E",
                }));
              if (rows.length) {
                // Chunk inserts to keep payloads reasonable.
                const CHUNK = 500;
                for (let i = 0; i < rows.length; i += CHUNK) {
                  await supabaseAdmin
                    .from("market_prices_hourly")
                    .upsert(rows.slice(i, i + CHUNK), { onConflict: "datetime,market" });
                }
              }
            } catch {
              // Cache persistence is best-effort; do not fail the request.
            }
          }
          points = mergeDaPricePoints(points, livePoints);
          source = live.source === "empty" && points.length ? source : live.source;
          reason = live.reason;
          fetchedAt = live.fetched_at;
          if (points.length && !hasCompletePriceCoverage(points, days)) {
            reason = reason ?? "partial_market_price_coverage";
          }
        }
        const stats = calculatePricePeriodStats(points, days);
        return {
          zone: z,
          profile: stats.hourlyProfile,
          stats,
          source,
          reason,
          fetched_at: fetchedAt,
        };
      }),
      8,
    );
    const out = zones.map((z, index) => {
      const result = outResults[index];
      return result.status === "fulfilled"
        ? result.value
        : {
            zone: z,
            profile: new Array<number | null>(24).fill(null),
            stats: calculatePricePeriodStats([], days),
            source: "empty" as const,
            reason: result.reason instanceof Error ? result.reason.message : "error",
            fetched_at: new Date().toISOString(),
          };
    });
    return { from: days[0], to: days[days.length - 1], zones, rows: out };
  });

export const validatePriceMarkets = createServerFn({ method: "GET" })
  .inputValidator((data: { day?: string }) => data ?? {})
  .handler(async ({ data }) => {
    const day = clean(data?.day) ?? offsetISO(-1);
    const results = await allSettledBounded(
      PRICE_MARKET_CODES.map((market) => () => validatePriceMarket(market, day)),
    );
    return {
      day,
      rows: PRICE_MARKET_CODES.map((market, index) => {
        const result = results[index];
        return result.status === "fulfilled"
          ? result.value
          : {
              market,
              eic: "",
              intervals: 0,
              intervalResolutionMinutes: null,
              firstTimestamp: null,
              lastTimestamp: null,
              source: "empty" as const,
              reason: result.reason instanceof Error ? result.reason.message : "error",
            };
      }),
    };
  });
