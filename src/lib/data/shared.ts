import { expectedIntervalsForBelgradeDay, type PricePoint } from "../trading-calculations";
import { isValidIsoDate } from "../fundamentals";
import { calculatePricePeriodStats } from "../price-analysis";
import { PRICE_MARKET_CODES } from "../price-markets";

export const belgradeDateISO = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
};
export const todayISO = () => belgradeDateISO();
export const offsetISO = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return belgradeDateISO(date);
};

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const clean = (v?: string) => (v && ISO_DATE_RE.test(v) ? v : undefined);

export function addDaysISO(dayISO: string, days: number): string {
  const date = new Date(`${dayISO}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function belgradeOffsetHours(dayISO: string): number {
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

export function belgradeDayBoundaryUtc(dayISO: string): Date {
  const [year, month, day] = dayISO.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, -belgradeOffsetHours(dayISO), 0, 0, 0));
}

export function expandRange(fromIn?: string, toIn?: string, dayIn?: string): string[] {
  const from = clean(fromIn);
  const to = clean(toIn);
  const day = clean(dayIn);
  if (!from && !to && !day) return [todayISO()];
  if (from && to) {
    const s = new Date(from + "T00:00:00Z").getTime();
    const e = new Date(to + "T00:00:00Z").getTime();
    if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return [from];
    const out: string[] = [];
    const max = Math.min(e, s + 365 * 86400_000); // cap at ~1 year
    for (let t = s; t <= max; t += 86400_000) out.push(new Date(t).toISOString().slice(0, 10));
    return out;
  }
  return [day ?? from ?? to ?? todayISO()];
}

export type RangeInput = { day?: string; from?: string; to?: string; force?: boolean };

export function requestedRange(data: RangeInput | undefined): { from: string; to: string } {
  const fallback = todayISO();
  const day = data?.day && isValidIsoDate(data.day) ? data.day : undefined;
  const from = data?.from && isValidIsoDate(data.from) ? data.from : (day ?? fallback);
  const to = data?.to && isValidIsoDate(data.to) ? data.to : (day ?? from);
  return { from, to };
}

export const DA_ZONES = PRICE_MARKET_CODES;

export type CachedDaPriceRow = {
  datetime: string;
  price_eur_mwh: number | string | null;
};

export async function readCachedDaPricePoints(
  supabaseAdmin: (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"],
  zone: (typeof DA_ZONES)[number],
  fromDay: string,
  toDay: string,
): Promise<PricePoint[]> {
  const fromUtc = belgradeDayBoundaryUtc(fromDay).toISOString();
  const toUtc = belgradeDayBoundaryUtc(addDaysISO(toDay, 1)).toISOString();
  const market = `DA_${zone}`;
  const pageSize = 1000;
  const rows: CachedDaPriceRow[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const res = await supabaseAdmin
      .from("market_prices_hourly")
      .select("datetime, price_eur_mwh")
      .eq("market", market)
      .gte("datetime", fromUtc)
      .lt("datetime", toUtc)
      .order("datetime", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (res.error) return [];
    const chunk = (res.data ?? []) as CachedDaPriceRow[];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return rows
    .map((row) => ({
      ts: new Date(row.datetime).toISOString(),
      price: Number(row.price_eur_mwh),
      durationMinutes: 60 as const,
    }))
    .filter((point) => Number.isFinite(point.price))
    .sort((a, b) => a.ts.localeCompare(b.ts));
}

export function mergeDaPricePoints(...groups: PricePoint[][]): PricePoint[] {
  const byTs = new Map<string, PricePoint>();
  for (const group of groups) {
    for (const point of group) {
      if (!Number.isFinite(point.price)) continue;
      const timestamp = new Date(point.ts);
      if (Number.isNaN(timestamp.getTime())) continue;
      timestamp.setUTCMinutes(0, 0, 0);
      byTs.set(timestamp.toISOString(), {
        ts: timestamp.toISOString(),
        price: point.price,
        durationMinutes: point.durationMinutes ?? 60,
      });
    }
  }
  return [...byTs.values()].sort((a, b) => a.ts.localeCompare(b.ts));
}

export function expectedPriceIntervals(days: string[]): number {
  return days.reduce((sum, day) => sum + expectedIntervalsForBelgradeDay(day, 60), 0);
}

export function hasCompletePriceCoverage(points: PricePoint[], days: string[]): boolean {
  if (!days.length) return points.length > 0;
  const stats = calculatePricePeriodStats(points, days);
  return (
    stats.receivedIntervals >= expectedPriceIntervals(days) && stats.completeDays === days.length
  );
}

export async function allSettledBounded<T>(
  tasks: Array<() => Promise<T>>,
  concurrency = 4,
): Promise<Array<PromiseSettledResult<T>>> {
  const out: Array<PromiseSettledResult<T>> = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      try {
        out[i] = { status: "fulfilled", value: await tasks[i]() };
      } catch (reason) {
        out[i] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return out;
}
