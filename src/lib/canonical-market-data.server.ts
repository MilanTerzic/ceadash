import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { readCanonicalPriceCache, writeCanonicalPriceCache } from "./interval-price-cache.server";
import type { ZoneCode, ProductType } from "./markets";
import type { PriceMarketCode } from "./price-markets";
import type { PricePoint } from "./trading-calculations";

const db = supabaseAdmin as any;

export type CanonicalFlowPoint = {
  ts: string;
  mw: number;
  durationMinutes: number;
};

export type CanonicalCapacity = {
  delivery_date: string;
  from_zone: ZoneCode;
  to_zone: ZoneCode;
  product: ProductType;
  price_eur_mwh: number | null;
  offered_mw: number | null;
  allocated_mw: number | null;
  unit_warning: string | null;
  source: string;
  fetched_at: string;
};

export type IngestionStatus = {
  dataset: string;
  status: "ok" | "partial" | "error";
  last_attempt_at: string;
  last_success_at: string | null;
  rows_written: number;
  source: string | null;
  error: string | null;
  details: Record<string, unknown>;
};

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

function addDaysISO(dayISO: string, days: number): string {
  const date = new Date(`${dayISO}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function belgradeDayBoundaryUtc(dayISO: string): Date {
  const [year, month, day] = dayISO.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, -belgradeOffsetHours(dayISO), 0, 0, 0));
}

export function canonicalRangeUtc(fromDay: string, toDay: string) {
  return {
    fromUtc: belgradeDayBoundaryUtc(fromDay).toISOString(),
    toUtc: belgradeDayBoundaryUtc(addDaysISO(toDay, 1)).toISOString(),
  };
}

export async function readCanonicalPrices(
  zone: PriceMarketCode,
  fromDay: string,
  toDay: string,
): Promise<{ points: PricePoint[]; cacheSource: "interval" | "legacy-hourly" | "empty" }> {
  const { fromUtc, toUtc } = canonicalRangeUtc(fromDay, toDay);
  const result = await readCanonicalPriceCache(db, `DA_${zone}`, fromUtc, toUtc);
  return { points: result.points, cacheSource: result.source };
}

export async function persistCanonicalPrices(
  zone: PriceMarketCode,
  points: PricePoint[],
  source = "ENTSO-E",
) {
  return writeCanonicalPriceCache(db, `DA_${zone}`, points, source);
}

export async function readCanonicalFlows(
  from: ZoneCode,
  to: ZoneCode,
  fromDay: string,
  toDay: string,
): Promise<{
  points: CanonicalFlowPoint[];
  source: "cache" | "empty";
  fetched_at: string | null;
}> {
  const { fromUtc, toUtc } = canonicalRangeUtc(fromDay, toDay);
  const pageSize = 1000;
  const rows: Array<{
    datetime: string;
    flow_mw: number | string | null;
    duration_minutes?: number | null;
    fetched_at?: string | null;
  }> = [];

  for (let offset = 0; ; offset += pageSize) {
    const response = await db
      .from("cross_border_flows_hourly")
      .select("datetime, flow_mw, duration_minutes, fetched_at")
      .eq("from_zone", from)
      .eq("to_zone", to)
      .gte("datetime", fromUtc)
      .lt("datetime", toUtc)
      .order("datetime", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (response.error) return { points: [], source: "empty", fetched_at: null };
    const chunk = response.data ?? [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }

  const points = rows
    .map((row) => ({
      ts: new Date(row.datetime).toISOString(),
      mw: Number(row.flow_mw),
      durationMinutes: Number(row.duration_minutes ?? 60),
    }))
    .filter(
      (point) =>
        Number.isFinite(point.mw) &&
        [15, 30, 60].includes(point.durationMinutes) &&
        !Number.isNaN(Date.parse(point.ts)),
    );

  const fetched_at = rows
    .map((row) => row.fetched_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  return { points, source: points.length ? "cache" : "empty", fetched_at };
}

export async function persistCanonicalFlows(
  from: ZoneCode,
  to: ZoneCode,
  points: CanonicalFlowPoint[],
  source = "ENTSO-E",
) {
  const fetchedAt = new Date().toISOString();
  const rows = points
    .filter(
      (point) =>
        Number.isFinite(point.mw) &&
        [15, 30, 60].includes(point.durationMinutes) &&
        !Number.isNaN(Date.parse(point.ts)),
    )
    .map((point) => ({
      datetime: new Date(point.ts).toISOString(),
      from_zone: from,
      to_zone: to,
      flow_mw: point.mw,
      duration_minutes: point.durationMinutes,
      source,
      fetched_at: fetchedAt,
    }));

  const chunkSize = 500;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const response = await db
      .from("cross_border_flows_hourly")
      .upsert(rows.slice(index, index + chunkSize), {
        onConflict: "datetime,from_zone,to_zone",
      });
    if (response.error) throw response.error;
  }
  return rows.length;
}

export async function readCanonicalCapacity(
  from: ZoneCode,
  to: ZoneCode,
  product: ProductType,
  dayISO: string,
): Promise<CanonicalCapacity | null> {
  const response = await db
    .from("capacity_observations")
    .select(
      "delivery_date, from_zone, to_zone, product, price_eur_mwh, offered_mw, allocated_mw, unit_warning, source, fetched_at",
    )
    .eq("delivery_date", dayISO)
    .eq("from_zone", from)
    .eq("to_zone", to)
    .eq("product", product)
    .maybeSingle();
  if (response.error || !response.data) return null;
  const row = response.data;
  return {
    delivery_date: String(row.delivery_date),
    from_zone: row.from_zone as ZoneCode,
    to_zone: row.to_zone as ZoneCode,
    product: row.product as ProductType,
    price_eur_mwh: row.price_eur_mwh == null ? null : Number(row.price_eur_mwh),
    offered_mw: row.offered_mw == null ? null : Number(row.offered_mw),
    allocated_mw: row.allocated_mw == null ? null : Number(row.allocated_mw),
    unit_warning: row.unit_warning ?? null,
    source: String(row.source ?? "ENTSO-E"),
    fetched_at: String(row.fetched_at),
  };
}

export async function persistCanonicalCapacity(input: {
  deliveryDate: string;
  from: ZoneCode;
  to: ZoneCode;
  product: ProductType;
  price_eur_mwh: number | null;
  offered_mw: number | null;
  allocated_mw: number | null;
  unit_warning?: string;
  source?: string;
}) {
  const response = await db.from("capacity_observations").upsert(
    {
      delivery_date: input.deliveryDate,
      from_zone: input.from,
      to_zone: input.to,
      product: input.product,
      price_eur_mwh: input.price_eur_mwh,
      offered_mw: input.offered_mw,
      allocated_mw: input.allocated_mw,
      unit_warning: input.unit_warning ?? null,
      source: input.source ?? "ENTSO-E",
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "delivery_date,from_zone,to_zone,product" },
  );
  if (response.error) throw response.error;
}

export async function updateIngestionStatus(input: {
  dataset: string;
  status: "ok" | "partial" | "error";
  rowsWritten?: number;
  source?: string;
  error?: string | null;
  details?: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  const row = {
    dataset: input.dataset,
    status: input.status,
    last_attempt_at: now,
    last_success_at: input.status === "error" ? undefined : now,
    rows_written: input.rowsWritten ?? 0,
    source: input.source ?? null,
    error: input.error ?? null,
    details: input.details ?? {},
  };
  const response = await db.from("data_ingestion_status").upsert(row, { onConflict: "dataset" });
  if (response.error) throw response.error;
}

export async function readIngestionStatus(): Promise<IngestionStatus[]> {
  const response = await db
    .from("data_ingestion_status")
    .select(
      "dataset, status, last_attempt_at, last_success_at, rows_written, source, error, details",
    )
    .order("dataset", { ascending: true });
  if (response.error) return [];
  return (response.data ?? []) as IngestionStatus[];
}
