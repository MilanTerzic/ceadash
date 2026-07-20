import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  aggregateDataStatus,
  assertValidDateRange,
  chunkDateRange,
  filterPlausibleDanubeDischarge,
  kmhToMs,
  mergeWeatherPoints,
  normalizeDischargePayload,
  normalizeOpenMeteoWeather,
  selectBestHydrologyCandidate,
  splitWeatherRange,
  type Coordinates,
  type DataSourceStatus,
  type DischargePoint,
  type HydrologyCandidate,
  type WeatherPoint,
} from "./fundamentals";
import { ZONES, type ZoneCode } from "./markets";
import { logSourceDiagnostic } from "./source-diagnostics.server";

export type { DataSourceStatus, DischargePoint, WeatherPoint } from "./fundamentals";

const WEATHER_TTL_TODAY = 60 * 60;
const WEATHER_TTL_PAST = 7 * 24 * 3600;
const DISCHARGE_TTL = 6 * 3600;
const WEATHER_CHUNK_DAYS = 92;
const HYDROLOGY_SOURCE = "open-meteo";
const OPEN_METEO_MIN_REQUEST_GAP_MS = 350;

const memoryCache = new Map<string, CacheEntry<unknown>>();
let openMeteoQueue: Promise<void> = Promise.resolve();
let lastOpenMeteoRequestAt = 0;

type CacheEntry<T> = {
  payload: T;
  fetched_at: string;
  ttl_seconds: number;
  fresh: boolean;
};

class SourceRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly contentType?: string,
  ) {
    super(message);
  }
}

async function cacheRead<T>(key: string): Promise<CacheEntry<T> | null> {
  const memoryEntry = memoryCache.get(key) as CacheEntry<T> | undefined;
  if (memoryEntry) {
    const ageSeconds = (Date.now() - new Date(memoryEntry.fetched_at).getTime()) / 1000;
    return { ...memoryEntry, fresh: ageSeconds <= memoryEntry.ttl_seconds };
  }
  try {
    const { data } = await supabaseAdmin
      .from("api_cache")
      .select("payload, fetched_at, ttl_seconds")
      .eq("key", key)
      .maybeSingle();
    if (!data) return null;
    const fetchedAt = String(data.fetched_at);
    const ttlSeconds = Number(data.ttl_seconds ?? 1800);
    const ageSeconds = (Date.now() - new Date(fetchedAt).getTime()) / 1000;
    const entry = {
      payload: data.payload as T,
      fetched_at: fetchedAt,
      ttl_seconds: ttlSeconds,
      fresh: ageSeconds <= ttlSeconds,
    };
    memoryCache.set(key, entry as CacheEntry<unknown>);
    return entry;
  } catch {
    return null;
  }
}

async function cacheSet(key: string, payload: unknown, ttl: number, fetchedAt: string) {
  memoryCache.set(key, {
    payload,
    fetched_at: fetchedAt,
    ttl_seconds: ttl,
    fresh: true,
  });
  try {
    const { error } = await supabaseAdmin.from("api_cache").upsert({
      key,
      payload: payload as never,
      fetched_at: fetchedAt,
      ttl_seconds: ttl,
    });
    if (error && process.env.NODE_ENV !== "production") {
      console.warn(`[api_cache] write failed for ${key.split(":").slice(0, 3).join(":")}`);
    }
  } catch {
    // Cache persistence is best-effort; valid live data must still be returned.
  }
}

async function waitForOpenMeteoSlot(url: string): Promise<void> {
  if (!/open-meteo\.com/i.test(url)) return;
  const previous = openMeteoQueue;
  let release!: () => void;
  openMeteoQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  const now = Date.now();
  const waitMs = Math.max(0, OPEN_METEO_MIN_REQUEST_GAP_MS - (now - lastOpenMeteoRequestAt));
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastOpenMeteoRequestAt = Date.now();
  release();
}

function isRetryableStatus(status?: number): boolean {
  return status === 429 || status === 408 || (status != null && status >= 500);
}

