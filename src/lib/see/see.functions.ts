// Server functions for the regional SEE workspaces.
//
// Each call is deliberately small (a handful of markets or borders): the client fans out
// in batches, which keeps every invocation well inside serverless subrequest limits and
// lets panels fill in progressively. Results carry a per-series provenance status.
import { createServerFn } from "@tanstack/react-start";
import {
  fetchActualGenerationRange,
  fetchActualLoadRange,
  fetchDayAheadPricesRange,
  fetchExplicitAllocation,
  fetchForecastNtcRange,
  fetchLoadForecastRange,
  fetchPhysicalFlowsRange,
  fetchScheduledExchangesRange,
  fetchWindSolarForecastRange,
} from "../entsoe.server";
import { addDaysISO, allSettledBounded, clean, todayISO } from "../data/shared";
import { EMPTY_SERIES, toHourlySeries, type Series } from "./analytics";
import { BORDER_BY_ID, SEE_MARKETS, isSeeCode, type SeeCode } from "./registry";
import { failedStatus, toStatus, type FetchLike, type SeriesStatus } from "./status";
import type { ZoneCode } from "../markets";

export const MAX_PRICE_DAYS = 400;
export const MAX_FLOW_DAYS = 62;
export const MAX_BATCH = 6;

interface RangeInput {
  from?: string;
  to?: string;
}

function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000);
}

/** Validated range, clipped to `maxDays` ending at `to`. */
function resolveRange(input: RangeInput | undefined, maxDays: number) {
  const to = clean(input?.to) ?? todayISO();
  let from = clean(input?.from) ?? to;
  if (from > to) from = to;
  const requestedFrom = from;
  if (dayDiff(from, to) + 1 > maxDays) from = addDaysISO(to, -(maxDays - 1));
  return { from, to, clipped: from !== requestedFrom };
}

function seeCodes(value: unknown): SeeCode[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isSeeCode))].slice(0, MAX_BATCH);
}

export interface MarketPrices {
  series: Series;
  /** Resolution the provider published in, when uniform. */
  nativeMinutes: number | null;
  status: SeriesStatus;
}

/** Day-ahead prices, hourly, for up to MAX_BATCH markets. */
export const getSeePrices = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput & { codes?: string[] }) => data ?? {})
  .handler(async ({ data }) => {
    const range = resolveRange(data, MAX_PRICE_DAYS);
    const codes = seeCodes(data.codes).filter((code) => SEE_MARKETS[code].price !== null);
    const results = await allSettledBounded(
      codes.map(
        (code) => () => fetchDayAheadPricesRange(SEE_MARKETS[code].price!, range.from, range.to),
      ),
      MAX_BATCH,
    );
    const markets: Partial<Record<SeeCode, MarketPrices>> = {};
    codes.forEach((code, index) => {
      const result = results[index];
      if (result.status === "rejected") {
        markets[code] = {
          series: EMPTY_SERIES,
          nativeMinutes: null,
          status: failedStatus(result.reason),
        };
        return;
      }
      const points = result.value.data.points;
      const resolutions = new Set(points.map((point) => point.durationMinutes));
      markets[code] = {
        series: toHourlySeries(
          points.map((p) => ({ ts: p.ts, value: p.price, durationMinutes: p.durationMinutes })),
        ),
        nativeMinutes: resolutions.size === 1 ? [...resolutions][0] : null,
        status: toStatus(result.value),
      };
    });
    return { ...range, markets };
  });

export type FlowKind = "physical" | "scheduled" | "ntc";

export interface BorderSeries {
  /** a -> b, MW, hourly. */
  ab: Series;
  /** b -> a, MW, hourly. */
  ba: Series;
  statusAB: SeriesStatus;
  statusBA: SeriesStatus;
}

type DirectionalFetch = (
  from: ZoneCode,
  to: ZoneCode,
  fromISO: string,
  toISO: string,
) => Promise<{
  points: Array<{ ts: string; mw: number; durationMinutes: number }>;
  meta: FetchLike;
}>;

