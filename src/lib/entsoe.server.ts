// ENTSO-E Transparency Platform client — server-only.
// Mirrors fetchers from the uploaded Python app.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  ZONES,
  ENTSOE_DOCUMENT_TYPES,
  MARKET_AGREEMENT_TYPES,
  type ZoneCode,
  type ProductType,
} from "./markets";
import { PRICE_MARKETS, type PriceMarketCode } from "./price-markets";
import { entsoeTokenMissingMessage, getEntsoeToken } from "./entsoe-token";
import { extractEntsoeZipDocuments, isZipPayload } from "./entsoe-zip";
import {
  dedupeOutageRevisions,
  inspectEntsoeXml,
  parseOutageRows,
  chunkOutageRange,
  type OutageRow,
} from "./entsoe-outages";
import {
  addDaysIso,
  aggregateDataStatus,
  assertValidDateRange,
  mergeLoadGeneration,
  type DataSourceStatus,
  type DataStatus,
  type LoadGenerationPoint,
} from "./fundamentals";
import { logSourceDiagnostic } from "./source-diagnostics.server";

export type { OutageRow } from "./entsoe-outages";

const API_BASE = "https://web-api.tp.entsoe.eu/api";
const DEFAULT_TTL = 1800;
// Per-source TTLs (seconds).
const TTL = {
  da_today: 30 * 60, // today / future: refresh every 30 min
  da_past: 7 * 24 * 3600, // past days: immutable, keep 7 days
  flow_today: 30 * 60,
  flow_past: 7 * 24 * 3600,
  cap_today: 30 * 60,
  cap_past: 7 * 24 * 3600,
  outages: 60 * 60, // 1h
  loadgen_today: 30 * 60,
  loadgen_past: 24 * 3600,
} as const;

// Returns true when dayISO is strictly before today (UTC) — i.e. immutable historical data.
function isPastDay(dayISO: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return dayISO < today;
}
function ttlFor(today: number, past: number, dayISO: string): number {
  return isPastDay(dayISO) ? past : today;
}

function token(): string | null {
  return getEntsoeToken();
}