async function fetchJson(
  url: string,
  diagnostic: { source: string; from: string; to: string },
  timeoutMs = 15_000,
): Promise<{ json: unknown; status: number; contentType: string }> {
  let lastError: SourceRequestError | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await waitForOpenMeteoSlot(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      const contentType = response.headers.get("content-type") ?? "";
      const body = await response.text();
      if (!response.ok) {
        const reason = `http_${response.status}`;
        const error = new SourceRequestError(reason, response.status, contentType);
        if (isRetryableStatus(response.status) && attempt < 2) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 900 * 2 ** attempt));
          continue;
        }
        logSourceDiagnostic({
          ...diagnostic,
          http_status: response.status,
          content_type: contentType,
          records: 0,
          reason,
        });
        throw error;
      }
      if (!contentType.toLowerCase().includes("json")) {
        logSourceDiagnostic({
          ...diagnostic,
          http_status: response.status,
          content_type: contentType,
          records: 0,
          reason: "unexpected_content_type",
        });
        throw new SourceRequestError("unexpected_content_type", response.status, contentType);
      }
      try {
        return { json: JSON.parse(body), status: response.status, contentType };
      } catch {
        logSourceDiagnostic({
          ...diagnostic,
          http_status: response.status,
          content_type: contentType,
          records: 0,
          reason: "invalid_json",
        });
        throw new SourceRequestError("invalid_json", response.status, contentType);
      }
    } catch (error) {
      const normalized =
        error instanceof SourceRequestError
          ? error
          : new SourceRequestError(
              error instanceof Error && error.name === "AbortError"
                ? "request_timeout"
                : "network_error",
            );
      if (isRetryableStatus(normalized.status) && attempt < 2) {
        lastError = normalized;
        await new Promise((resolve) => setTimeout(resolve, 900 * 2 ** attempt));
        continue;
      }
      logSourceDiagnostic({
        ...diagnostic,
        http_status: normalized.status,
        content_type: normalized.contentType,
        records: 0,
        reason: normalized.message,
      });
      throw normalized;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError ?? new SourceRequestError("network_error");
}

function statusFromCache(
  source: string,
  fetchedAt: string,
  stale: boolean,
  reason?: string,
): DataSourceStatus {
  return {
    source,
    status: stale ? "partial" : "cache",
    reason,
    fetched_at: fetchedAt,
    last_success_at: fetchedAt,
    stale,
  };
}

function visualCrossingConfigured(): boolean {
  return Boolean(process.env.VISUAL_CROSSING_API_KEY?.trim());
}

async function fetchWeatherVisualCrossingRange(
  lat: number,
  lon: number,
  from: string,
  to: string,
): Promise<WeatherPoint[]> {
  const key = process.env.VISUAL_CROSSING_API_KEY?.trim();
  if (!key) throw new SourceRequestError("visual_crossing_not_configured");
  const url =
    `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/` +
    `${lat},${lon}/${from}/${to}?unitGroup=metric&include=hours&` +
    `elements=datetimeEpoch,temp,windspeed&key=${encodeURIComponent(key)}&contentType=json`;
  const response = await fetchJson(url, { source: "visual-crossing", from, to });
  const days = (
    response.json as {
      days?: Array<{
        hours?: Array<{ datetimeEpoch?: unknown; temp?: unknown; windspeed?: unknown }>;
      }>;
    }
  ).days;
  const points: WeatherPoint[] = [];
  for (const day of Array.isArray(days) ? days : []) {
    for (const hour of Array.isArray(day.hours) ? day.hours : []) {
      const epoch = Number(hour.datetimeEpoch);
      const temp = Number(hour.temp);
      const windKmh = Number(hour.windspeed);
      if (
        !Number.isFinite(epoch) ||
        !Number.isFinite(temp) ||
        !Number.isFinite(windKmh) ||
        windKmh < 0
      ) {
        continue;
      }
      points.push({
        ts: new Date(epoch * 1000).toISOString(),
        temp_c: temp,
        wind_ms: kmhToMs(windKmh),
        source: "visual-crossing",
      });
    }
  }
  const data = mergeWeatherPoints([points]);
  logSourceDiagnostic({
    source: "visual-crossing",
    from,
    to,
    http_status: response.status,
    content_type: response.contentType,
    records: data.length,
    reason: data.length ? undefined : "no_valid_observations",
  });
  return data;
}

type WeatherResult = DataSourceStatus & { data: WeatherPoint[] };

export async function fetchWeather(zone: ZoneCode, day: string): Promise<WeatherResult> {
  return fetchWeatherRange(zone, day, day);
}