const FLOW_FETCHERS: Record<FlowKind, DirectionalFetch> = {
  physical: async (from, to, fromISO, toISO) => {
    const result = await fetchPhysicalFlowsRange(from, to, fromISO, toISO);
    return { points: result.data.points, meta: result };
  },
  scheduled: async (from, to, fromISO, toISO) => {
    const result = await fetchScheduledExchangesRange(from, to, fromISO, toISO);
    return { points: result.data, meta: result };
  },
  ntc: async (from, to, fromISO, toISO) => {
    const result = await fetchForecastNtcRange(from, to, fromISO, toISO);
    return { points: result.data, meta: result };
  },
};

/**
 * Directional MW series for up to MAX_BATCH borders.
 * kind "physical": measured cross-border physical flows.
 * kind "scheduled": scheduled commercial exchanges (a different quantity, never mixed).
 * kind "ntc": day-ahead forecast net transfer capacity.
 */
export const getSeeBorderSeries = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput & { ids?: string[]; kind?: FlowKind }) => data ?? {})
  .handler(async ({ data }) => {
    const range = resolveRange(data, MAX_FLOW_DAYS);
    const kind: FlowKind = data.kind && data.kind in FLOW_FETCHERS ? data.kind : "physical";
    const fetcher = FLOW_FETCHERS[kind];
    const ids = [...new Set((data.ids ?? []).filter((id) => id in BORDER_BY_ID))].slice(
      0,
      MAX_BATCH,
    );
    const tasks = ids.flatMap((id) => {
      const { a, b } = BORDER_BY_ID[id];
      const za = SEE_MARKETS[a].zone;
      const zb = SEE_MARKETS[b].zone;
      return [
        () => fetcher(za, zb, range.from, range.to),
        () => fetcher(zb, za, range.from, range.to),
      ];
    });
    const results = await allSettledBounded(tasks, MAX_BATCH);
    const unpack = (index: number): { series: Series; status: SeriesStatus } => {
      const result = results[index];
      if (result.status === "rejected") {
        return { series: EMPTY_SERIES, status: failedStatus(result.reason) };
      }
      return {
        series: toHourlySeries(
          result.value.points.map((p) => ({
            ts: p.ts,
            value: p.mw,
            durationMinutes: p.durationMinutes,
          })),
        ),
        status: toStatus(result.value.meta),
      };
    };
    const borders: Record<string, BorderSeries> = {};
    ids.forEach((id, index) => {
      const ab = unpack(index * 2);
      const ba = unpack(index * 2 + 1);
      borders[id] = { ab: ab.series, ba: ba.series, statusAB: ab.status, statusBA: ba.status };
    });
    return { ...range, kind, borders };
  });

export interface CapacityAuction {
  /** Auction clearing price, EUR/MWh of transfer right; null when not published. */
  price: number | null;
  offeredMW: number | null;
  allocatedMW: number | null;
  status: SeriesStatus;
}

/** Daily explicit capacity auction results for one delivery day, both directions. */
export const getSeeCapacity = createServerFn({ method: "GET" })
  .inputValidator((data: { day?: string; ids?: string[] }) => data ?? {})
  .handler(async ({ data }) => {
    const day = clean(data.day) ?? todayISO();
    const ids = [
      ...new Set(
        (data.ids ?? []).filter(
          (id) => id in BORDER_BY_ID && BORDER_BY_ID[id].allocation === "explicit",
        ),
      ),
    ].slice(0, MAX_BATCH);
    const tasks = ids.flatMap((id) => {
      const { a, b } = BORDER_BY_ID[id];
      const za = SEE_MARKETS[a].zone;
      const zb = SEE_MARKETS[b].zone;
      return [
        () => fetchExplicitAllocation(za, zb, "daily", day),
        () => fetchExplicitAllocation(zb, za, "daily", day),
      ];
    });
    // Each allocation issues two provider requests, so run fewer in parallel.
    const results = await allSettledBounded(tasks, 4);
    const unpack = (index: number): CapacityAuction => {
      const result = results[index];
      if (result.status === "rejected") {
        return {
          price: null,
          offeredMW: null,
          allocatedMW: null,
          status: failedStatus(result.reason),
        };
      }
      const row = result.value.data;
      return {
        price: row.price_eur_mwh,
        offeredMW: row.offered_mw,
        allocatedMW: row.allocated_mw,
        status: toStatus(result.value),
      };
    };
    const borders: Record<string, { ab: CapacityAuction; ba: CapacityAuction }> = {};
    ids.forEach((id, index) => {
      borders[id] = { ab: unpack(index * 2), ba: unpack(index * 2 + 1) };
    });
    return { day, borders };
  });