function ymdh(d: Date): string {
  const y = d.getUTCFullYear();
  const M = String(d.getUTCMonth() + 1).padStart(2, "0");
  const D = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}${M}${D}${h}${m}`;
}

// Europe/Belgrade UTC offset at local delivery-day midnight.
function cetOffsetHours(dayISO: string): number {
  const utcMidnight = new Date(dayISO + "T00:00:00Z");
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Belgrade",
    timeZoneName: "shortOffset",
  });
  const part =
    fmt.formatToParts(utcMidnight).find((p) => p.type === "timeZoneName")?.value ?? "GMT+1";
  const m = /([+-]?\d+)/.exec(part);
  return m ? parseInt(m[1], 10) : 1;
}

function belgradeDeliveryWindow(dayISO: string) {
  const startOffsetH = cetOffsetHours(dayISO);
  const next = new Date(dayISO + "T00:00:00Z");
  next.setUTCDate(next.getUTCDate() + 1);
  const nextISO = next.toISOString().slice(0, 10);
  const endOffsetH = cetOffsetHours(nextISO);
  const start = new Date(Date.parse(dayISO + "T00:00:00Z") - startOffsetH * 3600_000);
  const end = new Date(Date.parse(nextISO + "T00:00:00Z") - endOffsetH * 3600_000);
  return { start, end };
}

export interface FetchResult<T> {
  data: T;
  source: "live" | "cache" | "demo" | "empty";
  reason?: string;
  fetched_at: string;
  status?: DataStatus;
  last_success_at?: string;
  stale?: boolean;
}

type CacheEntry<T> = {
  payload: T;
  fetched_at: string;
  ttl_seconds: number;
  fresh: boolean;
};

async function cacheGetEntry<T>(key: string, ttl: number): Promise<CacheEntry<T> | null> {
  try {
    const { data } = await supabaseAdmin
      .from("api_cache")
      .select("payload, fetched_at, ttl_seconds")
      .eq("key", key)
      .maybeSingle();
    if (!data) return null;
    const fetchedAt = String(data.fetched_at);
    const ttlSeconds = Number(data.ttl_seconds ?? ttl);
    const age = (Date.now() - new Date(fetchedAt).getTime()) / 1000;
    return {
      payload: data.payload as T,
      fetched_at: fetchedAt,
      ttl_seconds: ttlSeconds,
      fresh: age <= ttlSeconds,
    };
  } catch {
    return null;
  }
}

async function cacheGet<T>(key: string, ttl: number): Promise<T | null> {
  const entry = await cacheGetEntry<T>(key, ttl);
  return entry?.fresh ? entry.payload : null;
}

async function cacheGetStale<T>(key: string): Promise<CacheEntry<T> | null> {
  return cacheGetEntry<T>(key, 0);
}

async function staleCacheOrEmpty<T>(
  key: string,
  emptyData: T,
  reason: string,
): Promise<FetchResult<T>> {
  const cached = await cacheGetStale<T>(key);
  if (cached) {
    return {
      data: cached.payload,
      source: "cache",
      reason: `stale_cache_${reason}`,
      fetched_at: cached.fetched_at,
      last_success_at: cached.fetched_at,
      status: "partial",
      stale: true,
    };
  }
  return {
    data: emptyData,
    source: "empty",
    reason,
    fetched_at: new Date().toISOString(),
    status: reason === "entsoe_no_data" || reason === "no_data" ? "empty" : "error",
  };
}

async function cacheSet(key: string, payload: unknown, ttl = DEFAULT_TTL) {
  try {
    await supabaseAdmin.from("api_cache").upsert({
      key,
      payload: payload as never,
      fetched_at: new Date().toISOString(),
      ttl_seconds: ttl,
    });
  } catch {
    // Cache writes are best-effort and never invalidate a successful live response.
  }
}

function isRetryableEntsoeStatus(status: number) {
  return status === 429 || status >= 500;
}

class EntsoeRequestError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
    readonly status?: number,
    readonly contentType?: string,
  ) {
    super(message);
  }
}

type EntsoePayload = {
  documents: string[];
  contentType: string;
  status: number;
  compressed: boolean;
};

async function entsoePayload(
  params: Record<string, string>,
  diagnostic?: { source: string; from: string; to: string },
  acceptZip = false,
): Promise<EntsoePayload> {
  const t = token();
  if (!t) throw new EntsoeRequestError(entsoeTokenMissingMessage());
  const qs = new URLSearchParams({ securityToken: t, ...params });
  const url = `${API_BASE}?${qs.toString()}`;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/xml" },
        signal: controller.signal,
      });
      lastStatus = res.status;
      const contentType = res.headers.get("content-type") ?? "";
      const bytes = new Uint8Array(await res.arrayBuffer());
      const compressed = isZipPayload(bytes, contentType);
      const body = compressed ? "" : new TextDecoder().decode(bytes);
      const xmlContent = /(?:application|text)\/(?:[\w.+-]*\+)?xml/i.test(contentType);
      const envelope = xmlContent && body ? inspectEntsoeXml(body) : null;

      if (!res.ok) {
        let reason = `entsoe_http_${res.status}`;
        if (res.status === 400) {
          reason = envelope?.kind === "no_data" ? "entsoe_no_data" : "entsoe_invalid_request";
        } else if (res.status === 401 || res.status === 403) {
          reason = "entsoe_unauthorized";
        } else if (res.status === 429) {
          reason = "entsoe_rate_limited";
        }
        const retryable = isRetryableEntsoeStatus(res.status);
        if (retryable && attempt < 2) {
          throw new EntsoeRequestError(reason, true, res.status, contentType);
        }
        if (diagnostic) {
          logSourceDiagnostic({
            ...diagnostic,
            http_status: res.status,
            content_type: contentType,
            records: 0,
            reason,
          });
        }
        throw new EntsoeRequestError(reason, false, res.status, contentType);
      }

      if (!bytes.length) {
        throw new EntsoeRequestError("entsoe_empty_response", false, res.status, contentType);
      }
      if (compressed) {
        if (!acceptZip) {
          throw new EntsoeRequestError(
            "entsoe_compressed_response_unsupported",
            false,
            res.status,
            contentType,
          );
        }
        let documents: string[];
        try {
          documents = extractEntsoeZipDocuments(bytes);
        } catch (error) {
          throw new EntsoeRequestError(
            error instanceof Error ? error.message : "entsoe_zip_parse_error",
            false,
            res.status,
            contentType,
          );
        }
        return { documents, contentType, status: res.status, compressed: true };
      }
      if (!xmlContent) {
        throw new EntsoeRequestError(
          "entsoe_unexpected_content_type",
          false,
          res.status,
          contentType,
        );
      }
      if (envelope?.kind !== "data") {
        throw new EntsoeRequestError(
          envelope?.reason ?? "entsoe_xml_error_document",
          false,
          res.status,
          contentType,
        );
      }
      return { documents: [body], contentType, status: res.status, compressed: false };
    } catch (error) {
      const normalized =
        error instanceof Error && error.name === "AbortError"
          ? new EntsoeRequestError("entsoe_timeout", true)
          : error instanceof EntsoeRequestError
            ? error
            : new EntsoeRequestError("entsoe_network_error");
      if (!normalized.retryable || attempt === 2) {
        if (diagnostic) {
          logSourceDiagnostic({
            ...diagnostic,
            http_status: normalized.status,
            content_type: normalized.contentType,
            records: 0,
            reason: normalized.message,
          });
        }
        throw normalized;
      }
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
  }
  throw new EntsoeRequestError(`entsoe_http_${lastStatus || "unknown"}`);
}

async function entsoeRaw(
  params: Record<string, string>,
  diagnostic?: { source: string; from: string; to: string },
): Promise<string> {
  const payload = await entsoePayload(params, diagnostic);
  return payload.documents[0];
}

// --- Tiny XML utilities -----------------------------------------------------
function stripNs(xml: string) {
  return xml.replace(/<\/?[\w:-]+:/g, (m) => m.replace(/[\w-]+:/, ""));
}
function tagAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}
function tagOne(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`);
  const m = re.exec(xml);
  return m ? m[1].trim() : null;
}

function avg(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
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
      const stepMin = /PT(\d+)M/.exec(resolution)?.[1]
        ? parseInt(/PT(\d+)M/.exec(resolution)![1], 10)
        : 60;
      for (const pt of tagAll(period, "Point")) {
        const pos = parseInt(tagOne(pt, "position") ?? "1", 10);
        const valS = tagOne(pt, "price.amount") ?? tagOne(pt, "quantity") ?? tagOne(pt, "value");
        if (valS == null) continue;
        const value = parseFloat(valS);
        if (!Number.isFinite(value)) continue;
        const ts2 = new Date(startMs + (pos - 1) * stepMin * 60_000).toISOString();
        out.push({ ts: ts2, value });
      }
    }
  }
  // dedupe by ts (keep last)
  const byTs = new Map<string, number>();
  for (const r of out) byTs.set(r.ts, r.value);
  return [...byTs.entries()]
    .map(([ts, value]) => ({ ts, value }))
    .sort((a, b) => a.ts.localeCompare(b.ts));
}

function parseResolutionMinutes(resolution: string | null): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(resolution ?? "");
  if (!m) return 60;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const min = m[2] ? parseInt(m[2], 10) : 0;
  return h * 60 + min || 60;
}