export async function fetchWeatherRange(
  zone: ZoneCode,
  from: string,
  to: string,
  force = false,
): Promise<WeatherResult> {
  const attemptedAt = new Date().toISOString();
  try {
    assertValidDateRange(from, to);
  } catch (error) {
    return {
      data: [],
      source: "Open-Meteo weather",
      status: "error",
      reason: error instanceof Error ? error.message : "invalid_date_range",
      fetched_at: attemptedAt,
    };
  }

  const coordinates = ZONES[zone].capital;
  if (!coordinates) {
    return {
      data: [],
      source: "Open-Meteo weather",
      status: "error",
      reason: "zone_coordinates_not_configured",
      fetched_at: attemptedAt,
    };
  }

  const segmentResults: Array<DataSourceStatus & { data: WeatherPoint[] }> = [];
  const segmentKinds = new Set<string>();
  for (const segment of splitWeatherRange(from, to)) {
    for (const chunk of chunkDateRange(segment.from, segment.to, WEATHER_CHUNK_DAYS)) {
      const source =
        segment.kind === "historical" ? "open-meteo-historical" : "open-meteo-forecast";
      segmentKinds.add(source);
      const cacheKey = `weather:v2:${segment.kind}:${zone}:${chunk.from}:${chunk.to}`;
      const cached = await cacheRead<{ data: WeatherPoint[]; source: string }>(cacheKey);
      if (!force && cached?.fresh) {
        segmentResults.push({
          data: cached.payload.data,
          ...statusFromCache(cached.payload.source, cached.fetched_at, false),
        });
        continue;
      }

      const endpoint =
        segment.kind === "historical"
          ? "https://archive-api.open-meteo.com/v1/archive"
          : "https://api.open-meteo.com/v1/forecast";
      const query = new URLSearchParams({
        latitude: String(coordinates.lat),
        longitude: String(coordinates.lon),
        hourly: "temperature_2m,wind_speed_10m",
        wind_speed_unit: "ms",
        start_date: chunk.from,
        end_date: chunk.to,
        timezone: "UTC",
      });
      try {
        const response = await fetchJson(`${endpoint}?${query}`, {
          source,
          from: chunk.from,
          to: chunk.to,
        });
        const data = normalizeOpenMeteoWeather(response.json, source);
        logSourceDiagnostic({
          source,
          from: chunk.from,
          to: chunk.to,
          http_status: response.status,
          content_type: response.contentType,
          records: data.length,
          reason: data.length ? undefined : "no_valid_observations",
        });
        if (!data.length) throw new SourceRequestError("no_valid_observations");
        const fetchedAt = new Date().toISOString();
        await cacheSet(
          cacheKey,
          { data, source },
          segment.kind === "historical" ? WEATHER_TTL_PAST : WEATHER_TTL_TODAY,
          fetchedAt,
        );
        segmentResults.push({
          data,
          source,
          status: "live",
          fetched_at: fetchedAt,
          last_success_at: fetchedAt,
        });
      } catch (primaryError) {
        let fallbackData: WeatherPoint[] = [];
        let fallbackReason: string | undefined;
        if (visualCrossingConfigured()) {
          try {
            fallbackData = await fetchWeatherVisualCrossingRange(
              coordinates.lat,
              coordinates.lon,
              chunk.from,
              chunk.to,
            );
          } catch (fallbackError) {
            fallbackReason =
              fallbackError instanceof Error ? fallbackError.message : "visual_crossing_error";
          }
        }
        if (fallbackData.length) {
          const fetchedAt = new Date().toISOString();
          await cacheSet(
            cacheKey,
            { data: fallbackData, source: "visual-crossing" },
            segment.kind === "historical" ? WEATHER_TTL_PAST : WEATHER_TTL_TODAY,
            fetchedAt,
          );
          segmentResults.push({
            data: fallbackData,
            source: "visual-crossing",
            status: "live",
            reason: "open_meteo_unavailable",
            fetched_at: fetchedAt,
            last_success_at: fetchedAt,
          });
        } else if (cached?.payload.data.length) {
          segmentResults.push({
            data: cached.payload.data,
            ...statusFromCache(
              cached.payload.source,
              cached.fetched_at,
              true,
              `live_fetch_failed_${primaryError instanceof Error ? primaryError.message : "error"}`,
            ),
          });
        } else {
          const primaryReason =
            primaryError instanceof Error ? primaryError.message : "open_meteo_error";
          segmentResults.push({
            data: [],
            source,
            status: "error",
            reason: fallbackReason
              ? `${primaryReason}; visual_crossing_${fallbackReason}`
              : primaryReason,
            fetched_at: attemptedAt,
          });
        }
      }
    }
  }

  const data = mergeWeatherPoints(segmentResults.map((result) => result.data));
  const aggregate = aggregateDataStatus(segmentResults, [...segmentKinds].join(" + "));
  const failedSegments = segmentResults.filter((result) => result.status === "error").length;
  return {
    data,
    ...aggregate,
    status: failedSegments && data.length ? "partial" : aggregate.status,
    reason:
      failedSegments && data.length
        ? `${failedSegments}_weather_segments_unavailable`
        : aggregate.reason,
  };
}

