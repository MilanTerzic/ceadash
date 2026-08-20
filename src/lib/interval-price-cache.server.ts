import type { PricePoint } from "./trading-calculations";

export type IntervalPriceRow = {
  market: string;
  datetime: string;
  duration_minutes: number;
  price_eur_mwh: number | string;
  source?: string | null;
  fetched_at?: string | null;
};

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
