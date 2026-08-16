import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  RefreshCw,
  Wrench,
} from "lucide-react";

import { useRequestedRangeKeys } from "@/components/dashboard/DateRangeControl";
import { DataBadge } from "@/components/data-badge";
import { KPI } from "@/components/kpi";
import { Panel } from "@/components/panel";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { getBalance, getOutages, getWeather } from "@/lib/data.functions";
import {
  durationWeightedAverage,
  type DataSourceStatus,
  type DataStatus,
} from "@/lib/fundamentals";
import { downloadCSV, fmtMW, fmtNum } from "@/lib/format";
import { getDanubeWaterLevels } from "@/lib/rhmz-hydrology.functions";

export const Route = createFileRoute("/dashboard/outages")({
  head: () => ({ meta: [{ title: "System Fundamentals - CEA Power Dashboard" }] }),
  component: OutagesPage,
});

type QueryStatus = DataSourceStatus | undefined;

function sourceReason(reason?: string): string | undefined {
  if (!reason) return undefined;
  if (reason.includes("entsoe_token_missing")) {
    return "ENTSO-E token is not configured on the server";
  }
  if (reason.includes("entsoe_unauthorized")) {
    return "ENTSO-E rejected the configured token";
  }
  if (reason.includes("entsoe_rate_limited")) {
    return "ENTSO-E rate limit reached; retry shortly";
  }
  if (reason.includes("entsoe_timeout")) return "ENTSO-E request timed out";
  if (reason.includes("entsoe_invalid_request")) return "ENTSO-E rejected the request parameters";
  if (reason.includes("entsoe_no_outage_publications")) {
    return "ENTSO-E returned no outage publications for this period";
  }
  if (reason.includes("weather_unavailable_for_")) {
    const match = /weather_unavailable_for_(\d+)_of_(\d+)_zones/.exec(reason);
    return match
      ? `Weather data is unavailable for ${match[1]} of ${match[2]} zones`
      : "Weather data is partially unavailable";
  }
  if (reason.includes("invalid_date")) return "Request exceeded the supported date range";
  if (reason.includes("request_timeout")) return "The source request timed out";
  if (reason.includes("http_429")) return "Open-Meteo rate limit reached; retry shortly";
  if (reason.includes("stale_cache")) return "Live source failed; showing stale cached data";
  if (reason.includes("weather_segments_unavailable")) {
    return "Some weather segments are temporarily unavailable";
  }
  if (reason.includes("rhmz_no_station_data")) {
    return "RHMZ returned no Danube gauge observations";
  }
  if (reason.includes("rhmz_no_hourly_rows")) {
    return "RHMZ returned no hourly rows for this station";
  }
  if (reason.includes("rhmz_http_")) {
    return "RHMZ hydrology source is temporarily unavailable";
  }
  return reason.replaceAll("_", " ");
}

function StatusRow({
  label,
  status,
  loading,
  onRetry,
}: {
  label: string;
  status: QueryStatus;
  loading: boolean;
  onRetry: () => void;
}) {
  const displayStatus: DataStatus = loading ? "partial" : (status?.status ?? "error");
  const Icon = displayStatus === "live" || displayStatus === "cache" ? CheckCircle2 : AlertCircle;
  const fetchedAt = status?.last_success_at ?? status?.fetched_at;
  return (
    <div className="grid gap-2 border-t border-border/60 py-2.5 first:border-t-0 md:grid-cols-[minmax(180px,1.2fr)_100px_minmax(220px,2fr)_auto] md:items-center">
      <span className="flex items-center gap-2 text-sm font-medium">
        <Icon
          className={`h-4 w-4 ${
            displayStatus === "error"
              ? "text-destructive"
              : displayStatus === "partial" || displayStatus === "empty"
                ? "text-warning"
                : "text-success"
          }`}
        />
        {label}
      </span>
      <span>{loading ? <DataBadge source="partial" /> : <DataBadge source={displayStatus} />}</span>
      <span className="text-xs text-muted-foreground">
        {loading
          ? "Loading selected period..."
          : (sourceReason(status?.reason) ??
            (fetchedAt
              ? `Last successful fetch ${new Date(fetchedAt).toLocaleString("en-GB")}`
              : "No successful fetch recorded"))}
      </span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 w-fit gap-1.5 px-2 text-xs"
        onClick={onRetry}
        disabled={loading}
      >
        <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        Retry
      </Button>
    </div>
  );
}

