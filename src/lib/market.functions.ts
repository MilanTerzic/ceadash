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

type EntsoeError = {
  ok: false;
  reason: string;
  status?: number;
  message?: string;
  params?: Record<string, string>;
};

function sanitizeMessage(s: string): string {
  return s
    .replace(/securityToken=[^&\s"'<>]+/gi, "securityToken=***")
    .replace(/token=[^&\s"'<>]+/gi, "token=***")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

function classifyEntsoeBody(status: number, body: string): { reason: string; message: string } {
  const b = body.toLowerCase();
  const msgMatch = /<text>([\s\S]*?)<\/text>/i.exec(body);
  const message = sanitizeMessage(msgMatch ? msgMatch[1] : body);
  if (status === 401 || b.includes("unauthorized") || b.includes("invalid token")) return { reason: "unauthorized", message };
  if (status === 429 || b.includes("too many requests")) return { reason: "rate_limited", message };
  if (b.includes("no matching data") || b.includes("no data available") || b.includes("matching data not found")) return { reason: "no_data", message };
  if (b.includes("invalid_domain") || b.includes("area domain") || b.includes("indomain") || b.includes("outdomain")) return { reason: "invalid_domain", message };
  if (b.includes("period") && (b.includes("invalid") || b.includes("not allowed") || b.includes("exceeds"))) return { reason: "invalid_period", message };
  if (status === 400) return { reason: "bad_request", message };
  if (status >= 500) return { reason: `server_error_${status}`, message };
  return { reason: `api_error_${status}`, message };
}

async function entsoeRaw(params: Record<string, string>): Promise<
  { ok: true; xml: string } | EntsoeError
> {
  const token = process.env.ENTSOE_SECURITY_TOKEN;
  if (!token) return { ok: false, reason: "missing_token", params };
  const url = new URL("https://web-api.tp.entsoe.eu/api");
  url.searchParams.set("securityToken", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url.toString(), { headers: { Accept: "application/xml" } });
      if (res.status === 200) return { ok: true, xml: await res.text() };
      let body = "";
      try { body = await res.text(); } catch { /* ignore */ }
      const { reason, message } = classifyEntsoeBody(res.status, body);
      if (res.status >= 500 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      return { ok: false, reason, status: res.status, message, params };
    } catch (e) {
      if (attempt === 1) return { ok: false, reason: "network_error", message: sanitizeMessage((e as Error).message), params };
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return { ok: false, reason: "exhausted", params };
}

// ---------------------------------------------------------------------------
// Range fetch (Belgrade-aligned window, returns hours inside the window)
// ---------------------------------------------------------------------------

type RangeFetchResult = {
  ok: boolean;
  reason?: string;
  status?: number;
  message?: string;
  params?: Record<string, string>;
  points: Array<{ ts: string; price: number }>;
};

async function fetchRangePrices(
  fromISO: string,
  toISO: string,
): Promise<RangeFetchResult> {
  const offsetFrom = cetOffsetHours(fromISO);
  const offsetTo = cetOffsetHours(toISO);
  const start = new Date(Date.parse(fromISO + "T00:00:00Z") - offsetFrom * 3600_000);
  const end = new Date(Date.parse(toISO + "T00:00:00Z") + (24 - offsetTo) * 3600_000);
  const reqParams = {
    documentType: "A44",
    in_Domain: SERBIA_ZONE,
    out_Domain: SERBIA_ZONE,
    periodStart: ymdh(start),
    periodEnd: ymdh(end),
  };
  const r = await entsoeRaw(reqParams);
  if (!r.ok) return { ok: false, reason: r.reason, status: r.status, message: r.message, params: reqParams, points: [] };
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
    params: reqParams,
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

function daysBetween(fromISO: string, toISO: string): string[] {
  const out: string[] = [];
  const start = new Date(fromISO + "T12:00:00Z");
  const end = new Date(toISO + "T12:00:00Z");
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
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
      .object({ from: z.string().optional(), to: z.string().optional() })
      .parse(data ?? {}),
  )
  .handler(async ({ data }) => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const today = todayBelgradeISO();
  const tomorrow = addDaysISO(today, 1);
  const maxPast = addDaysISO(today, -365 * 5);
  const windowFrom = data.from && /^\d{4}-\d{2}-\d{2}$/.test(data.from)
    ? (data.from < maxPast ? maxPast : data.from)
    : addDaysISO(today, -30);
  const requestedTo = data.to && /^\d{4}-\d{2}-\d{2}$/.test(data.to) ? data.to : tomorrow;
  // Always extend to at least tomorrow so SDAC publication is captured when
  // the selected range includes today; never let `to` precede `from`.
  const windowTo = requestedTo < windowFrom ? windowFrom : (requestedTo > tomorrow ? requestedTo : tomorrow);

  // One-day buffer on each side so the UTC-stored rows fully cover the
  // Europe/Belgrade local range (first/last local hour straddles UTC boundary).
  const cacheFrom = addDaysISO(windowFrom, -1);
  const cacheTo = addDaysISO(windowTo, 1);


  const cached = await supabaseAdmin
    .from("market_prices_hourly")
    .select("datetime, price_eur_mwh")
    .eq("market", MARKET)
    .gte("datetime", `${cacheFrom}T00:00:00Z`)
    .lte("datetime", `${cacheTo}T00:00:00Z`)
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

  // Build list of Belgrade delivery days to (re)fetch:
  //  - always refetch today + tomorrow (SDAC publication)
  //  - refetch any day with fewer than 23 unique hours in cache (DST-safe)
  const allDays = daysBetween(windowFrom, windowTo);
  const missingBefore: string[] = [];
  const daysToFetch: string[] = [];
  for (const day of allDays) {
    const have = dayHours.get(day)?.size ?? 0;
    const isLiveWindow = day === today || day === tomorrow;
    if (have < 23) missingBefore.push(day);
    if (isLiveWindow || have < 23) daysToFetch.push(day);
  }
  // Also include tomorrow if it falls outside windowFrom..windowTo bounds
  // (already handled: windowTo is >= tomorrow by construction).

  // Cap per-invocation to keep server-fn wall time bounded; remaining days
  // will be picked up on the next query invalidation.
  const MAX_FETCH_PER_CALL = 120;
  const capped = daysToFetch.slice(0, MAX_FETCH_PER_CALL);

  let fetchedTotal = 0;
  let fetchedDaysCount = 0;
  const failedFetches: { day: string; reason: string }[] = [];
  const reasons: string[] = [];

  const CONCURRENCY = 4;
  async function fetchOneDay(day: string): Promise<void> {
    let attempts = 0;
    let last: { ok: boolean; reason?: string; points: Array<{ ts: string; price: number }> } | null = null;
    while (attempts < 3) {
      last = await fetchRangePrices(day, day);
      if (last.ok) break;
      if (last.reason === "rate_limited") {
        await new Promise((r) => setTimeout(r, 500 + attempts * 500));
        attempts++;
        continue;
      }
      if (last.reason?.startsWith("network_") || last.reason?.startsWith("http_5")) {
        await new Promise((r) => setTimeout(r, 300));
        attempts++;
        continue;
      }
      break;
    }
    if (!last || !last.ok) {
      const reason = last?.reason ?? "unknown";
      failedFetches.push({ day, reason });
      reasons.push(`${day}: ${reason}`);
      return;
    }
    if (last.points.length === 0) {
      failedFetches.push({ day, reason: "no_data" });
      reasons.push(`${day}: no_data`);
      return;
    }
    const rows = last.points.map((p) => ({
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
    await supabaseAdmin.from("market_prices_hourly").insert(rows);
    fetchedTotal += rows.length;
    fetchedDaysCount += 1;
  }

  // Simple concurrency-limited scheduler
  for (let i = 0; i < capped.length; i += CONCURRENCY) {
    await Promise.all(capped.slice(i, i + CONCURRENCY).map(fetchOneDay));
  }

  const after = await supabaseAdmin
    .from("market_prices_hourly")
    .select("datetime, price_eur_mwh")
    .eq("market", MARKET)
    .gte("datetime", `${cacheFrom}T00:00:00Z`)
    .lte("datetime", `${cacheTo}T00:00:00Z`)
    .order("datetime", { ascending: true })
    .limit(200000);

  const points = normalizeCachedRows((after.data ?? []) as Array<{ datetime: string; price_eur_mwh: number | string | null }>);

  // Diagnostics: recompute per-day hour counts after fetch
  const finalDayHours = new Map<string, number>();
  for (const p of points) {
    const d = belgradeDayOf(p.ts);
    finalDayHours.set(d, (finalDayHours.get(d) ?? 0) + 1);
  }
  const completeDays: string[] = [];
  const incompleteDays: string[] = [];
  const missingDays: string[] = [];
  for (const day of allDays) {
    const n = finalDayHours.get(day) ?? 0;
    if (n === 0) missingDays.push(day);
    else if (n < 23) incompleteDays.push(day);
    else completeDays.push(day);
  }
  const loadedFrom = completeDays[0];
  const loadedTo = completeDays[completeDays.length - 1];

  return {
    ok: points.length > 0,
    source: fetchedTotal > 0 ? ("entsoe" as const) : ("cache" as const),
    fetched: fetchedTotal,
    fetchedDaysCount,
    fetchedHoursCount: fetchedTotal,
    windowFrom,
    windowTo,
    requestedFrom: windowFrom,
    requestedTo: windowTo,
    loadedFrom,
    loadedTo,
    missingDays,
    incompleteDays,
    failedFetches,
    truncated: daysToFetch.length > capped.length,
    reasons: reasons.length ? reasons : undefined,
    points,
  };
});