function parseTimeSeriesIntervals(xml: string): Array<{
  ts: string;
  value: number;
  durationMinutes: number;
  productionType?: string;
  mRID?: string;
}> {
  const clean = stripNs(xml);
  const out: Array<{
    ts: string;
    value: number;
    durationMinutes: number;
    productionType?: string;
    mRID?: string;
  }> = [];
  for (const ts of tagAll(clean, "TimeSeries")) {
    const productionType = tagOne(ts, "psrType") ?? undefined;
    const mRID = tagOne(ts, "mRID") ?? undefined;
    for (const period of tagAll(ts, "Period")) {
      const start = tagOne(period, "start");
      if (!start) continue;
      const startMs = Date.parse(start);
      const durationMinutes = parseResolutionMinutes(tagOne(period, "resolution"));
      for (const pt of tagAll(period, "Point")) {
        const pos = parseInt(tagOne(pt, "position") ?? "1", 10);
        const valS = tagOne(pt, "price.amount") ?? tagOne(pt, "quantity") ?? tagOne(pt, "value");
        if (valS == null) continue;
        const value = parseFloat(valS);
        if (!Number.isFinite(value)) continue;
        const ts2 = new Date(startMs + (pos - 1) * durationMinutes * 60_000).toISOString();
        out.push({ ts: ts2, value, durationMinutes, productionType, mRID });
      }
    }
  }
  return out.sort((a, b) => a.ts.localeCompare(b.ts));
}

function parseAllocationSummary(xml: string): {
  price_eur_mwh: number | null;
  quantity_mw: number | null;
} {
  const clean = stripNs(xml);
  const prices: number[] = [];
  const quantities: number[] = [];
  for (const ts of tagAll(clean, "TimeSeries")) {
    for (const period of tagAll(ts, "Period")) {
      for (const pt of tagAll(period, "Point")) {
        const price = parseFloat(tagOne(pt, "price.amount") ?? "");
        const quantity = parseFloat(tagOne(pt, "quantity") ?? "");
        if (Number.isFinite(price)) prices.push(price);
        if (Number.isFinite(quantity)) quantities.push(quantity);
      }
    }
  }
  return { price_eur_mwh: avg(prices), quantity_mw: avg(quantities) };
}

// --- Public fetchers --------------------------------------------------------
export interface PriceSeries {
  zone: PriceMarketCode;
  points: Array<{ ts: string; price: number }>;
}
export interface IntervalPriceSeries {
  zone: PriceMarketCode;
  points: Array<{ ts: string; price: number; durationMinutes: number }>;
}

export async function fetchDayAheadPrices(
  zone: PriceMarketCode,
  dayISO: string,
  demo = false,
  force = false,
): Promise<FetchResult<PriceSeries>> {
  const key = `da_prices:${zone}:${dayISO}`;
  const emptyData: PriceSeries = { zone, points: [] };
  if (!force) {
    const cached = await cacheGet<PriceSeries>(key, DEFAULT_TTL);
    if (cached) return { data: cached, source: "cache", fetched_at: new Date().toISOString() };
  }
  if (demo) return staleCacheOrEmpty(key, emptyData, "demo_disabled");
  if (!token()) return staleCacheOrEmpty(key, emptyData, "no_token");
  try {
    // SEEPEX / SEE delivery days are CET/CEST (Europe/Belgrade, UTC+1 or +2).
    // Build the proper local-day window so we return exactly the 24 hours of dayISO.
    const { start, end } = belgradeDeliveryWindow(dayISO);
    const xml = await entsoeRaw({
      documentType: ENTSOE_DOCUMENT_TYPES.day_ahead_prices,
      in_Domain: PRICE_MARKETS[zone].eic,
      out_Domain: PRICE_MARKETS[zone].eic,
      periodStart: ymdh(start),
      periodEnd: ymdh(end),
    });
    // Keep only the 24 points falling inside the requested CET delivery day.
    const startMs = start.getTime();
    const endMs = end.getTime();
    const series = parseTimeSeriesHourly(xml)
      .filter((p) => {
        const t = Date.parse(p.ts);
        return t >= startMs && t < endMs;
      })
      .map((p) => ({ ts: p.ts, price: p.value }));
    if (!series.length) return staleCacheOrEmpty(key, emptyData, "no_data");
    const payload: PriceSeries = { zone, points: series };
    await cacheSet(key, payload, ttlFor(TTL.da_today, TTL.da_past, dayISO));
    return { data: payload, source: "live", fetched_at: new Date().toISOString() };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "error";
    return staleCacheOrEmpty(key, emptyData, reason);
  }
}

export async function fetchDayAheadPricesRange(
  zone: PriceMarketCode,
  fromISO: string,
  toISO: string,
  demo = false,
  force = false,
): Promise<FetchResult<IntervalPriceSeries>> {
  const key = `da_prices_range:v1:${zone}:${fromISO}:${toISO}`;
  const emptyData: IntervalPriceSeries = { zone, points: [] };
  const ttl = toISO < new Date().toISOString().slice(0, 10) ? TTL.da_past : TTL.da_today;
  if (!force) {
    const cached = await cacheGet<IntervalPriceSeries>(key, ttl);
    if (cached) return { data: cached, source: "cache", fetched_at: new Date().toISOString() };
  }
  if (demo) return staleCacheOrEmpty(key, emptyData, "demo_disabled");
  if (!token()) return staleCacheOrEmpty(key, emptyData, "no_token");
  try {
    const points: IntervalPriceSeries["points"] = [];
    for (const chunk of chunkDateRange(fromISO, toISO, 92)) {
      const startOffsetH = cetOffsetHours(chunk.from);
      const start = new Date(Date.parse(chunk.from + "T00:00:00Z") - startOffsetH * 3600_000);
      const afterTo = new Date(Date.parse(chunk.to + "T00:00:00Z") + 24 * 3600_000)
        .toISOString()
        .slice(0, 10);
      const endOffsetH = cetOffsetHours(afterTo);
      const end = new Date(Date.parse(afterTo + "T00:00:00Z") - endOffsetH * 3600_000);
      const xml = await entsoeRaw({
        documentType: ENTSOE_DOCUMENT_TYPES.day_ahead_prices,
        in_Domain: PRICE_MARKETS[zone].eic,
        out_Domain: PRICE_MARKETS[zone].eic,
        periodStart: ymdh(start),
        periodEnd: ymdh(end),
      });
      const startMs = start.getTime();
      const endMs = end.getTime();
      points.push(
        ...parseTimeSeriesIntervals(xml)
          .filter((p) => {
            const t = Date.parse(p.ts);
            return t >= startMs && t < endMs;
          })
          .map((p) => ({ ts: p.ts, price: p.value, durationMinutes: p.durationMinutes })),
      );
    }
    if (!points.length) return staleCacheOrEmpty(key, emptyData, "no_data");
    const byTs = new Map(points.map((point) => [point.ts, point]));
    const payload = {
      zone,
      points: [...byTs.values()].sort((a, b) => a.ts.localeCompare(b.ts)),
    };
    await cacheSet(key, payload, ttl);
    return { data: payload, source: "live", fetched_at: new Date().toISOString() };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "error";
    return staleCacheOrEmpty(key, emptyData, reason);
  }
}

