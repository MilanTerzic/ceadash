export type DataStatus = "live" | "cache" | "partial" | "empty" | "error";

export type DataSourceStatus = {
  source: string;
  status: DataStatus;
  reason?: string;
  fetched_at: string;
  last_success_at?: string;
  stale?: boolean;
};

export type WeatherPoint = {
  ts: string;
  temp_c: number;
  wind_ms: number;
  source: "open-meteo-historical" | "open-meteo-forecast" | "visual-crossing";
};

export type WeatherRangeSegment = {
  kind: "historical" | "forecast";
  from: string;
  to: string;
};

export type DischargePoint = {
  date: string;
  discharge_m3s: number;
};

export type Coordinates = {
  lat: number;
  lon: number;
};

export type HydrologyCandidate = {
  data: DischargePoint[];
  query_coordinates: Coordinates;
  selected_coordinates: Coordinates;
};

export type LoadPoint = {
  ts: string;
  load_mw: number;
  durationMinutes: number;
};

export type GenerationPoint = {
  ts: string;
  gen_mw: number;
  durationMinutes: number;
};

export type LoadGenerationPoint = {
  ts: string;
  load_mw: number | null;
  gen_mw: number | null;
  loadDurationMinutes: number | null;
  generationDurationMinutes: number | null;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function assertValidDateRange(from: string, to: string): void {
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
    throw new Error("invalid_date");
  }
  if (from > to) throw new Error("invalid_date_range");
}

export function addDaysIso(day: string, days: number): string {
  if (!isValidIsoDate(day)) throw new Error("invalid_date");
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function splitWeatherRange(
  from: string,
  to: string,
  today = new Date().toISOString().slice(0, 10),
): WeatherRangeSegment[] {
  assertValidDateRange(from, to);
  if (!isValidIsoDate(today)) throw new Error("invalid_today");

  const segments: WeatherRangeSegment[] = [];
  if (from < today) {
    segments.push({
      kind: "historical",
      from,
      to: to < today ? to : addDaysIso(today, -1),
    });
  }
  if (to >= today) {
    segments.push({
      kind: "forecast",
      from: from > today ? from : today,
      to,
    });
  }
  return segments;
}

export function chunkDateRange(
  from: string,
  to: string,
  maxDays: number,
): Array<{ from: string; to: string }> {
  assertValidDateRange(from, to);
  if (!Number.isInteger(maxDays) || maxDays < 1) throw new Error("invalid_chunk_size");

  const chunks: Array<{ from: string; to: string }> = [];
  let cursor = from;
  while (cursor <= to) {
    const candidate = addDaysIso(cursor, maxDays - 1);
    const chunkTo = candidate < to ? candidate : to;
    chunks.push({ from: cursor, to: chunkTo });
    cursor = addDaysIso(chunkTo, 1);
  }
  return chunks;
}

export function kmhToMs(value: number): number {
  return value / 3.6;
}

export function mergeWeatherPoints(groups: WeatherPoint[][]): WeatherPoint[] {
  const byTimestamp = new Map<string, WeatherPoint>();
  for (const group of groups) {
    for (const point of group) {
      const timestamp = Date.parse(point.ts);
      if (
        !Number.isFinite(timestamp) ||
        !Number.isFinite(point.temp_c) ||
        !Number.isFinite(point.wind_ms) ||
        point.wind_ms < 0
      ) {
        continue;
      }
      byTimestamp.set(new Date(timestamp).toISOString(), {
        ...point,
        ts: new Date(timestamp).toISOString(),
      });
    }
  }
  return [...byTimestamp.values()].sort((a, b) => a.ts.localeCompare(b.ts));
}

export function normalizeOpenMeteoWeather(
  payload: unknown,
  source: WeatherPoint["source"],
): WeatherPoint[] {
  const hourly = (
    payload as {
      hourly?: {
        time?: unknown;
        temperature_2m?: unknown;
        wind_speed_10m?: unknown;
      };
    }
  )?.hourly;
  if (
    !hourly ||
    !Array.isArray(hourly.time) ||
    !Array.isArray(hourly.temperature_2m) ||
    !Array.isArray(hourly.wind_speed_10m)
  ) {
    return [];
  }

  const points: WeatherPoint[] = [];
  for (let index = 0; index < hourly.time.length; index += 1) {
    const rawTime = hourly.time[index];
    const temp = Number(hourly.temperature_2m[index]);
    const wind = Number(hourly.wind_speed_10m[index]);
    if (
      typeof rawTime !== "string" ||
      !Number.isFinite(temp) ||
      !Number.isFinite(wind) ||
      wind < 0
    ) {
      continue;
    }
    const utcTimestamp = rawTime.endsWith("Z") ? rawTime : `${rawTime}Z`;
    const timestamp = Date.parse(utcTimestamp);
    if (!Number.isFinite(timestamp)) continue;
    points.push({
      ts: new Date(timestamp).toISOString(),
      temp_c: temp,
      wind_ms: wind,
      source,
    });
  }
  return mergeWeatherPoints([points]);
}

export function normalizeDischargePayload(payload: unknown): {
  data: DischargePoint[];
  selected_coordinates: Coordinates | null;
} {
  const response = payload as {
    latitude?: unknown;
    longitude?: unknown;
    daily?: { time?: unknown; river_discharge?: unknown };
  };
  const time = response.daily?.time;
  const discharge = response.daily?.river_discharge;
  if (!Array.isArray(time) || !Array.isArray(discharge)) {
    return { data: [], selected_coordinates: null };
  }

  const byDate = new Map<string, DischargePoint>();
  for (let index = 0; index < time.length; index += 1) {
    const date = time[index];
    const rawValue = discharge[index];
    if (typeof date !== "string" || !isValidIsoDate(date) || rawValue == null) continue;
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0 || value > 10_000_000) continue;
    byDate.set(date, { date, discharge_m3s: value });
  }

  const lat = Number(response.latitude);
  const lon = Number(response.longitude);
  return {
    data: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    selected_coordinates: Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null,
  };
}

