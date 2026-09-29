import { createServerFn } from "@tanstack/react-start";
import { fetchOutagesRange } from "../entsoe.server";
import { fetchWeatherRange, fetchRiverDischarge } from "../openmeteo.server";
import { DANUBE_STATION_COORDS } from "../markets";
import { aggregateDataStatus, type DataSourceStatus } from "../fundamentals";
import { ZONES, type ZoneCode } from "../markets";
import { RangeInput, requestedRange, allSettledBounded } from "./shared";

export const getOutages = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const { from, to } = requestedRange(data);
    const zones: ZoneCode[] = ["RS", "HU", "RO", "BG", "HR", "ME", "MK", "AL"];
    const settled = await allSettledBounded(
      zones.map((zone) => () => fetchOutagesRange(zone, from, to, false, Boolean(data?.force))),
      2,
    );
    const results = settled.map((result) =>
      result.status === "fulfilled"
        ? result.value
        : {
            data: [],
            source: "empty" as const,
            status: "error" as const,
            reason: result.reason instanceof Error ? result.reason.message : "entsoe_error",
            fetched_at: new Date().toISOString(),
            attempts: [],
          },
    );
    const seen = new Map<string, (typeof results)[number]["data"][number]>();
    for (const result of results) {
      for (const outage of result.data) {
        const key = [
          outage.zone,
          outage.document_id ?? "",
          outage.unit_id ?? outage.unit,
          outage.outage_type,
          outage.start,
          outage.end,
        ].join("|");
        const existing = seen.get(key);
        if (!existing || (outage.revision ?? 0) >= (existing.revision ?? 0)) {
          seen.set(key, outage);
        }
      }
    }
    const zoneStatuses: Array<DataSourceStatus & { zone: ZoneCode }> = results.map(
      (result, index) => ({
        zone: zones[index],
        source: `ENTSO-E outages ${zones[index]}`,
        status: result.status ?? (result.source === "cache" ? "cache" : "error"),
        reason: result.reason,
        fetched_at: result.fetched_at,
        last_success_at: result.last_success_at,
        stale: result.stale,
      }),
    );
    const aggregate = aggregateDataStatus(zoneStatuses, "ENTSO-E outages");
    const rows = [...seen.values()];
    const failedZones = zoneStatuses.filter((status) => status.status === "error");
    const status =
      rows.length && failedZones.length
        ? ("partial" as const)
        : !rows.length && zoneStatuses.every((item) => item.status === "empty")
          ? ("empty" as const)
          : aggregate.status;
    return {
      day: from,
      from,
      to,
      rows,
      source: aggregate.source,
      status,
      reason:
        status === "partial"
          ? `${failedZones.length}_of_${zones.length}_outage_zones_unavailable`
          : status === "empty"
            ? "entsoe_no_outage_publications"
            : aggregate.reason,
      fetched_at: aggregate.fetched_at,
      last_success_at: aggregate.last_success_at,
      stale: aggregate.stale,
      zones: zoneStatuses,
    };
  });

export const getWeather = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const { from, to } = requestedRange(data);
    const zones: ZoneCode[] = ["RS", "HU", "RO", "BG", "HR", "ME", "MK", "AL"];
    const settled = await allSettledBounded(
      zones.map((zone) => () => fetchWeatherRange(zone, from, to, Boolean(data?.force))),
      2,
    );
    const rows = settled.map((result, index) =>
      result.status === "fulfilled"
        ? { zone: zones[index], name: ZONES[zones[index]].name, ...result.value }
        : {
            zone: zones[index],
            name: ZONES[zones[index]].name,
            data: [],
            source: "Open-Meteo weather",
            status: "error" as const,
            reason: result.reason instanceof Error ? result.reason.message : "weather_error",
            fetched_at: new Date().toISOString(),
          },
    );
    const aggregate = aggregateDataStatus(rows, "Open-Meteo weather");
    const degradedZones = rows.filter((row) => row.status === "error" || row.status === "partial");
    const hasData = rows.some((row) => row.data.length);
    return {
      day: from,
      from,
      to,
      ...aggregate,
      status: degradedZones.length && hasData ? ("partial" as const) : aggregate.status,
      reason:
        degradedZones.length && hasData
          ? `weather_unavailable_for_${degradedZones.length}_of_${zones.length}_zones`
          : aggregate.reason,
      rows,
    };
  });

// Danube river discharge from the Open-Meteo Flood API.
export const getDanubeDischarge = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const { from, to } = requestedRange(data);
    const stations = Object.entries(DANUBE_STATION_COORDS);
    const settled = await allSettledBounded(
      stations.map(([name, coordinates]) => async () => ({
        name,
        ...(await fetchRiverDischarge(
          coordinates.lat,
          coordinates.lon,
          from,
          to,
          Boolean(data?.force),
        )),
      })),
      1,
    );
    const results = settled.map((result, index) => {
      if (result.status === "fulfilled") return result.value;
      const [name, coordinates] = stations[index];
      return {
        name,
        data: [],
        source: "Open-Meteo hydrology",
        status: "error" as const,
        reason: result.reason instanceof Error ? result.reason.message : "hydrology_error",
        fetched_at: new Date().toISOString(),
        requested_coordinates: coordinates,
        query_coordinates: null,
        selected_coordinates: null,
      };
    });
    const aggregate = aggregateDataStatus(results, "Open-Meteo hydrology");
    const failed = results.filter(
      (station) => station.status === "error" || station.data.length === 0,
    );
    const hasData = results.some((station) => station.data.length);
    const status = failed.length && hasData ? ("partial" as const) : aggregate.status;
    return {
      from,
      to,
      ...aggregate,
      status,
      reason:
        status === "partial"
          ? `river_discharge_unavailable_for_${failed.map((station) => station.name).join(",")}`
          : aggregate.reason,
      stations: results,
    };
  });