function chunkDateRange(fromISO: string, toISO: string, maxDays: number) {
  const chunks: Array<{ from: string; to: string }> = [];
  let cur = Date.parse(fromISO + "T00:00:00Z");
  const end = Date.parse(toISO + "T00:00:00Z");
  while (cur <= end) {
    const chunkEnd = Math.min(end, cur + (maxDays - 1) * 86400_000);
    chunks.push({
      from: new Date(cur).toISOString().slice(0, 10),
      to: new Date(chunkEnd).toISOString().slice(0, 10),
    });
    cur = chunkEnd + 86400_000;
  }
  return chunks;
}

export async function validatePriceMarket(
  zone: PriceMarketCode,
  dayISO: string,
): Promise<{
  market: PriceMarketCode;
  eic: string;
  intervals: number;
  intervalResolutionMinutes: number | null;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  source: FetchResult<IntervalPriceSeries>["source"];
  reason?: string;
}> {
  const result = await fetchDayAheadPricesRange(zone, dayISO, dayISO);
  const points = result.data.points;
  const resolutions = [...new Set(points.map((point) => point.durationMinutes))];
  return {
    market: zone,
    eic: PRICE_MARKETS[zone].eic,
    intervals: points.length,
    intervalResolutionMinutes: resolutions.length === 1 ? resolutions[0] : null,
    firstTimestamp: points[0]?.ts ?? null,
    lastTimestamp: points[points.length - 1]?.ts ?? null,
    source: result.source,
    reason: result.reason,
  };
}

export interface FlowSeries {
  from: ZoneCode;
  to: ZoneCode;
  points: Array<{ ts: string; mw: number }>;
}
export interface IntervalFlowSeries {
  from: ZoneCode;
  to: ZoneCode;
  points: Array<{ ts: string; mw: number; durationMinutes: number }>;
}
export async function fetchPhysicalFlows(
  from: ZoneCode,
  to: ZoneCode,
  dayISO: string,
  demo = false,
  force = false,
): Promise<FetchResult<FlowSeries>> {
  const key = `flow:${from}:${to}:${dayISO}`;
  const emptyData: FlowSeries = { from, to, points: [] };
  if (!force) {
    const cached = await cacheGet<FlowSeries>(key, DEFAULT_TTL);
    if (cached) return { data: cached, source: "cache", fetched_at: new Date().toISOString() };
  }
  if (demo) return staleCacheOrEmpty(key, emptyData, "demo_disabled");
  if (!token()) return staleCacheOrEmpty(key, emptyData, "no_token");
  try {
    const { start, end } = belgradeDeliveryWindow(dayISO);
    const xml = await entsoeRaw({
      documentType: ENTSOE_DOCUMENT_TYPES.physical_flows,
      in_Domain: ZONES[to].eic,
      out_Domain: ZONES[from].eic,
      periodStart: ymdh(start),
      periodEnd: ymdh(end),
    });
    const startMs = start.getTime();
    const endMs = end.getTime();
    const series = parseTimeSeriesHourly(xml)
      .filter((p) => {
        const t = Date.parse(p.ts);
        return t >= startMs && t < endMs;
      })
      .map((p) => ({ ts: p.ts, mw: p.value }));
    if (!series.length) return staleCacheOrEmpty(key, emptyData, "no_data");
    const payload: FlowSeries = { from, to, points: series };
    await cacheSet(key, payload, ttlFor(TTL.flow_today, TTL.flow_past, dayISO));
    return { data: payload, source: "live", fetched_at: new Date().toISOString() };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "error";
    return staleCacheOrEmpty(key, emptyData, reason);
  }
}

export async function fetchPhysicalFlowsRange(
  from: ZoneCode,
  to: ZoneCode,
  fromISO: string,
  toISO: string,
  demo = false,
  force = false,
): Promise<FetchResult<IntervalFlowSeries>> {
  const key = `flow_range:v1:${from}:${to}:${fromISO}:${toISO}`;
  const emptyData: IntervalFlowSeries = { from, to, points: [] };
  const ttl = toISO < new Date().toISOString().slice(0, 10) ? TTL.flow_past : TTL.flow_today;
  if (!force) {
    const cached = await cacheGet<IntervalFlowSeries>(key, ttl);
    if (cached) return { data: cached, source: "cache", fetched_at: new Date().toISOString() };
  }
  if (demo) return staleCacheOrEmpty(key, emptyData, "demo_disabled");
  if (!token()) return staleCacheOrEmpty(key, emptyData, "no_token");
  try {
    const startOffsetH = cetOffsetHours(fromISO);
    const start = new Date(Date.parse(fromISO + "T00:00:00Z") - startOffsetH * 3600_000);
    const afterTo = new Date(Date.parse(toISO + "T00:00:00Z") + 24 * 3600_000)
      .toISOString()
      .slice(0, 10);
    const endOffsetH = cetOffsetHours(afterTo);
    const end = new Date(Date.parse(afterTo + "T00:00:00Z") - endOffsetH * 3600_000);
    const xml = await entsoeRaw({
      documentType: ENTSOE_DOCUMENT_TYPES.physical_flows,
      in_Domain: ZONES[to].eic,
      out_Domain: ZONES[from].eic,
      periodStart: ymdh(start),
      periodEnd: ymdh(end),
    });
    const startMs = start.getTime();
    const endMs = end.getTime();
    const points = parseTimeSeriesIntervals(xml)
      .filter((p) => {
        const t = Date.parse(p.ts);
        return t >= startMs && t < endMs;
      })
      .map((p) => ({ ts: p.ts, mw: p.value, durationMinutes: p.durationMinutes }));
    if (!points.length) return staleCacheOrEmpty(key, emptyData, "no_data");
    const payload = { from, to, points };
    await cacheSet(key, payload, ttl);
    return { data: payload, source: "live", fetched_at: new Date().toISOString() };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "error";
    return staleCacheOrEmpty(key, emptyData, reason);
  }
}