export type RiverDischargeResult = DataSourceStatus & {
  data: DischargePoint[];
  requested_coordinates: Coordinates;
  query_coordinates: Coordinates | null;
  selected_coordinates: Coordinates | null;
  latest_observation?: string;
};

const HYDROLOGY_OFFSET_GROUPS: Coordinates[][] = [
  [
    { lat: 0.05, lon: 0 },
    { lat: -0.05, lon: 0 },
    { lat: 0, lon: 0.05 },
    { lat: 0, lon: -0.05 },
  ],
  [
    { lat: 0.1, lon: 0 },
    { lat: -0.1, lon: 0 },
    { lat: 0, lon: 0.1 },
    { lat: 0, lon: -0.1 },
  ],
  [
    { lat: -0.05, lon: -0.1 },
    { lat: -0.1, lon: -0.1 },
    { lat: 0.05, lon: -0.1 },
    { lat: -0.05, lon: 0.1 },
  ],
];

const HYDROLOGY_PREFERRED_COORDINATES: Record<
  string,
  { candidates?: Coordinates[]; skipOffsetFallback?: boolean; unavailableReason?: string }
> = {
  "45.850,18.960": {
    skipOffsetFallback: true,
    unavailableReason: "no_plausible_danube_grid_cell",
  },
  "45.260,19.850": { candidates: [{ lat: 45.21, lon: 19.85 }] },
  "44.870,20.650": { candidates: [{ lat: 44.82, lon: 20.55 }] },
  "44.660,20.930": {
    candidates: [
      { lat: 44.66, lon: 20.88 },
      { lat: 44.71, lon: 20.93 },
    ],
  },
};

function coordinateKey(coordinates: Coordinates): string {
  return `${coordinates.lat.toFixed(3)},${coordinates.lon.toFixed(3)}`;
}

async function fetchDischargeCandidate(
  coordinates: Coordinates,
  from: string,
  to: string,
): Promise<HydrologyCandidate> {
  const query = new URLSearchParams({
    latitude: String(coordinates.lat),
    longitude: String(coordinates.lon),
    daily: "river_discharge",
    start_date: from,
    end_date: to,
    timezone: "UTC",
    cell_selection: "nearest",
  });
  const response = await fetchJson(`https://flood-api.open-meteo.com/v1/flood?${query}`, {
    source: "open-meteo-hydrology",
    from,
    to,
  });
  const normalized = normalizeDischargePayload(response.json);
  // A Danube station cannot have a genuine zero-flow series. Open-Meteo uses
  // zero-filled cells away from the river network, so reject those cells and
  // continue through the bounded nearby-cell search.
  const data = filterPlausibleDanubeDischarge(normalized.data);
  logSourceDiagnostic({
    source: "open-meteo-hydrology",
    from,
    to,
    http_status: response.status,
    content_type: response.contentType,
    records: data.length,
    reason: data.length ? undefined : "no_valid_discharge_observations",
  });
  return {
    data,
    query_coordinates: coordinates,
    selected_coordinates: normalized.selected_coordinates ?? coordinates,
  };
}