export interface MarketFundamentals {
  load: Series;
  loadForecast: Series;
  /** Actual generation per ENTSO-E production type code (B01..B20), MW hourly. */
  generation: Record<string, Series>;
  /** Day-ahead wind and solar forecast per production type code. */
  resForecast: Record<string, Series>;
  status: {
    load: SeriesStatus;
    loadForecast: SeriesStatus;
    generation: SeriesStatus;
    resForecast: SeriesStatus;
  };
}

/** Load, generation mix and day-ahead forecasts for one market. */
export const getSeeFundamentals = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput & { code?: string }) => data ?? {})
  .handler(async ({ data }) => {
    const range = resolveRange(data, MAX_FLOW_DAYS);
    const code: SeeCode = isSeeCode(data.code) ? data.code : "RS";
    const zone = SEE_MARKETS[code].zone;
    const [load, loadFc, gen, resFc] = await Promise.allSettled([
      fetchActualLoadRange(zone, range.from, range.to),
      fetchLoadForecastRange(zone, range.from, range.to),
      fetchActualGenerationRange(zone, range.from, range.to),
      fetchWindSolarForecastRange(zone, range.from, range.to),
    ]);

    const byType = (
      points: Array<{ ts: string; durationMinutes: number; type: string; mw: number }>,
    ) => {
      const groups = new Map<
        string,
        Array<{ ts: string; value: number; durationMinutes: number }>
      >();
      for (const p of points) {
        const group = groups.get(p.type) ?? [];
        group.push({ ts: p.ts, value: p.mw, durationMinutes: p.durationMinutes });
        groups.set(p.type, group);
      }
      return Object.fromEntries(
        [...groups.entries()].map(([type, g]) => [type, toHourlySeries(g)]),
      );
    };

    const fundamentals: MarketFundamentals = {
      load:
        load.status === "fulfilled"
          ? toHourlySeries(
              load.value.data.points.map((p) => ({
                ts: p.ts,
                value: p.load_mw,
                durationMinutes: p.durationMinutes,
              })),
            )
          : EMPTY_SERIES,
      loadForecast:
        loadFc.status === "fulfilled"
          ? toHourlySeries(
              loadFc.value.data.map((p) => ({
                ts: p.ts,
                value: p.mw,
                durationMinutes: p.durationMinutes,
              })),
            )
          : EMPTY_SERIES,
      generation:
        gen.status === "fulfilled"
          ? byType(
              gen.value.data.points.flatMap((p) =>
                Object.entries(p.production ?? {}).map(([type, mw]) => ({
                  ts: p.ts,
                  durationMinutes: p.durationMinutes,
                  type,
                  mw,
                })),
              ),
            )
          : {},
      resForecast:
        resFc.status === "fulfilled"
          ? byType(
              resFc.value.data.map((p) => ({
                ts: p.ts,
                durationMinutes: p.durationMinutes,
                type: p.productionType ?? "unclassified",
                mw: p.mw,
              })),
            )
          : {},
      status: {
        load: load.status === "fulfilled" ? toStatus(load.value) : failedStatus(load.reason),
        loadForecast:
          loadFc.status === "fulfilled" ? toStatus(loadFc.value) : failedStatus(loadFc.reason),
        generation: gen.status === "fulfilled" ? toStatus(gen.value) : failedStatus(gen.reason),
        resForecast:
          resFc.status === "fulfilled" ? toStatus(resFc.value) : failedStatus(resFc.reason),
      },
    };
    return { ...range, code, fundamentals };
  });
