import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * SEEPEX Serbia day-ahead price fetcher (ENTSO-E Transparency Platform).
 *
 * Structure mirrors the proven Power Pulse Serbia implementation:
 *  - One request PER DELIVERY DAY, with the periodStart/periodEnd window aligned
 *    to the Belgrade local-day boundary (CET = UTC+1, CEST = UTC+2).
 *  - XML is parsed via TimeSeries → Period → Point, with timestamps derived from
 *    the Period <start> + (position-1) * resolution. Forward-fill is applied so
 *    A03 SequentialFixedSizeBlock curves keep the last-known value across gaps.
 *  - Returned points are filtered to the exact 24-hour Belgrade delivery day.
 *  - Cache table `market_prices_hourly` is upserted day-by-day.
 *
 * Range strategy: refresh today + tomorrow always (so we pick up SDAC at ~13:00
 * CET), plus any missing past days back ~14 days.
 */

const SERBIA_ZONE = "10YCS-SERBIATSOV";
const MARKET = "DA_RS";

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

function ymdh(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes())
  );
}

function todayBelgradeISO(): string {
  // YYYY-MM-DD in Europe/Belgrade
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

function addDaysISO(dayISO: string, n: number): string {
  const d = new Date(dayISO + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Europe/Belgrade UTC offset (hours) for the given ISO day. 1 in winter, 2 in DST. */
function cetOffsetHours(dayISO: string): number {
  const noonUtc = new Date(dayISO + "T12:00:00Z");
  const part = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Belgrade",
    timeZoneName: "shortOffset",
  })
    .formatToParts(noonUtc)
    .find((p) => p.type === "timeZoneName")?.value ?? "GMT+1";
  const m = /([+-]?\d+)/.exec(part);
  return m ? parseInt(m[1], 10) : 1;
}

// ---------------------------------------------------------------------------
// XML parsing (TimeSeries → Period → Point with forward-fill)
// ---------------------------------------------------------------------------

function stripNs(xml: string): string {
  return xml.replace(/<\/?[\w:-]+:/g, (m) => m.replace(/[\w-]+:/, ""));
}
function tagAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}
function tagOne(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`);
  const m = re.exec(xml);
  return m ? m[1].trim() : null;
}

function parseTimeSeriesHourly(xml: string): Array<{ ts: string; value: number }> {
  const clean = stripNs(xml);
  const out: Array<{ ts: string; value: number }> = [];
  for (const ts of tagAll(clean, "TimeSeries")) {
    for (const period of tagAll(ts, "Period")) {
      const start = tagOne(period, "start");
      if (!start) continue;
      const startMs = Date.parse(start);
      const endStr = tagOne(period, "end");
      const resolution = tagOne(period, "resolution") ?? "PT60M";
      const stepMin = /PT(\d+)M/.exec(resolution)
        ? parseInt(/PT(\d+)M/.exec(resolution)![1], 10)
        : 60;
      const stepMs = stepMin * 60_000;

      // Raw positions
      const raw: { position: number; value: number }[] = [];
      for (const pt of tagAll(period, "Point")) {
        const pos = parseInt(tagOne(pt, "position") ?? "1", 10);
        const valS =
          tagOne(pt, "price.amount") ??
          tagOne(pt, "quantity") ??
          tagOne(pt, "value");
        if (valS == null) continue;
        const value = parseFloat(valS);
        if (!Number.isFinite(value)) continue;
        raw.push({ position: pos, value });
      }
      if (!raw.length) continue;
      raw.sort((a, b) => a.position - b.position);

      // Forward-fill A03 curves over the declared period length.
      const expected = endStr
        ? Math.max(0, Math.round((Date.parse(endStr) - startMs) / stepMs))
        : raw[raw.length - 1].position;
      let cursor = 0;
      let lastValue = raw[0].value;
      for (let k = 1; k <= expected; k++) {
        while (cursor < raw.length && raw[cursor].position < k) cursor++;
        if (cursor < raw.length && raw[cursor].position === k) {
          lastValue = raw[cursor].value;
        }
        out.push({
          ts: new Date(startMs + (k - 1) * stepMs).toISOString(),
          value: lastValue,
        });
      }
    }
  }
  // Dedupe by ts (keep last) and sort.
  const byTs = new Map<string, number>();
  for (const r of out) byTs.set(r.ts, r.value);
  return [...byTs.entries()]
    .map(([ts, value]) => ({ ts, value }))
    .sort((a, b) => a.ts.localeCompare(b.ts));
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function entsoeRaw(params: Record<string, string>): Promise<
  { ok: true; xml: string } | { ok: false; reason: string }
> {
  const token = process.env.ENTSOE_SECURITY_TOKEN;
  if (!token) return { ok: false, reason: "missing_token" };
  const url = new URL("https://web-api.tp.entsoe.eu/api");
  url.searchParams.set("securityToken", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url.toString(), { headers: { Accept: "application/xml" } });
      if (res.status === 200) return { ok: true, xml: await res.text() };
      if (res.status === 400) return { ok: false, reason: "no_data" };
      if (res.status === 401) return { ok: false, reason: "unauthorized" };
      if (res.status === 429) return { ok: false, reason: "rate_limited" };
      if (res.status < 500 || attempt === 1) return { ok: false, reason: `http_${res.status}` };
    } catch (e) {
      if (attempt === 1) return { ok: false, reason: `network_${(e as Error).message}` };
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return { ok: false, reason: "exhausted" };
}

// ---------------------------------------------------------------------------
// Per-day fetch (Belgrade-aligned window, returns exactly that day's hours)
// ---------------------------------------------------------------------------

async function fetchDayPrices(
  dayISO: string,
): Promise<{ ok: boolean; reason?: string; points: Array<{ ts: string; price: number }> }> {
  const offsetH = cetOffsetHours(dayISO);
  const start = new Date(Date.parse(dayISO + "T00:00:00Z") - offsetH * 3600_000);
  const end = new Date(start.getTime() + 24 * 3600_000);
  const r = await entsoeRaw({
    documentType: "A44",
    in_Domain: SERBIA_ZONE,
    out_Domain: SERBIA_ZONE,
    periodStart: ymdh(start),
    periodEnd: ymdh(end),
  });
  if (!r.ok) return { ok: false, reason: r.reason, points: [] };
  const startMs = start.getTime();
  const endMs = end.getTime();
  const points = parseTimeSeriesHourly(r.xml)
    .filter((p) => {
      const t = Date.parse(p.ts);
      return t >= startMs && t < endMs;
    })
    .map((p) => ({ ts: p.ts, price: p.value }));
  return { ok: true, points };
}

// ---------------------------------------------------------------------------
// Public server function
// ---------------------------------------------------------------------------

export const fetchMarketPrices = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Load existing cache (latest first, capped) and group by Belgrade day.
  const cached = await supabaseAdmin
    .from("market_prices_hourly")
    .select("datetime, price_eur_mwh")
    .eq("market", MARKET)
    .order("datetime", { ascending: false })
    .limit(20000);

  const cachedPoints = (cached.data ?? [])
    .map((r) => ({
      ts: new Date(r.datetime as string).toISOString(),
      price: Number(r.price_eur_mwh),
    }))
    .reverse();

  // Determine which Belgrade days we need to (re)fetch.
  const today = todayBelgradeISO();
  const tomorrow = addDaysISO(today, 1);

  // Count cached hours per Belgrade day to detect gaps (a complete day has 23/24/25 hours, DST aware).
  const dayCounts = new Map<string, number>();
  for (const p of cachedPoints) {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Belgrade",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(p.ts));
    dayCounts.set(fmt, (dayCounts.get(fmt) ?? 0) + 1);
  }

  // Always refresh today & tomorrow; fill gaps in the past 14 days.
  const toFetch: string[] = [tomorrow, today];
  for (let i = 1; i <= 14; i++) {
    const day = addDaysISO(today, -i);
    if ((dayCounts.get(day) ?? 0) < 23) toFetch.push(day);
  }

  let fetchedTotal = 0;
  const reasons: string[] = [];

  for (const day of toFetch) {
    const r = await fetchDayPrices(day);
    if (!r.ok) {
      reasons.push(`${day}:${r.reason ?? "err"}`);
      continue;
    }
    if (r.points.length === 0) continue;
    const rows = r.points.map((p) => ({
      datetime: p.ts,
      market: MARKET,
      price_eur_mwh: p.price,
      source: "ENTSO-E",
    }));
    const minTs = r.points[0].ts;
    const maxTs = r.points[r.points.length - 1].ts;
    await supabaseAdmin
      .from("market_prices_hourly")
      .delete()
      .eq("market", MARKET)
      .gte("datetime", minTs)
      .lte("datetime", maxTs);
    await supabaseAdmin.from("market_prices_hourly").insert(rows);
    fetchedTotal += rows.length;
  }

  // Re-read after writes so the client sees the freshest set.
  const after = await supabaseAdmin
    .from("market_prices_hourly")
    .select("datetime, price_eur_mwh")
    .eq("market", MARKET)
    .order("datetime", { ascending: false })
    .limit(20000);

  const points = (after.data ?? [])
    .map((r) => ({
      ts: new Date(r.datetime as string).toISOString(),
      price: Number(r.price_eur_mwh),
    }))
    .reverse();

  return {
    ok: points.length > 0,
    source: fetchedTotal > 0 ? ("entsoe" as const) : ("cache" as const),
    fetched: fetchedTotal,
    reasons: reasons.length ? reasons : undefined,
    points,
  };
});