export function selectBestHydrologyCandidate(
  candidates: HydrologyCandidate[],
): HydrologyCandidate | null {
  return (
    [...candidates].sort((a, b) => {
      const count = b.data.length - a.data.length;
      if (count !== 0) return count;
      const aKey = `${a.query_coordinates.lat},${a.query_coordinates.lon}`;
      const bKey = `${b.query_coordinates.lat},${b.query_coordinates.lon}`;
      return aKey.localeCompare(bKey);
    })[0] ?? null
  );
}

export function filterPlausibleDanubeDischarge(data: DischargePoint[]): DischargePoint[] {
  // Flood API cells outside the routed river network can contain tiny runoff
  // values. A series that never reaches 100 m3/s cannot represent the Danube
  // at any of the configured Serbian stations.
  if (!data.some((point) => point.discharge_m3s >= 100)) return [];
  return data.filter((point) => point.discharge_m3s > 0);
}

export function mergeLoadGeneration(
  loadPoints: LoadPoint[],
  generationPoints: GenerationPoint[],
): LoadGenerationPoint[] {
  const loadByTs = new Map<string, LoadPoint>();
  const generationByTs = new Map<string, GenerationPoint>();
  for (const point of loadPoints) {
    if (
      Number.isFinite(Date.parse(point.ts)) &&
      Number.isFinite(point.load_mw) &&
      point.load_mw >= 0 &&
      Number.isFinite(point.durationMinutes) &&
      point.durationMinutes > 0
    ) {
      loadByTs.set(new Date(point.ts).toISOString(), point);
    }
  }
  for (const point of generationPoints) {
    if (
      Number.isFinite(Date.parse(point.ts)) &&
      Number.isFinite(point.gen_mw) &&
      point.gen_mw >= 0 &&
      Number.isFinite(point.durationMinutes) &&
      point.durationMinutes > 0
    ) {
      generationByTs.set(new Date(point.ts).toISOString(), point);
    }
  }

  const timestamps = [...new Set([...loadByTs.keys(), ...generationByTs.keys()])].sort();
  return timestamps.map((ts) => {
    const load = loadByTs.get(ts);
    const generation = generationByTs.get(ts);
    return {
      ts,
      load_mw: load?.load_mw ?? null,
      gen_mw: generation?.gen_mw ?? null,
      loadDurationMinutes: load?.durationMinutes ?? null,
      generationDurationMinutes: generation?.durationMinutes ?? null,
    };
  });
}

export function durationWeightedAverage(
  points: LoadGenerationPoint[],
  field: "load_mw" | "gen_mw",
): number | null {
  const durationField = field === "load_mw" ? "loadDurationMinutes" : "generationDurationMinutes";
  let weighted = 0;
  let minutes = 0;
  for (const point of points) {
    const value = point[field];
    const duration = point[durationField];
    if (value == null || duration == null || !Number.isFinite(value) || duration <= 0) continue;
    weighted += value * duration;
    minutes += duration;
  }
  return minutes > 0 ? weighted / minutes : null;
}

export function aggregateDataStatus(
  statuses: DataSourceStatus[],
  source: string,
): DataSourceStatus {
  const now = new Date().toISOString();
  if (!statuses.length) {
    return { source, status: "error", reason: "no_source_results", fetched_at: now };
  }

  const successful = statuses.filter((item) => ["live", "cache", "empty"].includes(item.status));
  const failed = statuses.filter((item) => ["partial", "error"].includes(item.status));
  const latestSuccess = successful
    .map((item) => item.last_success_at ?? (item.status !== "empty" ? item.fetched_at : undefined))
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  if (failed.length && successful.length) {
    return {
      source,
      status: "partial",
      reason: `${failed.length}_of_${statuses.length}_sources_unavailable`,
      fetched_at: now,
      last_success_at: latestSuccess,
    };
  }
  if (failed.length) {
    return {
      source,
      status: "error",
      reason: failed[0].reason ?? "source_unavailable",
      fetched_at: now,
      last_success_at: latestSuccess,
    };
  }
  if (statuses.every((item) => item.status === "empty")) {
    return { source, status: "empty", reason: "no_data", fetched_at: now };
  }
  if (statuses.every((item) => item.status === "cache")) {
    return {
      source,
      status: "cache",
      fetched_at: latestSuccess ?? statuses[0].fetched_at,
      last_success_at: latestSuccess,
      stale: statuses.some((item) => item.stale),
    };
  }
  return {
    source,
    status: "live",
    fetched_at: latestSuccess ?? now,
    last_success_at: latestSuccess ?? now,
  };
}