export interface CapacityRow {
  from: ZoneCode;
  to: ZoneCode;
  product: ProductType;
  price_eur_mwh: number | null;
  offered_mw: number | null;
  allocated_mw: number | null;
  unit_warning?: string;
}
export async function fetchExplicitAllocation(
  from: ZoneCode,
  to: ZoneCode,
  product: ProductType,
  dayISO: string,
  demo = false,
  force = false,
): Promise<FetchResult<CapacityRow>> {
  const key = `cap:${from}:${to}:${product}:${dayISO}`;
  const emptyData: CapacityRow = {
    from,
    to,
    product,
    price_eur_mwh: null,
    offered_mw: null,
    allocated_mw: null,
    unit_warning:
      product !== "daily" ? "Monthly/annual A25 prices may be totals depending on TSO" : undefined,
  };
  const t = token();
  if (!force) {
    const cached = await cacheGet<CapacityRow>(key, DEFAULT_TTL);
    if (cached && (!t || cached.offered_mw != null || cached.allocated_mw != null)) {
      return { data: cached, source: "cache", fetched_at: new Date().toISOString() };
    }
  }
  if (demo) return staleCacheOrEmpty(key, emptyData, "demo_disabled");
  if (!t) return staleCacheOrEmpty(key, emptyData, "no_token");
  try {
    const { start, end } = belgradeDeliveryWindow(dayISO);
    const baseParams = {
      documentType: ENTSOE_DOCUMENT_TYPES.explicit_allocations,
      "contract_MarketAgreement.Type": MARKET_AGREEMENT_TYPES[product],
      in_Domain: ZONES[to].eic,
      out_Domain: ZONES[from].eic,
      periodStart: ymdh(start),
      periodEnd: ymdh(end),
    };

    const allocatedXml = await entsoeRaw({ ...baseParams, businessType: "B05" });
    const allocated = parseAllocationSummary(allocatedXml);

    let offeredMw: number | null = null;
    try {
      const offeredXml = await entsoeRaw({ ...baseParams, businessType: "A31" });
      offeredMw = parseAllocationSummary(offeredXml).quantity_mw;
    } catch {
      offeredMw = null;
    }

    if (allocated.price_eur_mwh == null && allocated.quantity_mw == null && offeredMw == null) {
      return staleCacheOrEmpty(key, emptyData, "no_data");
    }
    const row: CapacityRow = {
      from,
      to,
      product,
      price_eur_mwh: allocated.price_eur_mwh,
      offered_mw: offeredMw,
      allocated_mw: allocated.quantity_mw,
      unit_warning:
        product !== "daily"
          ? "Monthly/annual A25 prices may be totals depending on TSO"
          : undefined,
    };
    await cacheSet(key, row, ttlFor(TTL.cap_today, TTL.cap_past, dayISO));
    return { data: row, source: "live", fetched_at: new Date().toISOString() };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "error";
    return staleCacheOrEmpty(key, emptyData, reason);
  }
}

type OutageAttemptStatus = DataSourceStatus & {
  zone: ZoneCode;
  document_type: string;
  from: string;
  to: string;
  records: number;
};

async function allSettledBounded<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<Array<PromiseSettledResult<T>>> {
  const results: Array<PromiseSettledResult<T>> = new Array(tasks.length);
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const index = cursor++;
      try {
        results[index] = { status: "fulfilled", value: await tasks[index]() };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(tasks.length, 1)) }, worker),
  );
  return results;
}

