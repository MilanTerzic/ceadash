import type { PricePoint } from "./trading-calculations";

export type IntervalPriceRow = {
  market: string;
  datetime: string;
  duration_minutes: number;
  price_eur_mwh: number | string;
  source?: string | null;
  fetched_at?: string | null;
};

export type LegacyHourlyPriceRow = {
  datetime: string;
  price_eur_mwh: number | string | null;
};

const SDAC_15_MIN_CUTOVER_ISO = "2025-10-01T00:00:00.000Z";
const KNOWN_HOURLY_MARKETS_AFTER_CUTOVER = new Set(["DA_RS"]);

/**
 * Legacy rows have no duration metadata. After the SDAC 15-minute cutover we
 * only trust that table for markets explicitly known to remain hourly. Other
 * markets must be re-fetched and written to market_price_intervals so old rows
 * created by destructive hourly rounding can never become authoritative again.
 */
export function canUseLegacyHourlyFallback(
  market: string,
  fromIso: string,
  toIso: string,
): boolean {
  if (KNOWN_HOURLY_MARKETS_AFTER_CUTOVER.has(market)) return true;
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  const cutover = Date.parse(SDAC_15_MIN_CUTOVER_ISO);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
  return to <= cutover;
}

export function dedupeIntervalPoints(points: PricePoint[]): PricePoint[] {
  const byTimestamp = new Map<string, PricePoint>();
  for (const point of points) {
    if (!Number.isFinite(point.price)) continue;
    const ts = new Date(point.ts);
    if (Number.isNaN(ts.getTime())) continue;
    const durationMinutes = Number(point.durationMinutes ?? 60);
    if (![15, 30, 60].includes(durationMinutes)) continue;
    byTimestamp.set(ts.toISOString(), {
      ts: ts.toISOString(),
      price: point.price,
      durationMinutes,
    });
  }
  return [...byTimestamp.values()].sort((a, b) => a.ts.localeCompare(b.ts));
}

export function toIntervalRows(
  market: string,
  points: PricePoint[],
  source = "ENTSO-E",
): IntervalPriceRow[] {
  return dedupeIntervalPoints(points).map((point) => ({
    market,
    datetime: point.ts,
    duration_minutes: point.durationMinutes ?? 60,
    price_eur_mwh: point.price,
    source,
  }));
}

export function fromIntervalRows(rows: IntervalPriceRow[]): PricePoint[] {
  return rows
    .map((row) => ({
      ts: new Date(row.datetime).toISOString(),
      price: Number(row.price_eur_mwh),
      durationMinutes: Number(row.duration_minutes),
    }))
    .filter(
      (point) =>
        Number.isFinite(point.price) &&
        [15, 30, 60].includes(point.durationMinutes) &&
        !Number.isNaN(new Date(point.ts).getTime()),
    )
    .sort((a, b) => a.ts.localeCompare(b.ts));
}

export function fromLegacyHourlyRows(rows: LegacyHourlyPriceRow[]): PricePoint[] {
  return rows
    .map((row) => ({
      ts: new Date(row.datetime).toISOString(),
      price: Number(row.price_eur_mwh),
      durationMinutes: 60,
    }))
    .filter((point) => Number.isFinite(point.price) && !Number.isNaN(Date.parse(point.ts)))
    .sort((a, b) => a.ts.localeCompare(b.ts));
}

export async function readIntervalPriceCache(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  market: string,
  fromIso: string,
  toIso: string,
): Promise<PricePoint[]> {
  const pageSize = 1000;
  const rows: IntervalPriceRow[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const response = await supabaseAdmin
      .from("market_price_intervals")
      .select("market, datetime, duration_minutes, price_eur_mwh, source, fetched_at")
      .eq("market", market)
      .gte("datetime", fromIso)
      .lt("datetime", toIso)
      .order("datetime", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (response.error) return [];
    const chunk = (response.data ?? []) as IntervalPriceRow[];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return fromIntervalRows(rows);
}

async function readLegacyHourlyPriceCache(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  market: string,
  fromIso: string,
  toIso: string,
): Promise<PricePoint[]> {
  const pageSize = 1000;
  const rows: LegacyHourlyPriceRow[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const response = await supabaseAdmin
      .from("market_prices_hourly")
      .select("datetime, price_eur_mwh")
      .eq("market", market)
      .gte("datetime", fromIso)
      .lt("datetime", toIso)
      .order("datetime", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (response.error) return [];
    const chunk = (response.data ?? []) as LegacyHourlyPriceRow[];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return fromLegacyHourlyRows(rows);
}

/**
 * Canonical read path for mixed-resolution DA prices.
 *
 * New interval rows are authoritative. The old hourly table is consulted only
 * when it is safe to do so. For non-Serbian markets after the SDAC 15-minute
 * cutover, an empty interval cache intentionally returns empty so the caller
 * re-fetches the source and lazily rebuilds canonical interval rows.
 */
export async function readCanonicalPriceCache(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  market: string,
  fromIso: string,
  toIso: string,
): Promise<{ points: PricePoint[]; source: "interval" | "legacy-hourly" | "empty" }> {
  const interval = await readIntervalPriceCache(supabaseAdmin, market, fromIso, toIso);
  if (interval.length) return { points: interval, source: "interval" };
  if (!canUseLegacyHourlyFallback(market, fromIso, toIso)) {
    return { points: [], source: "empty" };
  }
  const legacy = await readLegacyHourlyPriceCache(supabaseAdmin, market, fromIso, toIso);
  if (legacy.length) return { points: legacy, source: "legacy-hourly" };
  return { points: [], source: "empty" };
}

export async function writeIntervalPriceCache(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  market: string,
  points: PricePoint[],
  source = "ENTSO-E",
): Promise<void> {
  const rows = toIntervalRows(market, points, source);
  const chunkSize = 500;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const response = await supabaseAdmin
      .from("market_price_intervals")
      .upsert(rows.slice(index, index + chunkSize), { onConflict: "market,datetime" });
    if (response.error) throw response.error;
  }
}

/**
 * Preserve the old hourly cache only for genuinely hourly series. Mixed or
 * quarter-hour series are written exclusively to the canonical interval table.
 */
export async function writeCanonicalPriceCache(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  market: string,
  points: PricePoint[],
  source = "ENTSO-E",
): Promise<{ wroteIntervalRows: number; wroteLegacyHourlyRows: number }> {
  const clean = dedupeIntervalPoints(points);
  await writeIntervalPriceCache(supabaseAdmin, market, clean, source);

  const allHourly = clean.length > 0 && clean.every((point) => (point.durationMinutes ?? 60) === 60);
  if (!allHourly) {
    return { wroteIntervalRows: clean.length, wroteLegacyHourlyRows: 0 };
  }

  const rows = clean.map((point) => ({
    market,
    datetime: point.ts,
    price_eur_mwh: point.price,
    source,
  }));
  const chunkSize = 500;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const response = await supabaseAdmin
      .from("market_prices_hourly")
      .upsert(rows.slice(index, index + chunkSize), { onConflict: "market,datetime" });
    if (response.error) throw response.error;
  }
  return { wroteIntervalRows: clean.length, wroteLegacyHourlyRows: rows.length };
}
