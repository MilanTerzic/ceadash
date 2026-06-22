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
// Range fetch (Belgrade-aligned window, returns hours inside the window)
// ---------------------------------------------------------------------------

async function fetchRangePrices(
  fromISO: string,
  toISO: string,
): Promise<{ ok: boolean; reason?: string; points: Array<{ ts: string; price: number }> }> {
  const offsetFrom = cetOffsetHours(fromISO);
  const offsetTo = cetOffsetHours(toISO);
  const start = new Date(Date.parse(fromISO + "T00:00:00Z") - offsetFrom * 3600_000);
  // toISO is INCLUSIVE delivery day → end of that Belgrade day = next 00:00.
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
    .map((p) => ({ ts: p.ts, price: p.value }));
  return { ok: true, points };
}

/** Belgrade YYYY-MM-DD of an ISO timestamp. */
function belgradeDayOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** Enumerate Belgrade YYYY-MM keys spanning [fromISO, toISO] inclusive. */
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

// ---------------------------------------------------------------------------
// Public server function
// ---------------------------------------------------------------------------

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
  // Window we will guarantee in cache.
  const windowFrom = data.from && /^\d{4}-\d{2}-\d{2}$/.test(data.from)
    ? (data.from < addDaysISO(today, -365 * 5) ? addDaysISO(today, -365 * 5) : data.from)
    : addDaysISO(today, -30);
  const windowTo = tomorrow;

  // Load cache restricted to the window (+ a small read buffer) for coverage check.
  const cached = await supabaseAdmin
    .from("market_prices_hourly")
    .select("datetime, price_eur_mwh")
    .eq("market", MARKET)
    .gte("datetime", `${windowFrom}T00:00:00Z`)
    .lte("datetime", `${addDaysISO(windowTo, 1)}T00:00:00Z`)
    .order("datetime", { ascending: true })
    .limit(200000);

  const dayCounts = new Map<string, number>();
  for (const r of cached.data ?? []) {
    const day = belgradeDayOf(r.datetime as string);
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }

  // For each month in the window, decide whether to refetch.
  // A month is "complete enough" if every past day inside the window has ≥ 23 hours.
  const monthsToFetch: { from: string; to: string }[] = [];
  for (const ym of monthsBetween(windowFrom, windowTo)) {
    const { from: mFrom, to: mTo } = monthBounds(ym, windowFrom, windowTo);
    // Always refetch the month containing today (live data + tomorrow).
    const containsLive = today >= mFrom && today <= mTo;
    let needs = containsLive;
    if (!needs) {
      // Past month: refetch if any day < 23 hours.
      const start = new Date(mFrom + "T00:00:00Z");
      const end = new Date(mTo + "T00:00:00Z");
      for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        const key = d.toISOString().slice(0, 10);
        if ((dayCounts.get(key) ?? 0) < 23) { needs = true; break; }
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
    // Chunk inserts (Supabase soft-limit ~1000 rows per insert).
    for (let i = 0; i < rows.length; i += 1000) {
      await supabaseAdmin.from("market_prices_hourly").insert(rows.slice(i, i + 1000));
    }
    fetchedTotal += rows.length;
  }

  // Re-read the window after writes.
  const after = await supabaseAdmin
    .from("market_prices_hourly")
    .select("datetime, price_eur_mwh")
    .eq("market", MARKET)
    .gte("datetime", `${windowFrom}T00:00:00Z`)
    .lte("datetime", `${addDaysISO(windowTo, 1)}T00:00:00Z`)
    .order("datetime", { ascending: true })
    .limit(200000);

  const points = (after.data ?? []).map((r) => ({
    ts: new Date(r.datetime as string).toISOString(),
    price: Number(r.price_eur_mwh),
  }));

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