export async function fetchRiverDischarge(
  lat: number,
  lon: number,
  from: string,
  to: string,
  force = false,
): Promise<RiverDischargeResult> {
  const requested = { lat, lon };
  const attemptedAt = new Date().toISOString();
  try {
    assertValidDateRange(from, to);
    if (![lat, lon].every(Number.isFinite)) throw new Error("invalid_coordinates");
  } catch (error) {
    return {
      data: [],
      source: "Open-Meteo hydrology",
      status: "error",
      reason: error instanceof Error ? error.message : "invalid_request",
      fetched_at: attemptedAt,
      requested_coordinates: requested,
      query_coordinates: null,
      selected_coordinates: null,
    };
  }

  const cacheKey = `hydrology:v4:${lat.toFixed(3)},${lon.toFixed(3)}:${from}:${to}`;
  const cached = await cacheRead<{
    data: DischargePoint[];
    query_coordinates: Coordinates;
    selected_coordinates: Coordinates;
  }>(cacheKey);
  if (!force && cached?.fresh) {
    return {
      data: cached.payload.data,
      ...statusFromCache("cache", cached.fetched_at, false),
      requested_coordinates: requested,
      query_coordinates: cached.payload.query_coordinates,
      selected_coordinates: cached.payload.selected_coordinates,
      latest_observation: cached.payload.data.at(-1)?.date,
    };
  }

  const errors: string[] = [];
  const strategy = HYDROLOGY_PREFERRED_COORDINATES[coordinateKey(requested)];
  try {
    const primary = await fetchDischargeCandidate(requested, from, to);
    if (primary.data.length) {
      const fetchedAt = new Date().toISOString();
      await cacheSet(cacheKey, primary, DISCHARGE_TTL, fetchedAt);
      return {
        ...primary,
        source: HYDROLOGY_SOURCE,
        status: "live",
        fetched_at: fetchedAt,
        last_success_at: fetchedAt,
        requested_coordinates: requested,
        latest_observation: primary.data.at(-1)?.date,
      };
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "primary_request_failed");
  }

  for (const coordinates of strategy?.candidates ?? []) {
    try {
      const candidate = await fetchDischargeCandidate(coordinates, from, to);
      if (candidate.data.length) {
        const fetchedAt = new Date().toISOString();
        await cacheSet(cacheKey, candidate, DISCHARGE_TTL, fetchedAt);
        return {
          ...candidate,
          source: HYDROLOGY_SOURCE,
          status: "live",
          reason: "nearby_grid_cell_selected",
          fetched_at: fetchedAt,
          last_success_at: fetchedAt,
          requested_coordinates: requested,
          latest_observation: candidate.data.at(-1)?.date,
        };
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "preferred_grid_request_failed");
    }
  }

  if (strategy?.skipOffsetFallback) {
    errors.push(strategy.unavailableReason ?? "no_valid_discharge_observations");
  }

  let selected: HydrologyCandidate | null = null;
  if (!strategy?.skipOffsetFallback) {
    for (const group of HYDROLOGY_OFFSET_GROUPS) {
      const candidates: HydrologyCandidate[] = [];
      for (const offset of group) {
        try {
          const candidate = await fetchDischargeCandidate(
            { lat: lat + offset.lat, lon: lon + offset.lon },
            from,
            to,
          );
          if (candidate.data.length) {
            candidates.push(candidate);
            break;
          }
        } catch (error) {
          errors.push(error instanceof Error ? error.message : "offset_request_failed");
        }
      }
      selected = selectBestHydrologyCandidate(candidates);
      if (selected) break;
    }
  }

  if (selected) {
    const fetchedAt = new Date().toISOString();
    await cacheSet(cacheKey, selected, DISCHARGE_TTL, fetchedAt);
    return {
      ...selected,
      source: HYDROLOGY_SOURCE,
      status: "live",
      reason: "nearby_grid_cell_selected",
      fetched_at: fetchedAt,
      last_success_at: fetchedAt,
      requested_coordinates: requested,
      latest_observation: selected.data.at(-1)?.date,
    };
  }

  if (cached?.payload.data.length) {
    return {
      data: cached.payload.data,
      ...statusFromCache("cache", cached.fetched_at, true, errors[0] ?? "live_fetch_failed"),
      requested_coordinates: requested,
      query_coordinates: cached.payload.query_coordinates,
      selected_coordinates: cached.payload.selected_coordinates,
      latest_observation: cached.payload.data.at(-1)?.date,
    };
  }

  return {
    data: [],
    source: "none",
    status: errors.length ? "error" : "empty",
    reason: errors[0] ?? "no_valid_discharge_observations",
    fetched_at: attemptedAt,
    requested_coordinates: requested,
    query_coordinates: null,
    selected_coordinates: null,
  };
}