export async function fetchOutagesRange(
  zone: ZoneCode,
  fromISO: string,
  toISO: string,
  demo = false,
  force = false,
): Promise<FetchResult<OutageRow[]> & { attempts: OutageAttemptStatus[] }> {
  const key = `outages_range:v3:${zone}:${fromISO}:${toISO}`;
  const emptyData: OutageRow[] = [];
  try {
    assertValidDateRange(fromISO, toISO);
  } catch (error) {
    return {
      data: emptyData,
      source: "empty",
      status: "error",
      reason: error instanceof Error ? error.message : "invalid_date_range",
      fetched_at: new Date().toISOString(),
      attempts: [],
    };
  }
  const cached = await cacheGetEntry<OutageRow[]>(key, TTL.outages);
  if (!force) {
    if (cached?.fresh) {
      return {
        data: cached.payload,
        source: "cache",
        status: cached.payload.length ? "cache" : "empty",
        reason: cached.payload.length ? undefined : "entsoe_no_outage_publications",
        fetched_at: cached.fetched_at,
        last_success_at: cached.fetched_at,
        attempts: [],
      };
    }
  }
  if (demo) {
    const result = await staleCacheOrEmpty(key, emptyData, "demo_disabled");
    return { ...result, attempts: [] };
  }
  if (!token()) {
    const result = await staleCacheOrEmpty(key, emptyData, "entsoe_token_missing");
    return { ...result, attempts: [] };
  }

  const tasks = chunkOutageRange(fromISO, toISO).flatMap((chunk) =>
    [
      ENTSOE_DOCUMENT_TYPES.production_unit_unavailability,
      ENTSOE_DOCUMENT_TYPES.generation_unit_unavailability,
    ].map((documentType) => async () => {
      const start = new Date(`${chunk.from}T00:00:00Z`);
      const end = new Date(`${addDaysIso(chunk.to, 1)}T00:00:00Z`);
      const source = `ENTSO-E ${documentType} ${zone}`;
      try {
        const payload = await entsoePayload(
          {
            documentType,
            biddingZone_Domain: ZONES[zone].eic,
            periodStart: ymdh(start),
            periodEnd: ymdh(end),
          },
          { source, from: chunk.from, to: chunk.to },
          true,
        );
        const inspectedDocuments = payload.documents.map((xml) => ({
          xml,
          envelope: inspectEntsoeXml(xml),
        }));
        const dataDocuments = inspectedDocuments.filter(
          (document) => document.envelope.kind === "data",
        );
        const documentErrors = inspectedDocuments.filter(
          (document) => document.envelope.kind === "error",
        );
        if (!dataDocuments.length) {
          throw new EntsoeRequestError(
            documentErrors[0]?.envelope.reason ?? "entsoe_no_data",
            false,
            payload.status,
            payload.contentType,
          );
        }
        const rows = dataDocuments.flatMap(({ xml }) =>
          parseOutageRows(xml, zone, chunk.from, chunk.to),
        );
        const partialReason = documentErrors.length ? "entsoe_partial_zip_documents" : undefined;
        logSourceDiagnostic({
          source,
          from: chunk.from,
          to: chunk.to,
          http_status: payload.status,
          content_type: payload.contentType,
          records: rows.length,
          reason: partialReason ?? (rows.length ? undefined : "entsoe_no_active_outages"),
        });
        const status: OutageAttemptStatus = {
          zone,
          document_type: documentType,
          from: chunk.from,
          to: chunk.to,
          source,
          status: partialReason ? "partial" : rows.length ? "live" : "empty",
          reason: partialReason ?? (rows.length ? undefined : "entsoe_no_outage_publications"),
          fetched_at: new Date().toISOString(),
          last_success_at: new Date().toISOString(),
          records: rows.length,
        };
        return { rows, status };
      } catch (error) {
        const reason = error instanceof Error ? error.message : "entsoe_error";
        const noData = reason === "entsoe_no_data";
        const status: OutageAttemptStatus = {
          zone,
          document_type: documentType,
          from: chunk.from,
          to: chunk.to,
          source,
          status: noData ? "empty" : "error",
          reason: noData ? "entsoe_no_outage_publications" : reason,
          fetched_at: new Date().toISOString(),
          last_success_at: noData ? new Date().toISOString() : undefined,
          records: 0,
        };
        return { rows: [] as OutageRow[], status };
      }
    }),
  );
  const settled = await allSettledBounded(tasks, 3);
  const attempts: OutageAttemptStatus[] = settled.map((result) => {
    if (result.status === "fulfilled") return result.value.status;
    return {
      zone,
      document_type: "unknown",
      from: fromISO,
      to: toISO,
      source: "ENTSO-E outages",
      status: "error",
      reason: result.reason instanceof Error ? result.reason.message : "entsoe_error",
      fetched_at: new Date().toISOString(),
      records: 0,
    };
  });
  const rows = dedupeOutageRevisions(
    settled.flatMap((result) => (result.status === "fulfilled" ? result.value.rows : [])),
  );
  const aggregate = aggregateDataStatus(attempts, "ENTSO-E outages");
  const successfulEmpty = attempts.every((attempt) =>
    ["live", "empty", "cache"].includes(attempt.status),
  );

  if (aggregate.status === "error" && cached?.payload) {
    return {
      data: cached.payload,
      source: "cache",
      status: "partial",
      reason: `stale_cache_${aggregate.reason ?? "entsoe_error"}`,
      fetched_at: cached.fetched_at,
      last_success_at: cached.fetched_at,
      stale: true,
      attempts,
    };
  }
  if (successfulEmpty || rows.length) {
    if (aggregate.status !== "partial") {
      await cacheSet(key, rows, TTL.outages);
    }
  }

  return {
    data: rows,
    source: rows.length ? "live" : "empty",
    status: rows.length && aggregate.status === "error" ? "partial" : aggregate.status,
    reason:
      rows.length && attempts.some((attempt) => attempt.status === "error")
        ? "some_outage_sources_unavailable"
        : aggregate.status === "empty"
          ? "entsoe_no_outage_publications"
          : aggregate.reason,
    fetched_at: aggregate.fetched_at,
    last_success_at: aggregate.last_success_at,
    attempts,
  };
}

export async function fetchOutages(
  zone: ZoneCode,
  dayISO: string,
  demo = false,
  force = false,
): Promise<FetchResult<OutageRow[]>> {
  return fetchOutagesRange(zone, dayISO, dayISO, demo, force);
}

export interface LoadGenPoint {
  ts: string;
  load_mw: number | null;
  gen_mw: number | null;
  loadDurationMinutes: number | null;
  generationDurationMinutes: number | null;
}
export interface ActualLoadPoint {
  ts: string;
  load_mw: number;
  durationMinutes: number;
}
export interface ActualGenerationPoint {
  ts: string;
  gen_mw: number;
  durationMinutes: number;
  production?: Record<string, number>;
}