function signedCm(value: number | null) {
  if (value == null) return "-";
  return `${value > 0 ? "+" : ""}${fmtNum(value, 0)} cm`;
}

function formatObservation(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-GB", {
    timeZone: "Europe/Belgrade",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function OutagesPage() {
  const outagesFn = useServerFn(getOutages);
  const weatherFn = useServerFn(getWeather);
  const danubeFn = useServerFn(getDanubeWaterLevels);
  const balanceFn = useServerFn(getBalance);
  const { fromKey, toKey } = useRequestedRangeKeys();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [outageTableView, setOutageTableView] = useState<"end-date" | "period">("end-date");

  const outages = useQuery({
    queryKey: ["outages", fromKey, toKey],
    queryFn: () => outagesFn({ data: { from: fromKey, to: toKey } }),
  });
  const weather = useQuery({
    queryKey: ["fundamentals-weather", fromKey, toKey],
    queryFn: () => weatherFn({ data: { from: fromKey, to: toKey } }),
  });
  const danube = useQuery({
    queryKey: ["fundamentals-rhmz-danube"],
    queryFn: () => danubeFn({ data: {} }),
    refetchInterval: 60 * 60 * 1000,
  });
  const balance = useQuery({
    queryKey: ["fundamentals-balance", fromKey, toKey],
    queryFn: () => balanceFn({ data: { from: fromKey, to: toKey } }),
  });

  const rows = outages.data?.rows ?? [];
  const endDateStartMs = Date.parse(`${toKey}T00:00:00Z`);
  const endDateEndMs = endDateStartMs + 86_400_000;
  const endDateRows = rows.filter((row) => {
    const startMs = Date.parse(row.start);
    const endMs = Date.parse(row.end);
    return startMs < endDateEndMs && endMs > endDateStartMs;
  });
  const visibleOutageRows = outageTableView === "end-date" ? endDateRows : rows;
  const endDateLabel = new Date(endDateStartMs).toLocaleDateString("en-GB");

  const rowsWithUnavailable = rows.filter((row) => row.unavailable_mw != null);
  const totalMW = rowsWithUnavailable.reduce((sum, row) => sum + (row.unavailable_mw ?? 0), 0);
  const forcedRows = rowsWithUnavailable.filter((row) => row.outage_type === "forced");
  const plannedRows = rowsWithUnavailable.filter((row) => row.outage_type === "planned");
  const forcedMW = forcedRows.reduce((sum, row) => sum + (row.unavailable_mw ?? 0), 0);
  const plannedMW = plannedRows.reduce((sum, row) => sum + (row.unavailable_mw ?? 0), 0);
  const availableOnlyCount = rows.filter(
    (row) => row.available_mw != null && row.unavailable_mw == null,
  ).length;
  const outageFailed = outages.data?.status === "error";
  const outageLoading = outages.isPending && !outages.data;

  const balancePoints = balance.data?.points ?? [];
  const avgLoad = durationWeightedAverage(balancePoints, "load_mw");
  const avgGen = durationWeightedAverage(balancePoints, "gen_mw");
  const loadPointCount = balancePoints.filter((point) => point.load_mw != null).length;
  const generationPointCount = balancePoints.filter((point) => point.gen_mw != null).length;

  const weatherRows = weather.data?.rows ?? [];
  const rsWeather = weatherRows.find((row) => row.zone === "RS");
  const rsWeatherPoints = rsWeather?.data ?? [];
  const avgTemp = rsWeatherPoints.length
    ? rsWeatherPoints.reduce((sum, point) => sum + point.temp_c, 0) / rsWeatherPoints.length
    : null;
  const avgWind = rsWeatherPoints.length
    ? rsWeatherPoints.reduce((sum, point) => sum + point.wind_ms, 0) / rsWeatherPoints.length
    : null;

  const danubeStations = danube.data?.stations ?? [];
  const smederevo =
    danubeStations.find((station) => station.name === "Smederevo") ?? danubeStations[0];
  const danubeStatus: DataSourceStatus | undefined = danube.data
    ? {
        source: "RHMZ",
        status:
          danube.data.source === "live"
            ? "live"
            : danube.data.source === "cache"
              ? "cache"
              : "error",
        reason: danube.data.reason,
        fetched_at: danube.data.fetchedAt,
        last_success_at: danube.data.source === "empty" ? undefined : danube.data.fetchedAt,
        stale: danube.data.reason?.startsWith("stale_cache") ?? false,
      }
    : undefined;

  const byZone = useMemo(() => {
    const map = new Map<string, { zone: string; forced: number; planned: number; units: number }>();
    for (const row of rowsWithUnavailable) {
      const entry = map.get(row.zone) ?? {
        zone: row.zone,
        forced: 0,
        planned: 0,
        units: 0,
      };
      if (row.outage_type === "forced") entry.forced += row.unavailable_mw ?? 0;
      if (row.outage_type === "planned") entry.planned += row.unavailable_mw ?? 0;
      entry.units += 1;
      map.set(row.zone, entry);
    }
    return [...map.values()].sort((a, b) => b.forced + b.planned - (a.forced + a.planned));
  }, [rowsWithUnavailable]);
  const maxZoneMW = Math.max(1, ...byZone.map((zone) => zone.forced + zone.planned));

  const retryOutages = () => outages.refetch();
  const retryWeather = () => weather.refetch();
  const retryDanube = () => danube.refetch();
  const retryBalance = () => balance.refetch();
  const refreshAll = async () => {
    setIsRefreshing(true);
    try {
      await Promise.allSettled([
        outages.refetch(),
        weather.refetch(),
        danube.refetch(),
        balance.refetch(),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  };

  const isFetchingAll =
    outages.isFetching ||
    weather.isFetching ||
    danube.isFetching ||
    balance.isFetching ||
    isRefreshing;
  const latestSuccess = [
    outages.data?.last_success_at,
    weather.data?.last_success_at,
    danubeStatus?.last_success_at,
    balance.data?.last_success_at,
  ]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const outageSubtitle = outageLoading
    ? "Loading ENTSO-E outage publications"
    : outageFailed
      ? "Outage data unavailable"
      : outages.data?.status === "empty"
        ? "No outage publications for the selected period"
        : `${rows.length} outage records - ${fmtMW(totalMW)} calculable impact`;

  return (
    <>
      <TopBar
        title="System Fundamentals"
        subtitle={outageSubtitle}
        onRefresh={refreshAll}
        isRefreshing={isFetchingAll}
        lastRefresh={latestSuccess}
        hideRange
      />
      <div className="space-y-5 p-6">
        {isFetchingAll && (
          <div className="rounded-2xl border border-primary/30 bg-primary/10 p-4 text-sm font-medium text-primary shadow-sm">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Updating system fundamentals from the selected sources...</span>
            </div>
          </div>
        )}

        <Panel title="Data source status">
          <StatusRow
            label="ENTSO-E outages"
            status={outages.data}
            loading={outages.isFetching}
            onRetry={retryOutages}
          />
          <StatusRow
            label="ENTSO-E load"
            status={balance.data?.load}
            loading={balance.isFetching}
            onRetry={retryBalance}
          />
          <StatusRow
            label="ENTSO-E generation"
            status={balance.data?.generation}
            loading={balance.isFetching}
            onRetry={retryBalance}
          />
          <StatusRow
            label="Weather (Open-Meteo → Visual Crossing fallback)"
            status={weather.data}
            loading={weather.isFetching}
            onRetry={retryWeather}
          />
          <StatusRow
            label="Danube water levels (RHMZ)"
            status={danubeStatus}
            loading={danube.isFetching}
            onRetry={retryDanube}
          />
        </Panel>

        <div className="grid gap-4 md:grid-cols-4">
          <KPI
            label="Total impacted"
            value={outageFailed || outageLoading ? "-" : fmtMW(totalMW)}
            accent="warning"
            sub={
              availableOnlyCount
                ? `${rowsWithUnavailable.length} calculable, ${availableOnlyCount} available-only`
                : `${rowsWithUnavailable.length} calculable records`
            }
          />
          <KPI
            label="Forced"
            value={outageFailed || outageLoading ? "-" : fmtMW(forcedMW)}
            accent="destructive"
            sub={`${forcedRows.length} records`}
          />
          <KPI
            label="Planned"
            value={outageFailed || outageLoading ? "-" : fmtMW(plannedMW)}
            accent="info"
            sub={`${plannedRows.length} records`}
          />
          <KPI
            label="Zones affected"
            value={
              outageFailed || outageLoading ? "-" : String(new Set(rows.map((row) => row.zone)).size)
            }
            accent="primary"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <KPI
            label="Serbia avg. load"
            value={fmtMW(avgLoad)}
            sub={`${loadPointCount} intervals`}
            source={balance.data?.load.status}
          />
          <KPI
            label="Serbia avg. generation"
            value={fmtMW(avgGen)}
            sub={`${generationPointCount} intervals`}
            source={balance.data?.generation.status}
          />
          <KPI
            label="Serbia weather"
            value={avgTemp == null ? "-" : `${fmtNum(avgTemp)} °C`}
            sub={avgWind == null ? "Wind unavailable" : `Wind ${fmtNum(avgWind)} m/s`}
            source={rsWeather?.status}
          />
          <KPI
            label="Danube - Smederevo"
            value={
              smederevo?.latest_level_cm == null
                ? "-"
                : `${fmtNum(smederevo.latest_level_cm, 0)} cm`
            }
            sub={
              smederevo
                ? `${signedCm(smederevo.change_24h_cm)} / 24h · ${formatObservation(smederevo.latest_observation)}`
                : "Latest observation unavailable"
            }
            source={danube.data?.source}
          />
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <Panel
            title="Weather by zone"
            actions={weather.data ? <DataBadge source={weather.data.status} /> : undefined}
          >
            {weather.isPending && !weather.data ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Loading weather observations...
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="py-1.5 text-left">Zone</th>
                      <th className="text-right">Avg. temp</th>
                      <th className="text-right">Avg. wind</th>
                      <th className="text-right">Hours</th>
                      <th className="text-right">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weatherRows.map((row) => {
                      const points = row.data ?? [];
                      const temp = points.length
                        ? points.reduce((sum, point) => sum + point.temp_c, 0) / points.length
                        : null;
                      const wind = points.length
                        ? points.reduce((sum, point) => sum + point.wind_ms, 0) / points.length
                        : null;
                      return (
                        <tr key={row.zone} className="border-t border-border/60">
                          <td className="py-1.5">
                            <div className="font-medium">
                              {row.name} ({row.zone})
                            </div>
                            {!points.length && row.reason ? (
                              <div className="text-xs text-destructive">
                                {sourceReason(row.reason)}
                              </div>
                            ) : null}
                          </td>
                          <td className="num text-right">
                            {temp == null ? "-" : `${fmtNum(temp)} °C`}
                          </td>
                          <td className="num text-right">
                            {wind == null ? "-" : `${fmtNum(wind)} m/s`}
                          </td>
                          <td className="num text-right">{points.length}</td>
                          <td className="text-right">
                            <div className="flex flex-col items-end gap-0.5">
                              <DataBadge source={row.status} />
                              <span className="text-[10px] text-muted-foreground">{row.source}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {!weatherRows.length && (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                          Weather data unavailable. {sourceReason(weather.data?.reason)}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel
            title="Danube hydrology - official RHMZ water levels"
            actions={danube.data ? <DataBadge source={danube.data.source} /> : undefined}
          >
            {danube.isPending && !danube.data ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Loading RHMZ water-level observations...
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-sm">
                  <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="py-1.5 text-left">Station</th>
                      <th className="text-right">Level</th>
                      <th className="text-right">24h change</th>
                      <th className="text-right">7d range</th>
                      <th className="text-right">Observation</th>
                      <th className="text-right">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {danubeStations.map((station) => (
                      <tr key={station.id} className="border-t border-border/60">
                        <td className="py-1.5">
                          <div className="font-medium">{station.name}</div>
                          <div className="text-[10px] text-muted-foreground">
                            Gauge zero {fmtNum(station.gauge_zero_m, 2)} m a.s.l.
                          </div>
                          {station.reason ? (
                            <div className="text-xs text-destructive">
                              {sourceReason(station.reason)}
                            </div>
                          ) : null}
                        </td>
                        <td className="num text-right font-semibold">
                          {station.latest_level_cm == null
                            ? "-"
                            : `${fmtNum(station.latest_level_cm, 0)} cm`}
                        </td>
                        <td
                          className={`num text-right ${
                            (station.change_24h_cm ?? 0) > 0
                              ? "text-info"
                              : (station.change_24h_cm ?? 0) < 0
                                ? "text-warning"
                                : ""
                          }`}
                        >
                          {signedCm(station.change_24h_cm)}
                        </td>
                        <td className="num text-right">
                          {station.min_7d_cm == null || station.max_7d_cm == null
                            ? "-"
                            : `${fmtNum(station.min_7d_cm, 0)} to ${fmtNum(station.max_7d_cm, 0)} cm`}
                        </td>
                        <td className="num text-right text-xs text-muted-foreground">
                          {formatObservation(station.latest_observation)}
                        </td>
                        <td className="text-right">
                          <div className="flex flex-col items-end gap-0.5">
                            <DataBadge source={station.status} />
                            <span className="text-[10px] text-muted-foreground">RHMZ</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!danubeStations.length && (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                          RHMZ Danube water-level data unavailable. {sourceReason(danube.data?.reason)}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                  Absolute centimetre readings should not be compared directly between stations because each gauge has its own zero elevation. Use each station's change and seven-day range for trend comparison.
                </p>
              </div>
            )}
          </Panel>
        </div>

        <Panel title="Impact by zone (MW unavailable)">
          {outageLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Loading outage publications...
            </p>
          ) : outages.data?.status === "empty" ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No outages reported by ENTSO-E for the selected period.
            </p>
          ) : outageFailed || (!byZone.length && outages.data?.status === "partial") ? (
            <p className="py-6 text-center text-sm text-destructive">
              Outage data unavailable. {sourceReason(outages.data?.reason)}
            </p>
          ) : byZone.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Outage publications were returned, but unavailable capacity cannot be calculated.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-4 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-destructive" />
                  Forced
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-info" />
                  Planned
                </span>
              </div>
              {byZone.map((zone) => {
                const total = zone.forced + zone.planned;
                return (
                  <div key={zone.zone} className="flex items-center gap-3 text-sm">
                    <span className="w-10 font-mono font-semibold">{zone.zone}</span>
                    <div className="flex h-6 flex-1 overflow-hidden rounded bg-surface-2/60">
                      <div
                        className="h-full bg-destructive transition-all"
                        style={{ width: `${(zone.forced / maxZoneMW) * 100}%` }}
                        title={`Forced: ${fmtMW(zone.forced)}`}
                      />
                      <div
                        className="h-full bg-info transition-all"
                        style={{ width: `${(zone.planned / maxZoneMW) * 100}%` }}
                        title={`Planned: ${fmtMW(zone.planned)}`}
                      />
                    </div>
                    <span className="num w-16 text-right text-xs text-muted-foreground">
                      {zone.units} records
                    </span>
                    <span className="num w-24 text-right font-semibold">{fmtMW(total)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <div className="grid gap-5 md:grid-cols-2">
          <Panel
            title={
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                Largest forced outages
              </span>
            }
            dense
          >
            <ul className="divide-y divide-border/60 text-sm">
              {[...forcedRows]
                .sort((a, b) => (b.unavailable_mw ?? 0) - (a.unavailable_mw ?? 0))
                .slice(0, 6)
                .map((row) => (
                  <li
                    key={`${row.document_id}-${row.unit_id}-${row.start}`}
                    className="flex justify-between gap-3 py-1.5"
                  >
                    <span className="truncate">
                      <span className="mr-2 font-mono text-xs text-muted-foreground">
                        {row.zone}
                      </span>
                      {row.unit}
                    </span>
                    <span className="num font-semibold text-destructive">
                      {fmtMW(row.unavailable_mw)}
                    </span>
                  </li>
                ))}
              {!forcedRows.length && (
                <li className="py-3 text-center text-xs text-muted-foreground">
                  No calculable forced outages
                </li>
              )}
            </ul>
          </Panel>
          <Panel
            title={
              <span className="flex items-center gap-1.5">
                <Wrench className="h-3.5 w-3.5 text-info" />
                Largest planned outages
              </span>
            }
            dense
          >
            <ul className="divide-y divide-border/60 text-sm">
              {[...plannedRows]
                .sort((a, b) => (b.unavailable_mw ?? 0) - (a.unavailable_mw ?? 0))
                .slice(0, 6)
                .map((row) => (
                  <li
                    key={`${row.document_id}-${row.unit_id}-${row.start}`}
                    className="flex justify-between gap-3 py-1.5"
                  >
                    <span className="truncate">
                      <span className="mr-2 font-mono text-xs text-muted-foreground">
                        {row.zone}
                      </span>
                      {row.unit}
                    </span>
                    <span className="num font-semibold text-info">{fmtMW(row.unavailable_mw)}</span>
                  </li>
                ))}
              {!plannedRows.length && (
                <li className="py-3 text-center text-xs text-muted-foreground">
                  No calculable planned outages
                </li>
              )}
            </ul>
          </Panel>
        </div>

        <Panel
          title="Outage publications"
          actions={
            <div className="flex flex-wrap items-center justify-end gap-1">
              <Button
                type="button"
                size="sm"
                variant={outageTableView === "end-date" ? "secondary" : "ghost"}
                onClick={() => setOutageTableView("end-date")}
              >
                Active on {endDateLabel}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={outageTableView === "period" ? "secondary" : "ghost"}
                onClick={() => setOutageTableView("period")}
              >
                Selected-period history
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5"
                onClick={() => downloadCSV("outages.csv", visibleOutageRows as never)}
                disabled={!visibleOutageRows.length}
              >
                <Download className="h-3.5 w-3.5" />
                CSV
              </Button>
            </div>
          }
        >
          <p className="mb-3 text-xs text-muted-foreground">
            {outageTableView === "end-date"
              ? `Showing outages overlapping ${endDateLabel}, for direct comparison with the ENTSO-E single-date view.`
              : `Showing all outage periods overlapping ${fromKey} to ${toKey}.`}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-1.5 text-left">Zone</th>
                  <th className="text-left">Unit</th>
                  <th className="text-right">Unavailable MW</th>
                  <th className="text-right">Available MW</th>
                  <th className="text-right">Normal MW</th>
                  <th>Type</th>
                  <th>Start</th>
                  <th>End</th>
                  <th className="text-right">Source</th>
                </tr>
              </thead>
              <tbody>
                {visibleOutageRows.map((row) => (
                  <tr
                    key={`${row.document_id}-${row.unit_id}-${row.start}-${row.end}`}
                    className="border-t border-border/60"
                  >
                    <td className="py-1.5 font-medium">{row.zone}</td>
                    <td>
                      <div>{row.unit}</div>
                      {row.unit_id ? (
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {row.unit_id}
                        </div>
                      ) : null}
                    </td>
                    <td className="num text-right">{fmtMW(row.unavailable_mw)}</td>
                    <td className="num text-right">{fmtMW(row.available_mw)}</td>
                    <td className="num text-right">{fmtMW(row.normal_capacity_mw)}</td>
                    <td
                      className={
                        row.outage_type === "forced"
                          ? "text-destructive"
                          : row.outage_type === "planned"
                            ? "text-info"
                            : "text-muted-foreground"
                      }
                    >
                      {row.outage_type}
                    </td>
                    <td className="num text-xs text-muted-foreground">
                      {new Date(row.start).toLocaleDateString("en-GB")}
                    </td>
                    <td className="num text-xs text-muted-foreground">
                      {new Date(row.end).toLocaleDateString("en-GB")}
                    </td>
                    <td className="text-right">
                      <span className="text-xs text-muted-foreground">{row.source}</span>
                    </td>
                  </tr>
                ))}
                {!visibleOutageRows.length && (
                  <tr>
                    <td
                      colSpan={9}
                      className={`py-6 text-center text-sm ${
                        outageFailed ? "text-destructive" : "text-muted-foreground"
                      }`}
                    >
                      {outageLoading
                        ? "Loading outage publications..."
                        : outageTableView === "end-date"
                          ? `No ENTSO-E outages overlap ${endDateLabel}.`
                          : outages.data?.status === "empty"
                            ? "No outages reported by ENTSO-E for the selected period."
                            : `Outage data unavailable. ${sourceReason(outages.data?.reason) ?? ""}`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}
