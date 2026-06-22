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

function normalizeHourIso(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : new Date(input);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

function todayBelgradeISO(): string {
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
          ts: normalizeHourIso(new Date(startMs + (k - 1) * stepMs)),
          value: lastValue,
        });
      }
    }
  }
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
// Range fetch (Belgrade-aligned window, returns hours inside the window)
// ---------------------------------------------------------------------------

async function fetchRangePrices(
  fromISO: string,
  toISO: string,
): Promise<{ ok: boolean; reason?: string; points: Array<{ ts: string; price: number }> }> {
  const offsetFrom = cetOffsetHours(fromISO);
  const offsetTo = cetOffsetHours(toISO);
  const start = new Date(Date.parse(fromISO + "T00:00:00Z") - offsetFrom * 3600_000);
  const end = new Date(Date.parse(toISO + "T00:00:00Z") + (24 - offsetTo) * 3600_000);
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
    .map((p) => ({ ts: normalizeHourIso(p.ts), price: p.value }));
  const dedup = new Map<string, number>();
  for (const p of points) dedup.set(p.ts, p.price);
  return {
    ok: true,
    points: [...dedup.entries()]
      .map(([ts, price]) => ({ ts, price }))
      .sort((a, b) => a.ts.localeCompare(b.ts)),
  };
}

function belgradeDayOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function monthsBetween(fromISO: string, toISO: string): string[] {
  const out: string[] = [];
  const [fy, fm] = fromISO.split("-").map(Number);
  const [ty, tm] = toISO.split("-").map(Number);
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

function monthBounds(ym: string, clampFrom: string, clampTo: string) {
  const [y, m] = ym.split("-").map(Number);
  const first = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return {
    from: first < clampFrom ? clampFrom : first,
    to: last > clampTo ? clampTo : last,
  };
}

function normalizeCachedRows(rows: Array<{ datetime: string; price_eur_mwh: number | string | null }>) {
  const byTs = new Map<string, number>();
  for (const row of rows) {
    const ts = normalizeHourIso(row.datetime);
    const price = Number(row.price_eur_mwh);
    if (!Number.isFinite(price)) continue;
    byTs.set(ts, price);
  }
  return [...byTs.entries()]
    .map(([ts, price]) => ({ ts, price }))
    .sort((a, b) => a.ts.localeCompare(b.ts));
}

export const fetchMarketPrices = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({ from: z.string().optional() })
      .parse(data ?? {}),
  )
  .handler(async ({ data }) => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const today = todayBelgradeISO();
  const tomorrow = addDaysISO(today, 1);
  const windowFrom = data.from && /^\d{4}-\d{2}-\d{2}$/.test(data.from)
    ? (data.from < addDaysISO(today, -365 * 5) ? addDaysISO(today, -365 * 5) : data.from)
    : addDaysISO(today, -30);
  const windowTo = tomorrow;

  const cached = await supabaseAdmin
    .from("market_prices_hourly")
    .select("datetime, price_eur_mwh")
    .eq("market", MARKET)
    .gte("datetime", `${windowFrom}T00:00:00Z`)
    .lte("datetime", `${addDaysISO(windowTo, 1)}T00:00:00Z`)
    .order("datetime", { ascending: true })
    .limit(200000);

  const normalizedCached = normalizeCachedRows((cached.data ?? []) as Array<{ datetime: string; price_eur_mwh: number | string | null }>);
  const dayHours = new Map<string, Set<string>>();
  for (const r of normalizedCached) {
    const day = belgradeDayOf(r.ts);
    const set = dayHours.get(day) ?? new Set<string>();
    set.add(r.ts);
    dayHours.set(day, set);
  }

  const monthsToFetch: { from: string; to: string }[] = [];
  for (const ym of monthsBetween(windowFrom, windowTo)) {
    const { from: mFrom, to: mTo } = monthBounds(ym, windowFrom, windowTo);
    const containsLive = today >= mFrom && today <= mTo;
    let needs = containsLive;
    if (!needs) {
      const start = new Date(mFrom + "T00:00:00Z");
      const end = new Date(mTo + "T00:00:00Z");
      for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        const key = d.toISOString().slice(0, 10);
        if ((dayHours.get(key)?.size ?? 0) < 23) { needs = true; break; }
      }
    }
    if (needs) monthsToFetch.push({ from: mFrom, to: mTo });
  }

  let fetchedTotal = 0;
  const reasons: string[] = [];

  for (const win of monthsToFetch) {
    const r = await fetchRangePrices(win.from, win.to);
    if (!r.ok) {
      reasons.push(`${win.from}..${win.to}:${r.reason ?? "err"}`);
      continue;
    }
    if (r.points.length === 0) continue;
    const rows = r.points.map((p) => ({
      datetime: normalizeHourIso(p.ts),
      market: MARKET,
      price_eur_mwh: p.price,
      source: "ENTSO-E",
    }));
    const minTs = rows[0].datetime;
    const maxTs = rows[rows.length - 1].datetime;
    await supabaseAdmin
      .from("market_prices_hourly")
      .delete()
      .eq("market", MARKET)
      .gte("datetime", minTs)
      .lte("datetime", maxTs);
    for (let i = 0; i < rows.length; i += 1000) {
      await supabaseAdmin.from("market_prices_hourly").insert(rows.slice(i, i + 1000));
    }
    fetchedTotal += rows.length;
  }

  const after = await supabaseAdmin
    .from("market_prices_hourly")
    .select("datetime, price_eur_mwh")
    .eq("market", MARKET)
    .gte("datetime", `${windowFrom}T00:00:00Z`)
    .lte("datetime", `${addDaysISO(windowTo, 1)}T00:00:00Z`)
    .order("datetime", { ascending: true })
    .limit(200000);

  const points = normalizeCachedRows((after.data ?? []) as Array<{ datetime: string; price_eur_mwh: number | string | null }>);

  return {
    ok: points.length > 0,
    source: fetchedTotal > 0 ? ("entsoe" as const) : ("cache" as const),
    fetched: fetchedTotal,
    windowFrom,
    windowTo,
    reasons: reasons.length ? reasons : undefined,
    points,
  };
});