export async function fetchActualLoadRange(
  zone: ZoneCode,
  fromISO: string,
  toISO: string,
  demo = false,
  force = false,
): Promise<FetchResult<{ zone: ZoneCode; points: ActualLoadPoint[] }>> {
  const key = `actual_load_range:v2:${zone}:${fromISO}:${toISO}`;
  const emptyData = { zone, points: [] as ActualLoadPoint[] };
  const ttl = toISO < new Date().toISOString().slice(0, 10) ? TTL.loadgen_past : TTL.loadgen_today;
  try {
    assertValidDateRange(fromISO, toISO);
  } catch (error) {
    return {
      data: emptyData,
      source: "empty",
      status: "error",
      reason: error instanceof Error ? error.message : "invalid_date_range",
      fetched_at: new Date().toISOString(),
    };
  }
  const cached = await cacheGetEntry<typeof emptyData>(key, ttl);
  if (!force) {
    if (cached?.fresh) {
      return {
        data: cached.payload,
        source: "cache",
        status: cached.payload.points.length ? "cache" : "empty",
        reason: cached.payload.points.length ? undefined : "entsoe_no_load_data",
        fetched_at: cached.fetched_at,
        last_success_at: cached.fetched_at,
      };
    }
  }
  if (demo) return staleCacheOrEmpty(key, emptyData, "demo_disabled");
  if (!token()) return staleCacheOrEmpty(key, emptyData, "entsoe_token_missing");
  try {
    const startOffsetH = cetOffsetHours(fromISO);
    const start = new Date(Date.parse(fromISO + "T00:00:00Z") - startOffsetH * 3600_000);
    const afterTo = new Date(Date.parse(toISO + "T00:00:00Z") + 24 * 3600_000)
      .toISOString()
      .slice(0, 10);
    const endOffsetH = cetOffsetHours(afterTo);
    const end = new Date(Date.parse(afterTo + "T00:00:00Z") - endOffsetH * 3600_000);
    const xml = await entsoeRaw(
      {
        documentType: ENTSOE_DOCUMENT_TYPES.system_total_load,
        processType: "A16",
        outBiddingZone_Domain: ZONES[zone].eic,
        periodStart: ymdh(start),
        periodEnd: ymdh(end),
      },
      { source: `ENTSO-E A65 ${zone}`, from: fromISO, to: toISO },
    );
    const startMs = start.getTime();
    const endMs = end.getTime();
    const byTs = new Map<string, ActualLoadPoint>();
    for (const p of parseTimeSeriesIntervals(xml)) {
      const t = Date.parse(p.ts);
      if (t < startMs || t >= endMs) continue;
      if (!Number.isFinite(p.value) || p.value < 0 || p.durationMinutes <= 0) continue;
      byTs.set(p.ts, { ts: p.ts, load_mw: p.value, durationMinutes: p.durationMinutes });
    }
    const payload = { zone, points: [...byTs.values()].sort((a, b) => a.ts.localeCompare(b.ts)) };
    logSourceDiagnostic({
      source: `ENTSO-E A65 ${zone}`,
      from: fromISO,
      to: toISO,
      http_status: 200,
      content_type: "application/xml",
      records: payload.points.length,
      reason: payload.points.length ? undefined : "entsoe_no_load_data",
    });
    if (!payload.points.length) return staleCacheOrEmpty(key, emptyData, "entsoe_no_load_data");
    await cacheSet(key, payload, ttl);
    const fetchedAt = new Date().toISOString();
    return {
      data: payload,
      source: "live",
      status: "live",
      fetched_at: fetchedAt,
      last_success_at: fetchedAt,
    };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "error";
    return staleCacheOrEmpty(key, emptyData, reason);
  }
}

export async function fetchActualGenerationRange(
  zone: ZoneCode,
  fromISO: string,
  toISO: string,
  demo = false,
  force = false,
): Promise<FetchResult<{ zone: ZoneCode; points: ActualGenerationPoint[] }>> {
  const key = `actual_generation_range:v2:${zone}:${fromISO}:${toISO}`;
  const emptyData = { zone, points: [] as ActualGenerationPoint[] };
  const ttl = toISO < new Date().toISOString().slice(0, 10) ? TTL.loadgen_past : TTL.loadgen_today;
  try {
    assertValidDateRange(fromISO, toISO);
  } catch (error) {
    return {
      data: emptyData,
      source: "empty",
      status: "error",
      reason: error instanceof Error ? error.message : "invalid_date_range",
      fetched_at: new Date().toISOString(),
    };
  }
  const cached = await cacheGetEntry<typeof emptyData>(key, ttl);
  if (!force) {
    if (cached?.fresh) {
      return {
        data: cached.payload,
        source: "cache",
        status: cached.payload.points.length ? "cache" : "empty",
        reason: cached.payload.points.length ? undefined : "entsoe_no_generation_data",
        fetched_at: cached.fetched_at,
        last_success_at: cached.fetched_at,
      };
    }
  }
  if (demo) return staleCacheOrEmpty(key, emptyData, "demo_disabled");
  if (!token()) return staleCacheOrEmpty(key, emptyData, "entsoe_token_missing");
  try {
    const startOffsetH = cetOffsetHours(fromISO);
    const start = new Date(Date.parse(fromISO + "T00:00:00Z") - startOffsetH * 3600_000);
    const afterTo = new Date(Date.parse(toISO + "T00:00:00Z") + 24 * 3600_000)
      .toISOString()
      .slice(0, 10);
    const endOffsetH = cetOffsetHours(afterTo);
    const end = new Date(Date.parse(afterTo + "T00:00:00Z") - endOffsetH * 3600_000);
    const xml = await entsoeRaw(
      {
        documentType: ENTSOE_DOCUMENT_TYPES.actual_generation,
        processType: "A16",
        in_Domain: ZONES[zone].eic,
        periodStart: ymdh(start),
        periodEnd: ymdh(end),
      },
      { source: `ENTSO-E A75 ${zone}`, from: fromISO, to: toISO },
    );
    const startMs = start.getTime();
    const endMs = end.getTime();
    const buckets = new Map<string, { durationMinutes: number; production: Map<string, number> }>();
    for (const p of parseTimeSeriesIntervals(xml)) {
      const t = Date.parse(p.ts);
      if (t < startMs || t >= endMs) continue;
      if (!Number.isFinite(p.value) || p.value < 0 || p.durationMinutes <= 0) continue;
      const productionType = p.productionType ?? "unclassified";
      const cur = buckets.get(p.ts) ?? {
        durationMinutes: p.durationMinutes,
        production: new Map<string, number>(),
      };
      cur.production.set(productionType, (cur.production.get(productionType) ?? 0) + p.value);
      cur.durationMinutes = Math.min(cur.durationMinutes, p.durationMinutes);
      buckets.set(p.ts, cur);
    }
    const points: ActualGenerationPoint[] = [...buckets.entries()]
      .map(([ts, b]) => {
        const production = Object.fromEntries(b.production.entries());
        const techKeys = Object.keys(production).filter((k) => k !== "unclassified" && k !== "B00");
        const useKeys = techKeys.length ? techKeys : Object.keys(production);
        const gen_mw = useKeys.reduce((acc, k) => acc + (production[k] ?? 0), 0);
        return { ts, gen_mw, durationMinutes: b.durationMinutes, production };
      })
      .filter((point) => Number.isFinite(point.gen_mw) && point.gen_mw >= 0)
      .sort((a, b) => a.ts.localeCompare(b.ts));
    const payload = { zone, points };
    logSourceDiagnostic({
      source: `ENTSO-E A75 ${zone}`,
      from: fromISO,
      to: toISO,
      http_status: 200,
      content_type: "application/xml",
      records: payload.points.length,
      reason: payload.points.length ? undefined : "entsoe_no_generation_data",
    });
    if (!payload.points.length)
      return staleCacheOrEmpty(key, emptyData, "entsoe_no_generation_data");
    await cacheSet(key, payload, ttl);
    const fetchedAt = new Date().toISOString();
    return {
      data: payload,
      source: "live",
      status: "live",
      fetched_at: fetchedAt,
      last_success_at: fetchedAt,
    };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "error";
    return staleCacheOrEmpty(key, emptyData, reason);
  }
}

