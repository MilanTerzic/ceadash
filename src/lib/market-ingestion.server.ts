import {
  fetchDayAheadPricesRange,
  fetchExplicitAllocation,
  fetchLoadGenRange,
  fetchOutagesRange,
  fetchPhysicalFlowsRange,
} from "./entsoe.server";
import { fetchWeatherRange } from "./openmeteo.server";
import {
  persistCanonicalCapacity,
  persistCanonicalFlows,
  persistCanonicalPrices,
  updateIngestionStatus,
} from "./canonical-market-data.server";
import { BORDERS, IMPORT_ROUTES, EXPORT_ROUTES, type ZoneCode } from "./markets";
import { PRICE_MARKET_CODES } from "./price-markets";
import type { PricePoint } from "./trading-calculations";

export type IngestionMode = "tail" | "history";
export type IngestionPipeline = "prices" | "flows" | "capacity" | "fundamentals";

type PipelineResult = {
  pipeline: IngestionPipeline;
  ok: boolean;
  succeeded: number;
  failed: number;
  rowsWritten: number;
  from: string;
  to: string;
  errors: string[];
  elapsedMs: number;
};

function todayBelgradeISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDaysISO(dayISO: string, days: number): string {
  const date = new Date(`${dayISO}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function ingestionWindow(mode: IngestionMode) {
  const today = todayBelgradeISO();
  return mode === "history"
    ? { from: addDaysISO(today, -7), to: addDaysISO(today, -1) }
    : { from: today, to: today };
}

async function runBounded<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(items.length);
  let cursor = 0;
  async function runner() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), Math.max(items.length, 1)) }, runner),
  );
  return results;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function ingestPrices(mode: IngestionMode): Promise<PipelineResult> {
  const startedAt = Date.now();
  const { from, to } = ingestionWindow(mode);
  const errors: string[] = [];
  let rowsWritten = 0;
  let succeeded = 0;

  const windows = mode === "tail" ? [from, addDaysISO(from, 1)] : [from];
  const tasks = PRICE_MARKET_CODES.flatMap((zone) => windows.map((day) => ({ zone, day })));
  const results = await runBounded(tasks, 4, async ({ zone, day }) => {
    const rangeTo = mode === "tail" ? day : to;
    const live = await fetchDayAheadPricesRange(zone, day, rangeTo, false, true);
    const points: PricePoint[] = live.data.points.map((point) => ({
      ts: point.ts,
      price: point.price,
      durationMinutes: point.durationMinutes,
    }));
    if (!points.length) {
      // D+1 not published yet is an expected empty state and must not poison today.
      if (mode === "tail" && day > from) return { rows: 0, emptyFuture: true };
      throw new Error(`${zone}:${day}:${live.reason ?? "no_data"}`);
    }
    const written = await persistCanonicalPrices(zone, points, "ENTSO-E");
    return { rows: written.wroteIntervalRows, emptyFuture: false };
  });

  for (const result of results) {
    if (result.status === "fulfilled") {
      if (!result.value.emptyFuture) succeeded += 1;
      rowsWritten += result.value.rows;
    } else {
      errors.push(errorText(result.reason));
    }
  }

  const expectedCurrent = PRICE_MARKET_CODES.length;
  const ok = succeeded > 0;
  const status = !ok ? "error" : errors.length || succeeded < expectedCurrent ? "partial" : "ok";
  await updateIngestionStatus({
    dataset: "day-ahead-prices",
    status,
    rowsWritten,
    source: "ENTSO-E A44",
    error: errors.length ? errors.slice(0, 8).join("; ") : null,
    details: { mode, from, to: mode === "tail" ? addDaysISO(from, 1) : to, succeeded, failed: errors.length },
  }).catch(() => undefined);

  return {
    pipeline: "prices",
    ok,
    succeeded,
    failed: errors.length,
    rowsWritten,
    from,
    to: mode === "tail" ? addDaysISO(from, 1) : to,
    errors,
    elapsedMs: Date.now() - startedAt,
  };
}

export async function ingestFlows(mode: IngestionMode): Promise<PipelineResult> {
  const startedAt = Date.now();
  const { from, to } = ingestionWindow(mode);
  const errors: string[] = [];
  let rowsWritten = 0;
  let succeeded = 0;

  const results = await runBounded(BORDERS, 4, async ([fromZone, toZone]) => {
    const live = await fetchPhysicalFlowsRange(fromZone, toZone, from, to, false, true);
    if (!live.data.points.length) {
      throw new Error(`${fromZone}->${toZone}:${live.reason ?? "no_data"}`);
    }
    const rows = await persistCanonicalFlows(
      fromZone,
      toZone,
      live.data.points.map((point) => ({
        ts: point.ts,
        mw: point.mw,
        durationMinutes: point.durationMinutes,
      })),
      "ENTSO-E",
    );
    return rows;
  });

  for (const result of results) {
    if (result.status === "fulfilled") {
      succeeded += 1;
      rowsWritten += result.value;
    } else {
      errors.push(errorText(result.reason));
    }
  }

  const ok = succeeded > 0;
  const status = !ok ? "error" : errors.length ? "partial" : "ok";
  await updateIngestionStatus({
    dataset: "physical-flows",
    status,
    rowsWritten,
    source: "ENTSO-E A11",
    error: errors.length ? errors.slice(0, 8).join("; ") : null,
    details: { mode, from, to, succeeded, failed: errors.length, routes: BORDERS.length },
  }).catch(() => undefined);

  return {
    pipeline: "flows",
    ok,
    succeeded,
    failed: errors.length,
    rowsWritten,
    from,
    to,
    errors,
    elapsedMs: Date.now() - startedAt,
  };
}

export async function ingestCapacity(mode: IngestionMode): Promise<PipelineResult> {
  const startedAt = Date.now();
  const { from, to } = ingestionWindow(mode);
  const errors: string[] = [];
  let rowsWritten = 0;
  let succeeded = 0;
  const routes = [...IMPORT_ROUTES, ...EXPORT_ROUTES];
  const days: string[] = [];
  for (
    let ts = Date.parse(`${from}T12:00:00Z`);
    ts <= Date.parse(`${to}T12:00:00Z`);
    ts += 86_400_000
  ) {
    days.push(new Date(ts).toISOString().slice(0, 10));
  }
  const tasks = routes.flatMap((route) => days.map((day) => ({ route, day })));

  const results = await runBounded(tasks, 4, async ({ route, day }) => {
    const live = await fetchExplicitAllocation(route.from, route.to, "daily", day, false, true);
    const hasData =
      live.data.price_eur_mwh != null ||
      live.data.offered_mw != null ||
      live.data.allocated_mw != null;
    if (!hasData) throw new Error(`${route.from}->${route.to}:${day}:${live.reason ?? "no_data"}`);
    await persistCanonicalCapacity({
      deliveryDate: day,
      from: route.from,
      to: route.to,
      product: "daily",
      price_eur_mwh: live.data.price_eur_mwh,
      offered_mw: live.data.offered_mw,
      allocated_mw: live.data.allocated_mw,
      unit_warning: live.data.unit_warning,
      source: "ENTSO-E",
    });
    return 1;
  });

  for (const result of results) {
    if (result.status === "fulfilled") {
      succeeded += 1;
      rowsWritten += result.value;
    } else {
      errors.push(errorText(result.reason));
    }
  }

  const ok = succeeded > 0;
  const status = !ok ? "error" : errors.length ? "partial" : "ok";
  await updateIngestionStatus({
    dataset: "daily-capacity",
    status,
    rowsWritten,
    source: "ENTSO-E A25",
    error: errors.length ? errors.slice(0, 8).join("; ") : null,
    details: { mode, from, to, succeeded, failed: errors.length },
  }).catch(() => undefined);

  return {
    pipeline: "capacity",
    ok,
    succeeded,
    failed: errors.length,
    rowsWritten,
    from,
    to,
    errors,
    elapsedMs: Date.now() - startedAt,
  };
}

export async function ingestFundamentals(mode: IngestionMode): Promise<PipelineResult> {
  const startedAt = Date.now();
  const { from, to } = ingestionWindow(mode);
  const zones: ZoneCode[] = ["RS", "HU", "RO", "BG", "HR", "ME", "MK", "AL"];
  const errors: string[] = [];
  let rowsWritten = 0;
  let succeeded = 0;

  const tasks: Array<() => Promise<number>> = [
    async () => {
      const result = await fetchLoadGenRange("RS", from, to, false, true);
      if (!result.data.length) throw new Error(`load-generation:${result.reason ?? "no_data"}`);
      return result.data.length;
    },
    ...zones.map(
      (zone) => async () => {
        const result = await fetchOutagesRange(zone, from, to, false, true);
        // A valid empty outage publication set is still a successful refresh.
        if (result.status === "error") throw new Error(`outages:${zone}:${result.reason ?? "error"}`);
        return result.data.length;
      },
    ),
    ...zones.map(
      (zone) => async () => {
        const result = await fetchWeatherRange(zone, from, to, true);
        if (result.status === "error") throw new Error(`weather:${zone}:${result.reason ?? "error"}`);
        return result.data.length;
      },
    ),
  ];

  const results = await runBounded(tasks, 3, async (task) => task());
  for (const result of results) {
    if (result.status === "fulfilled") {
      succeeded += 1;
      rowsWritten += result.value;
    } else {
      errors.push(errorText(result.reason));
    }
  }

  const ok = succeeded > 0;
  const status = !ok ? "error" : errors.length ? "partial" : "ok";
  await updateIngestionStatus({
    dataset: "system-fundamentals-cache",
    status,
    rowsWritten,
    source: "ENTSO-E + Open-Meteo",
    error: errors.length ? errors.slice(0, 8).join("; ") : null,
    details: {
      mode,
      from,
      to,
      succeeded,
      failed: errors.length,
      note: "Compatibility warm cache. Prices, flows and capacity use canonical tables.",
    },
  }).catch(() => undefined);

  return {
    pipeline: "fundamentals",
    ok,
    succeeded,
    failed: errors.length,
    rowsWritten,
    from,
    to,
    errors,
    elapsedMs: Date.now() - startedAt,
  };
}

export async function runIngestionPipeline(pipeline: IngestionPipeline, mode: IngestionMode) {
  switch (pipeline) {
    case "prices":
      return ingestPrices(mode);
    case "flows":
      return ingestFlows(mode);
    case "capacity":
      return ingestCapacity(mode);
    case "fundamentals":
      return ingestFundamentals(mode);
  }
}
