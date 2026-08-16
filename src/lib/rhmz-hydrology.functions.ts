import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const RHMZ_BASE = "https://www.hidmet.gov.rs/latin/osmotreni/nrt_tabela_grafik.php";
const CACHE_KEY = "rhmz_danube_water_levels:v1";
const TTL_SECONDS = 60 * 60;

export type RhmzWaterLevelPoint = {
  ts: string;
  level_cm: number;
};

export type RhmzWaterLevelStation = {
  id: string;
  name: string;
  river: "Danube";
  gauge_zero_m: number;
  source: "RHMZ";
  source_url: string;
  status: "live" | "empty";
  latest_observation: string | null;
  latest_level_cm: number | null;
  change_24h_cm: number | null;
  min_7d_cm: number | null;
  max_7d_cm: number | null;
  data: RhmzWaterLevelPoint[];
  reason?: string;
};

type CachedPayload = {
  stations: RhmzWaterLevelStation[];
  fetchedAt: string;
};

const STATIONS = [
  { id: "42010", name: "Bezdan", gaugeZeroM: 80.64 },
  { id: "42035", name: "Novi Sad", gaugeZeroM: 71.73 },
  { id: "42045", name: "Zemun", gaugeZeroM: 67.87 },
  { id: "42055", name: "Smederevo", gaugeZeroM: 65.36 },
] as const;

function stationUrl(id: string) {
  return `${RHMZ_BASE}?hm_id=${id}&period=7`;
}

async function cacheGet(freshOnly: boolean): Promise<CachedPayload | null> {
  try {
    const { data } = await supabaseAdmin
      .from("api_cache")
      .select("payload, fetched_at, ttl_seconds")
      .eq("key", CACHE_KEY)
      .maybeSingle();
    if (!data?.payload) return null;
    if (freshOnly) {
      const ageSeconds = (Date.now() - Date.parse(data.fetched_at as string)) / 1000;
      if (ageSeconds > (data.ttl_seconds ?? TTL_SECONDS)) return null;
    }
    return data.payload as CachedPayload;
  } catch {
    return null;
  }
}

async function cacheSet(payload: CachedPayload) {
  try {
    await supabaseAdmin.from("api_cache").upsert({
      key: CACHE_KEY,
      payload: payload as never,
      fetched_at: new Date().toISOString(),
      ttl_seconds: TTL_SECONDS,
    });
  } catch {
    // Cache is best effort. Live RHMZ data can still be returned.
  }
}

async function fetchText(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "sr-Latn-RS,sr;q=0.9,en;q=0.8",
        "user-agent": "Mozilla/5.0 (compatible; CEADash/1.0; +https://cea.org.rs)",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`rhmz_http_${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function cleanText(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function numberOrNull(value: string) {
  const normalized = value.replace(",", ".").replace(/[^0-9+\-.]/g, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseRhmzWaterLevelRows(html: string): RhmzWaterLevelPoint[] {
  const rows: RhmzWaterLevelPoint[] = [];
  const trs = html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
  const dateTimeRe = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/;

  for (const tr of trs) {
    const cells = (tr.match(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi) ?? []).map(cleanText);
    for (let index = 0; index < cells.length - 1; index += 1) {
      const match = dateTimeRe.exec(cells[index]);
      if (!match) continue;
      const level = numberOrNull(cells[index + 1]);
      if (level == null || level < -2_000 || level > 5_000) continue;

      const [, day, month, year, hour, minute] = match;
      // RHMZ explicitly labels these operational timestamps as UTC+1.
      const ts = new Date(`${year}-${month}-${day}T${hour}:${minute}:00+01:00`).toISOString();
      rows.push({ ts, level_cm: level });
    }
  }

  const deduped = new Map<string, RhmzWaterLevelPoint>();
  for (const row of rows) deduped.set(row.ts, row);
  return [...deduped.values()].sort((a, b) => a.ts.localeCompare(b.ts));
}

function summarize(points: RhmzWaterLevelPoint[]) {
  const latest = points.at(-1) ?? null;
  if (!latest) {
    return {
      latestObservation: null,
      latestLevel: null,
      change24h: null,
      min7d: null,
      max7d: null,
    };
  }

  const targetMs = Date.parse(latest.ts) - 24 * 60 * 60 * 1000;
  let previous: RhmzWaterLevelPoint | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const distance = Math.abs(Date.parse(point.ts) - targetMs);
    if (distance < bestDistance) {
      bestDistance = distance;
      previous = point;
    }
  }
  if (bestDistance > 2 * 60 * 60 * 1000) previous = null;

  const levels = points.map((point) => point.level_cm);
  return {
    latestObservation: latest.ts,
    latestLevel: latest.level_cm,
    change24h: previous ? latest.level_cm - previous.level_cm : null,
    min7d: Math.min(...levels),
    max7d: Math.max(...levels),
  };
}

async function fetchStation(station: (typeof STATIONS)[number]): Promise<RhmzWaterLevelStation> {
  const sourceUrl = stationUrl(station.id);
  try {
    const html = await fetchText(sourceUrl);
    const points = parseRhmzWaterLevelRows(html);
    const stats = summarize(points);
    return {
      id: station.id,
      name: station.name,
      river: "Danube",
      gauge_zero_m: station.gaugeZeroM,
      source: "RHMZ",
      source_url: sourceUrl,
      status: points.length ? "live" : "empty",
      latest_observation: stats.latestObservation,
      latest_level_cm: stats.latestLevel,
      change_24h_cm: stats.change24h,
      min_7d_cm: stats.min7d,
      max_7d_cm: stats.max7d,
      data: points,
      ...(points.length ? {} : { reason: "rhmz_no_hourly_rows" }),
    };
  } catch (error) {
    return {
      id: station.id,
      name: station.name,
      river: "Danube",
      gauge_zero_m: station.gaugeZeroM,
      source: "RHMZ",
      source_url: sourceUrl,
      status: "empty",
      latest_observation: null,
      latest_level_cm: null,
      change_24h_cm: null,
      min_7d_cm: null,
      max_7d_cm: null,
      data: [],
      reason: error instanceof Error ? error.message : "rhmz_fetch_error",
    };
  }
}

export const getDanubeWaterLevels = createServerFn({ method: "GET" })
  .inputValidator((data: { force?: boolean }) => data ?? {})
  .handler(async ({ data }) => {
    if (!data.force) {
      const cached = await cacheGet(true);
      if (cached) return { ...cached, source: "cache" as const };
    }

    try {
      const stations = await Promise.all(STATIONS.map(fetchStation));
      if (!stations.some((station) => station.data.length > 0)) {
        throw new Error("rhmz_no_station_data");
      }
      const payload: CachedPayload = {
        stations,
        fetchedAt: new Date().toISOString(),
      };
      await cacheSet(payload);
      return { ...payload, source: "live" as const };
    } catch (error) {
      const stale = await cacheGet(false);
      if (stale) {
        return {
          ...stale,
          source: "cache" as const,
          reason: `stale_cache:${error instanceof Error ? error.message : "rhmz_error"}`,
        };
      }
      return {
        stations: [] as RhmzWaterLevelStation[],
        fetchedAt: new Date().toISOString(),
        source: "empty" as const,
        reason: error instanceof Error ? error.message : "rhmz_error",
      };
    }
  });