export type LoadGenerationResult = FetchResult<LoadGenerationPoint[]> & {
  load: DataSourceStatus;
  generation: DataSourceStatus;
};

function fetchResultStatus<T>(source: string, result: FetchResult<T>): DataSourceStatus {
  return {
    source,
    status:
      result.status ??
      (result.source === "live"
        ? "live"
        : result.source === "cache"
          ? "cache"
          : result.reason === "entsoe_no_data"
            ? "empty"
            : "error"),
    reason: result.reason,
    fetched_at: result.fetched_at,
    last_success_at: result.last_success_at,
    stale: result.stale,
  };
}

export async function fetchLoadGenRange(
  zone: ZoneCode,
  fromISO: string,
  toISO: string,
  demo = false,
  force = false,
): Promise<LoadGenerationResult> {
  try {
    assertValidDateRange(fromISO, toISO);
  } catch (error) {
    const failed: DataSourceStatus = {
      source: "ENTSO-E",
      status: "error",
      reason: error instanceof Error ? error.message : "invalid_date_range",
      fetched_at: new Date().toISOString(),
    };
    return {
      data: [],
      source: "empty",
      status: "error",
      reason: failed.reason,
      fetched_at: failed.fetched_at,
      load: { ...failed, source: "ENTSO-E A65 actual load" },
      generation: { ...failed, source: "ENTSO-E A75 actual generation" },
    };
  }

  type ChunkResult =
    | {
        kind: "load";
        result: Awaited<ReturnType<typeof fetchActualLoadRange>>;
      }
    | {
        kind: "generation";
        result: Awaited<ReturnType<typeof fetchActualGenerationRange>>;
      };
  const tasks: Array<() => Promise<ChunkResult>> = chunkOutageRange(fromISO, toISO).flatMap(
    (chunk) => [
      async () => ({
        kind: "load" as const,
        result: await fetchActualLoadRange(zone, chunk.from, chunk.to, demo, force),
      }),
      async () => ({
        kind: "generation" as const,
        result: await fetchActualGenerationRange(zone, chunk.from, chunk.to, demo, force),
      }),
    ],
  );
  const settled = await allSettledBounded(tasks, 4);

  const loadPoints: ActualLoadPoint[] = [];
  const generationPoints: ActualGenerationPoint[] = [];
  const loadStatuses: DataSourceStatus[] = [];
  const generationStatuses: DataSourceStatus[] = [];
  settled.forEach((result, index) => {
    const expectedKind = index % 2 === 0 ? "load" : "generation";
    if (result.status === "rejected") {
      const status: DataSourceStatus = {
        source:
          expectedKind === "load" ? "ENTSO-E A65 actual load" : "ENTSO-E A75 actual generation",
        status: "error",
        reason: result.reason instanceof Error ? result.reason.message : "entsoe_error",
        fetched_at: new Date().toISOString(),
      };
      (expectedKind === "load" ? loadStatuses : generationStatuses).push(status);
      return;
    }
    if (result.value.kind === "load") {
      loadPoints.push(...result.value.result.data.points);
      loadStatuses.push(fetchResultStatus("ENTSO-E A65 actual load", result.value.result));
    } else {
      generationPoints.push(...result.value.result.data.points);
      generationStatuses.push(
        fetchResultStatus("ENTSO-E A75 actual generation", result.value.result),
      );
    }
  });

  const load = aggregateDataStatus(loadStatuses, "ENTSO-E A65 actual load");
  const generation = aggregateDataStatus(generationStatuses, "ENTSO-E A75 actual generation");
  const data = mergeLoadGeneration(loadPoints, generationPoints);
  const oneSeriesAvailable =
    data.some((point) => point.load_mw != null) !== data.some((point) => point.gen_mw != null);
  const bothUnavailable =
    !data.some((point) => point.load_mw != null) && !data.some((point) => point.gen_mw != null);
  const status: DataStatus = bothUnavailable
    ? load.status === "empty" && generation.status === "empty"
      ? "empty"
      : "error"
    : oneSeriesAvailable || load.status === "partial" || generation.status === "partial"
      ? "partial"
      : load.status === "cache" && generation.status === "cache"
        ? "cache"
        : "live";
  const source =
    status === "cache" ? "cache" : status === "error" || status === "empty" ? "empty" : "live";
  const reasons = [
    load.status === "error" || load.status === "partial" ? `load: ${load.reason}` : null,
    generation.status === "error" || generation.status === "partial"
      ? `generation: ${generation.reason}`
      : null,
  ].filter((reason): reason is string => Boolean(reason));
  const fetchedAt =
    [load.last_success_at, generation.last_success_at].filter(Boolean).sort().at(-1) ??
    new Date().toISOString();
  return {
    data,
    source,
    status,
    reason: reasons.length ? reasons.join("; ") : status === "empty" ? "entsoe_no_data" : undefined,
    fetched_at: fetchedAt,
    last_success_at: fetchedAt,
    stale: load.stale || generation.stale,
    load,
    generation,
  };
}

export async function fetchLoadGen(
  zone: ZoneCode,
  dayISO: string,
  demo = false,
  force = false,
): Promise<LoadGenerationResult> {
  return fetchLoadGenRange(zone, dayISO, dayISO, demo, force);
}
