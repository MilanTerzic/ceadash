// Client data hooks for the regional workspaces. Requests fan out in small batches
// (see MAX_BATCH) and are merged, so a panel fills in as batches arrive.
import { useQueries, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";

import { useDateRange } from "@/lib/date-range";
import { PRICED_CODES, SEE_BORDERS, type SeeCode } from "./registry";
import {
  getSeeBorderSeries,
  getSeeCapacity,
  getSeeFundamentals,
  getSeePrices,
  type BorderSeries,
  type CapacityAuction,
  type FlowKind,
  type MarketPrices,
} from "./see.functions";

const BATCH = 5;
const STALE = 10 * 60 * 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface Loadable<T> {
  data: T;
  /** No batch has arrived yet. */
  isLoading: boolean;
  /** Some batches are still in flight. */
  isFetching: boolean;
  /** Batches that failed at transport level (the server function itself threw). */
  failedBatches: number;
  refetch: () => void;
}

/** Hourly day-ahead prices for the given markets over the shell's date range. */
export function useSeePrices(
  codes: SeeCode[] = PRICED_CODES,
  rangeOverride?: { from: string; to: string },
): Loadable<Partial<Record<SeeCode, MarketPrices>>> {
  const shellRange = useDateRange().range;
  const range = rangeOverride ?? shellRange;
  const fn = useServerFn(getSeePrices);
  const key = codes.join(",");
  const batches = useMemo(() => chunk(key ? (key.split(",") as SeeCode[]) : [], BATCH), [key]);
  const results = useQueries({
    queries: batches.map((batch) => ({
      queryKey: ["see-prices", range.from, range.to, batch.join(",")],
      queryFn: () => fn({ data: { from: range.from, to: range.to, codes: batch } }),
      staleTime: STALE,
    })),
  });
  const stamp = results.map((r) => r.dataUpdatedAt).join(",");
  const data = useMemo(() => {
    const merged: Partial<Record<SeeCode, MarketPrices>> = {};
    for (const result of results) Object.assign(merged, result.data?.markets ?? {});
    return merged;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);
  return {
    data,
    isLoading: results.length > 0 && results.every((r) => r.isLoading),
    isFetching: results.some((r) => r.isFetching),
    failedBatches: results.filter((r) => r.isError).length,
    refetch: () => results.forEach((r) => void r.refetch()),
  };
}

/** Directional MW series for borders. `enabled` lets a layer load only when shown. */
export function useBorderSeries(
  kind: FlowKind,
  ids: string[] = SEE_BORDERS.map((border) => border.id),
  enabled = true,
): Loadable<Record<string, BorderSeries>> & { clipped: boolean; from: string | null } {
  const { range } = useDateRange();
  const fn = useServerFn(getSeeBorderSeries);
  const key = ids.join(",");
  const batches = useMemo(() => chunk(key ? key.split(",") : [], BATCH), [key]);
  const results = useQueries({
    queries: batches.map((batch) => ({
      queryKey: ["see-border-series", kind, range.from, range.to, batch.join(",")],
      queryFn: () => fn({ data: { from: range.from, to: range.to, ids: batch, kind } }),
      staleTime: STALE,
      enabled,
    })),
  });
  const stamp = results.map((r) => r.dataUpdatedAt).join(",");
  const data = useMemo(() => {
    const merged: Record<string, BorderSeries> = {};
    for (const result of results) Object.assign(merged, result.data?.borders ?? {});
    return merged;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);
  const first = results.find((r) => r.data)?.data;
  return {
    data,
    isLoading: enabled && results.length > 0 && results.every((r) => r.isLoading),
    isFetching: results.some((r) => r.isFetching),
    failedBatches: results.filter((r) => r.isError).length,
    refetch: () => results.forEach((r) => void r.refetch()),
    clipped: Boolean(first?.clipped),
    from: first?.from ?? null,
  };
}

/** Daily explicit capacity auction results for the last day of the shell range. */
export function useSeeCapacity(
  ids: string[],
  enabled = true,
): Loadable<Record<string, { ab: CapacityAuction; ba: CapacityAuction }>> & { day: string } {
  const { range } = useDateRange();
  const fn = useServerFn(getSeeCapacity);
  const key = ids.join(",");
  const batches = useMemo(() => chunk(key ? key.split(",") : [], BATCH), [key]);
  const results = useQueries({
    queries: batches.map((batch) => ({
      queryKey: ["see-capacity", range.to, batch.join(",")],
      queryFn: () => fn({ data: { day: range.to, ids: batch } }),
      staleTime: STALE,
      enabled,
    })),
  });
  const stamp = results.map((r) => r.dataUpdatedAt).join(",");
  const data = useMemo(() => {
    const merged: Record<string, { ab: CapacityAuction; ba: CapacityAuction }> = {};
    for (const result of results) Object.assign(merged, result.data?.borders ?? {});
    return merged;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);
  return {
    data,
    day: range.to,
    isLoading: enabled && results.length > 0 && results.every((r) => r.isLoading),
    isFetching: results.some((r) => r.isFetching),
    failedBatches: results.filter((r) => r.isError).length,
    refetch: () => results.forEach((r) => void r.refetch()),
  };
}

export function useSeeFundamentals(code: SeeCode | null) {
  const { range } = useDateRange();
  const fn = useServerFn(getSeeFundamentals);
  return useQuery({
    queryKey: ["see-fundamentals", code, range.from, range.to],
    queryFn: () => fn({ data: { from: range.from, to: range.to, code: code ?? undefined } }),
    staleTime: STALE,
    enabled: code !== null,
  });
}

/** Fundamentals for several markets at once (generation-mix map layer). */
export function useSeeFundamentalsMany(codes: SeeCode[], enabled: boolean) {
  const { range } = useDateRange();
  const fn = useServerFn(getSeeFundamentals);
  const results = useQueries({
    queries: codes.map((code) => ({
      queryKey: ["see-fundamentals", code, range.from, range.to],
      queryFn: () => fn({ data: { from: range.from, to: range.to, code } }),
      staleTime: STALE,
      enabled,
    })),
  });
  const stamp = results.map((r) => r.dataUpdatedAt).join(",");
  const data = useMemo(() => {
    const merged: Partial<
      Record<SeeCode, NonNullable<(typeof results)[number]["data"]>["fundamentals"]>
    > = {};
    results.forEach((result, index) => {
      if (result.data) merged[codes[index]] = result.data.fundamentals;
    });
    return merged;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);
  return {
    data,
    isLoading: enabled && results.length > 0 && results.every((r) => r.isLoading),
    isFetching: results.some((r) => r.isFetching),
  };
}
