import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * SEEPEX Serbia day-ahead price fetcher (ENTSO-E Transparency Platform).
 *
 * Methodology copied from the "Serbia Trade Hub" (power-pulse-serbia) project:
 *  - One ENTSO-E request PER DELIVERY DAY (Europe/Belgrade local day).
 *  - periodStart / periodEnd are aligned to the Belgrade day boundary using the
 *    correct CET (UTC+1) or CEST (UTC+2) offset for that specific date.
 *  - Response XML is parsed via TimeSeries → Period → Point, converting
 *    (position, resolution) to a UTC timestamp; returned rows are then filtered
 *    to the exact 24-hour delivery window before persistence.
 *  - Errors are classified into a small, explicit taxonomy:
 *      entsoe_no_data | entsoe_unauthorized | entsoe_rate_limited |
 *      entsoe_bad_request | entsoe_http_<code> | network_error | missing_token
 *  - Storage is `market_prices_hourly` (this app's canonical price store).
 *    Each fetched day is upserted atomically: delete → insert its 24 hours.
 */

const SERBIA_ZONE = "10YCS-SERBIATSOV";
const MARKET = "DA_RS";
const API_BASE = "https://web-api.tp.entsoe.eu/api";

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
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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

// ---------------------------------------------------------------------------
// Tiny XML utilities (Serbia Trade Hub style)
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
      const resolution = tagOne(period, "resolution") ?? "PT60M";
      const stepMin = /PT(\d+)M/.exec(resolution)
        ? parseInt(/PT(\d+)M/.exec(resolution)![1], 10)
        : 60;
      for (const pt of tagAll(period, "Point")) {
        const pos = parseInt(tagOne(pt, "position") ?? "1", 10);
        const valS =
          tagOne(pt, "price.amount") ??
          tagOne(pt, "quantity") ??
          tagOne(pt, "value");
        if (valS == null) continue;
        const value = parseFloat(valS);
        if (!Number.isFinite(value)) continue;
        const ts2 = new Date(startMs + (pos - 1) * stepMin * 60_000).toISOString();
        out.push({ ts: normalizeHourIso(ts2), value });
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
// HTTP — Serbia Trade Hub error taxonomy, extended with body diagnostics
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

function classifyStatus(status: number, body: string): { reason: string; message: string } {
  const b = body.toLowerCase();
  const msgMatch = /<text>([\s\S]*?)<\/text>/i.exec(body);
  const message = sanitizeMessage(msgMatch ? msgMatch[1] : body);
  if (status === 401) return { reason: "entsoe_unauthorized", message };
  if (status === 429) return { reason: "entsoe_rate_limited", message };
  if (status === 400) {
    if (b.includes("no matching data") || b.includes("no data available") || b.includes("matching data not found")) {
      return { reason: "entsoe_no_data", message };
    }
    return { reason: "entsoe_bad_request", message };
  }
  if (status >= 500) return { reason: `entsoe_http_${status}`, message };
  return { reason: `entsoe_http_${status}`, message };
}

async function entsoeRaw(params: Record<string, string>): Promise<
  { ok: true; xml: string } | EntsoeError
> {
  const token = process.env.ENTSOE_SECURITY_TOKEN;
  if (!token) return { ok: false, reason: "missing_token", params };
  const qs = new URLSearchParams({ securityToken: token, ...params });
  const url = `${API_BASE}?${qs.toString()}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/xml" } });
      if (res.status === 200) return { ok: true, xml: await res.text() };
      let body = "";
      try { body = await res.text(); } catch { /* ignore */ }
      const { reason, message } = classifyStatus(res.status, body);
      if (res.status >= 500 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      return { ok: false, reason, status: res.status, message, params };
    } catch (e) {
      if (attempt === 1) {
        return { ok: false, reason: "network_error", message: sanitizeMessage((e as Error).message), params };
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  return { ok: false, reason: "exhausted", params };
}

// ---------------------------------------------------------------------------
// Per-day fetch (Serbia Trade Hub: CET/CEST-aligned window, keep 24 hours)
// ---------------------------------------------------------------------------

type DayFetchResult = {
  ok: boolean;
  reason?: string;
  status?: number;
  message?: string;
  params?: Record<string, string>;
  points: Array<{ ts: string; price: number }>;
};

async function fetchDayPrices(dayISO: string): Promise<DayFetchResult> {
  const offsetH = cetOffsetHours(dayISO);
  const start = new Date(Date.parse(dayISO + "T00:00:00Z") - offsetH * 3600_000);
  const end = new Date(start.getTime() + 24 * 3600_000);
  const reqParams = {
    documentType: "A44",
    in_Domain: SERBIA_ZONE,
    out_Domain: SERBIA_ZONE,
    periodStart: ymdh(start),
    periodEnd: ymdh(end),
  };
  const r = await entsoeRaw(reqParams);
  if (!r.ok) {
    return { ok: false, reason: r.reason, status: r.status, message: r.message, params: reqParams, points: [] };
  }
  const startMs = start.getTime();
  const endMs = end.getTime();
  const points = parseTimeSeriesHourly(r.xml)
    .filter((p) => {
      const t = Date.parse(p.ts);
      return t >= startMs && t < endMs;
    })
    .map((p) => ({ ts: normalizeHourIso(p.ts), price: p.value }));
  return { ok: true, params: reqParams, points };
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

function normalizeCachedRows(
  rows: Array<{ datetime: string; price_eur_mwh: number | string | null }>,
) {
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

/** Read all rows in [fromIso, toIso] for MARKET, paginating past PostgREST's
 *  default max-rows cap (1000). `.limit(n)` is ignored above that cap, so we
 *  use `.range()` in 1000-row pages until a short page comes back. */
async function readAllCachedRows(
  supabaseAdmin: {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (c: string, v: string) => {
          gte: (c: string, v: string) => {
            lte: (c: string, v: string) => {
              order: (c: string, o: { ascending: boolean }) => {
                range: (from: number, to: number) => Promise<{ data: unknown }>;
              };
            };
          };
        };
      };
    };
  },
  fromIso: string,
  toIso: string,
): Promise<Array<{ datetime: string; price_eur_mwh: number | string | null }>> {
  const PAGE = 1000;
  const out: Array<{ datetime: string; price_eur_mwh: number | string | null }> = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = await supabaseAdmin
      .from("market_prices_hourly")
      .select("datetime, price_eur_mwh")
      .eq("market", MARKET)
      .gte("datetime", fromIso)
      .lte("datetime", toIso)
      .order("datetime", { ascending: true })
      .range(offset, offset + PAGE - 1);
    const rows = (res.data ?? []) as Array<{ datetime: string; price_eur_mwh: number | string | null }>;
    out.push(...rows);
    if (rows.length < PAGE) break;
    if (offset > 500_000) break; // hard safety
  }
  return out;
}


// ---------------------------------------------------------------------------
// Public server function
// ---------------------------------------------------------------------------

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
    const windowFrom =
      data.from && /^\d{4}-\d{2}-\d{2}$/.test(data.from)
        ? data.from < maxPast
          ? maxPast
          : data.from
        : addDaysISO(today, -30);
    const requestedTo =
      data.to && /^\d{4}-\d{2}-\d{2}$/.test(data.to) ? data.to : tomorrow;
    // Extend to at least tomorrow so SDAC publication (~13:00 CET) is picked
    // up whenever the selected range touches today; never let `to` precede `from`.
    const windowTo =
      requestedTo < windowFrom
        ? windowFrom
        : requestedTo > tomorrow
          ? requestedTo
          : tomorrow;

    // One-day buffer on each side so cached UTC rows fully cover the local range.
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

    const normalizedCached = normalizeCachedRows(
      (cached.data ?? []) as Array<{ datetime: string; price_eur_mwh: number | string | null }>,
    );
    const dayHours = new Map<string, Set<string>>();
    for (const r of normalizedCached) {
      const day = belgradeDayOf(r.ts);
      const set = dayHours.get(day) ?? new Set<string>();
      set.add(r.ts);
      dayHours.set(day, set);
    }

    // Serbia Trade Hub cache policy: past days are immutable → skip if cached;
    // today + tomorrow are always refreshed (SDAC publication).
    const allDays = daysBetween(windowFrom, windowTo);
    const daysToFetch: string[] = [];
    for (const day of allDays) {
      const have = dayHours.get(day)?.size ?? 0;
      const isLiveWindow = day === today || day === tomorrow;
      if (isLiveWindow || have < 23) daysToFetch.push(day);
    }

    // Cap per invocation to keep server-fn wall time bounded.
    const MAX_FETCH_PER_CALL = 120;
    const capped = daysToFetch.slice(0, MAX_FETCH_PER_CALL);

    let fetchedTotal = 0;
    let fetchedDaysCount = 0;
    type FailedFetch = {
      day: string;
      reason: string;
      status?: number;
      message?: string;
      attempts: number;
      params?: Record<string, string>;
    };
    const failedFetches: FailedFetch[] = [];
    const reasons: string[] = [];

    async function processDay(day: string): Promise<void> {
      let attempts = 0;
      let last: DayFetchResult | null = null;
      // Retry loop for transient failures (rate limits, network, 5xx).
      while (attempts < 3) {
        attempts++;
        last = await fetchDayPrices(day);
        if (last.ok) break;
        if (last.reason === "entsoe_rate_limited") {
          await new Promise((r) => setTimeout(r, 500 + attempts * 500));
          continue;
        }
        if (last.reason === "network_error" || last.reason?.startsWith("entsoe_http_5")) {
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }
        break;
      }
      if (!last || !last.ok) {
        const reason = last?.reason ?? "unknown";
        failedFetches.push({
          day, reason, status: last?.status, message: last?.message, attempts, params: last?.params,
        });
        reasons.push(`${day}: ${reason}${last?.status ? ` (http_${last.status})` : ""}`);
        return;
      }
      if (last.points.length === 0) {
        failedFetches.push({
          day,
          reason: "entsoe_no_data",
          attempts,
          params: last.params,
          message: "ENTSO-E returned 200 with no matching TimeSeries for this delivery day.",
        });
        reasons.push(`${day}: entsoe_no_data`);
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
      const del = await supabaseAdmin
        .from("market_prices_hourly")
        .delete()
        .eq("market", MARKET)
        .gte("datetime", minTs)
        .lte("datetime", maxTs);
      if (del.error) {
        failedFetches.push({ day, reason: "supabase_delete_error", attempts, message: sanitizeMessage(del.error.message) });
        reasons.push(`${day}: supabase_delete_error`);
        return;
      }
      const ins = await supabaseAdmin.from("market_prices_hourly").insert(rows);
      if (ins.error) {
        failedFetches.push({ day, reason: "supabase_insert_error", attempts, message: sanitizeMessage(ins.error.message) });
        reasons.push(`${day}: supabase_insert_error`);
        return;
      }
      fetchedTotal += rows.length;
      fetchedDaysCount += 1;
    }

    // Small concurrency window keeps latency low without hammering ENTSO-E.
    const CONCURRENCY = 4;
    for (let i = 0; i < capped.length; i += CONCURRENCY) {
      await Promise.all(capped.slice(i, i + CONCURRENCY).map(processDay));
    }

    const after = await supabaseAdmin
      .from("market_prices_hourly")
      .select("datetime, price_eur_mwh")
      .eq("market", MARKET)
      .gte("datetime", `${cacheFrom}T00:00:00Z`)
      .lte("datetime", `${cacheTo}T00:00:00Z`)
      .order("datetime", { ascending: true })
      .limit(200000);

    const points = normalizeCachedRows(
      (after.data ?? []) as Array<{ datetime: string; price_eur_mwh: number | string | null }>,
    );

    // Diagnostics
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

    const failureCounts: Record<string, number> = {};
    for (const f of failedFetches) failureCounts[f.reason] = (failureCounts[f.reason] ?? 0) + 1;
    const topFailure = Object.entries(failureCounts).sort((a, b) => b[1] - a[1])[0];
    const firstFailed = failedFetches[0];
    const capReached = daysToFetch.length > capped.length;

    const debugSummary =
      `ENTSO-E debug: selected ${windowFrom} → ${windowTo}; ` +
      `total ${allDays.length} d; complete ${completeDays.length}; incomplete ${incompleteDays.length}; ` +
      `missing ${missingDays.length}; attempted ${capped.length}` +
      (capReached ? ` (cap ${MAX_FETCH_PER_CALL}, +${daysToFetch.length - capped.length} deferred)` : "") +
      `; fetched ${fetchedDaysCount}; failed ${failedFetches.length}` +
      (topFailure ? `; top reason: ${topFailure[0]} (${topFailure[1]})` : "") +
      (firstFailed
        ? `; first failed: ${firstFailed.day}${firstFailed.status ? ` http_${firstFailed.status}` : ""}${firstFailed.message ? ` — ${firstFailed.message}` : ""}`
        : "");

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
      failureCounts,
      attemptedDaysCount: capped.length,
      totalSelectedDays: allDays.length,
      capReached,
      maxFetchPerCall: MAX_FETCH_PER_CALL,
      debugSummary,
      truncated: capReached,
      reasons: reasons.length ? reasons : undefined,
      points,
    };
  });
