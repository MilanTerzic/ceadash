import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { getBalance, getDanubeDischarge, getOutages, getWeather } from "@/lib/data.functions";
import {
  durationWeightedAverage,
  type DataSourceStatus,
  type DataStatus,
} from "@/lib/fundamentals";
import { downloadCSV, fmtMW, fmtNum } from "@/lib/format";
import { useLang } from "@/lib/i18n";

export const Route = createFileRoute("/dashboard/outages")({
  head: () => ({ meta: [{ title: "System Fundamentals - CEA Power Dashboard" }] }),
  component: OutagesPage,
});

type QueryStatus = DataSourceStatus | undefined;

function sourceReason(
  reason: string | undefined,
  t: (en: string, sr: string) => string,
): string | undefined {
  if (!reason) return undefined;
  if (reason.includes("entsoe_token_missing")) {
    return t(
      "ENTSO-E token is not configured on the server",
      "ENTSO-E token nije podešen na serveru",
    );
  }
  if (reason.includes("entsoe_unauthorized")) {
    return t("ENTSO-E rejected the configured token", "ENTSO-E je odbio podešeni token");
  }
  if (reason.includes("entsoe_rate_limited")) {
    return t(
      "ENTSO-E rate limit reached; retry shortly",
      "Dostignut je limit ENTSO-E zahteva; pokušajte ponovo uskoro",
    );
  }
  if (reason.includes("entsoe_timeout"))
    return t("ENTSO-E request timed out", "ENTSO-E zahtev je istekao");
  if (reason.includes("entsoe_invalid_request"))
    return t(
      "ENTSO-E rejected the request parameters",
      "ENTSO-E je odbio parametre zahteva",
    );
  if (reason.includes("entsoe_no_outage_publications")) {
    return t(
      "ENTSO-E returned no outage publications for this period",
      "ENTSO-E nije vratio objave o ispadima za ovaj period",
    );
  }
  if (reason.includes("weather_unavailable_for_")) {
    const match = /weather_unavailable_for_(\d+)_of_(\d+)_zones/.exec(reason);
    return match
      ? t(
          `Weather data is unavailable for ${match[1]} of ${match[2]} zones`,
          `Podaci o vremenu nisu dostupni za ${match[1]} od ${match[2]} zona`,
        )
      : t("Weather data is partially unavailable", "Podaci o vremenu su delimično nedostupni");
  }
  if (reason.includes("river_discharge_unavailable_for_")) {
    return t(
      `River-discharge data is unavailable for ${reason.split("_for_")[1]}`,
      `Podaci o protoku reke nisu dostupni za ${reason.split("_for_")[1]}`,
    );
  }
  if (reason.includes("invalid_date"))
    return t(
      "Request exceeded the supported date range",
      "Zahtev prevazilazi podržani opseg datuma",
    );
  if (reason.includes("request_timeout"))
    return t("The source request timed out", "Zahtev ka izvoru je istekao");
  if (reason.includes("http_429"))
    return t(
      "Open-Meteo rate limit reached; retry shortly",
      "Dostignut je limit Open-Meteo zahteva; pokušajte ponovo uskoro",
    );
  if (reason.includes("stale_cache"))
    return t(
      "Live source failed; showing stale cached data",
      "Neuspešno preuzimanje uživo; prikazuju se zastareli keširani podaci",
    );
  if (reason.includes("weather_segments_unavailable")) {
    return t(
      "Some Open-Meteo weather segments are temporarily unavailable",
      "Neki Open-Meteo segmenti vremena su privremeno nedostupni",
    );
  }
  if (reason.includes("no_plausible_danube_grid_cell")) {
    return t(
      "Open-Meteo does not provide a plausible Danube grid cell for this station",
      "Open-Meteo ne pruža verodostojnu mrežnu ćeliju Dunava za ovu stanicu",
    );
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
  const { t } = useLang();
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
          ? t("Loading selected period...", "Učitavanje izabranog perioda...")
          : (sourceReason(status?.reason, t) ??
            (fetchedAt
              ? t(
                  `Last successful fetch ${new Date(fetchedAt).toLocaleString("en-GB")}`,
                  `Poslednje uspešno preuzimanje ${new Date(fetchedAt).toLocaleString("sr-RS")}`,
                )
              : t("No successful fetch recorded", "Nema zabeleženog uspešnog preuzimanja")))}
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
        {t("Retry", "Pokušaj ponovo")}
      </Button>
    </div>
  );
}

function OutagesPage() {
  const { t } = useLang();
  const outagesFn = useServerFn(getOutages);
  const weatherFn = useServerFn(getWeather);
  const danubeFn = useServerFn(getDanubeDischarge);
  const balanceFn = useServerFn(getBalance);
  const queryClient = useQueryClient();
  const { fromKey, toKey } = useRequestedRangeKeys();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const outages = useQuery({
    queryKey: ["outages", fromKey, toKey],
    queryFn: () => outagesFn({ data: { from: fromKey, to: toKey } }),
  });
  const weather = useQuery({
    queryKey: ["fundamentals-weather", fromKey, toKey],
    queryFn: () => weatherFn({ data: { from: fromKey, to: toKey } }),
  });
  const danube = useQuery({
    queryKey: ["fundamentals-danube", fromKey, toKey],
    queryFn: () => danubeFn({ data: { from: fromKey, to: toKey } }),
  });
  const balance = useQuery({
    queryKey: ["fundamentals-balance", fromKey, toKey],
    queryFn: () => balanceFn({ data: { from: fromKey, to: toKey } }),
  });

  const rows = outages.data?.rows ?? [];
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
  const zemun = danubeStations.find((station) => station.name === "Zemun") ?? danubeStations[0];
  const zemunSeries = zemun?.data ?? [];
  const latestDischarge = zemunSeries.at(-1)?.discharge_m3s ?? null;

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
      const results = await Promise.allSettled([
        outagesFn({ data: { from: fromKey, to: toKey, force: true } }),
        weatherFn({ data: { from: fromKey, to: toKey, force: true } }),
        danubeFn({ data: { from: fromKey, to: toKey, force: true } }),
        balanceFn({ data: { from: fromKey, to: toKey, force: true } }),
      ]);
      const keys = [
        ["outages", fromKey, toKey],
        ["fundamentals-weather", fromKey, toKey],
        ["fundamentals-danube", fromKey, toKey],
        ["fundamentals-balance", fromKey, toKey],
      ];
      results.forEach((result, index) => {
        if (result.status === "fulfilled") queryClient.setQueryData(keys[index], result.value);
      });
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
    danube.data?.last_success_at,
    balance.data?.last_success_at,
  ]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const outageSubtitle = outageLoading
    ? t("Loading ENTSO-E outage publications", "Učitavanje ENTSO-E objava o ispadima")
    : outageFailed
      ? t("Outage data unavailable", "Podaci o ispadima nisu dostupni")
      : outages.data?.status === "empty"
        ? t(
            "No outage publications for the selected period",
            "Nema objava o ispadima za izabrani period",
          )
        : t(
            `${rows.length} outage records - ${fmtMW(totalMW)} calculable impact`,
            `${rows.length} zapisa o ispadima - ${fmtMW(totalMW)} merljivog uticaja`,
          );

  return (
    <>
      <TopBar
        title={t("System Fundamentals", "Osnove sistema")}
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
              <span>
                Učitavanje podataka za izabrani period… Molimo sačekajte dok se ažuriraju svi
                izvori.
              </span>
            </div>
          </div>
        )}

        <Panel title={t("Data source status", "Status izvora podataka")}>
          <StatusRow
            label={t("ENTSO-E outages", "ENTSO-E ispadi")}
            status={outages.data}
            loading={outages.isFetching}
            onRetry={retryOutages}
          />
          <StatusRow
            label={t("ENTSO-E load", "ENTSO-E potrošnja")}
            status={balance.data?.load}
            loading={balance.isFetching}
            onRetry={retryBalance}
          />
          <StatusRow
            label={t("ENTSO-E generation", "ENTSO-E proizvodnja")}
            status={balance.data?.generation}
            loading={balance.isFetching}
            onRetry={retryBalance}
          />
          <StatusRow
            label={t("Open-Meteo weather", "Open-Meteo vreme")}
            status={weather.data}
            loading={weather.isFetching}
            onRetry={retryWeather}
          />
          <StatusRow
            label={t("Open-Meteo hydrology", "Open-Meteo hidrologija")}
            status={danube.data}
            loading={danube.isFetching}
            onRetry={retryDanube}
          />
        </Panel>

        <div className="grid gap-4 md:grid-cols-4">
          <KPI
            label={t("Total impacted", "Ukupno pogođeno")}
            value={outageFailed || outageLoading ? "-" : fmtMW(totalMW)}
            accent="warning"
            sub={
              availableOnlyCount
                ? t(
                    `${rowsWithUnavailable.length} calculable, ${availableOnlyCount} available-only`,
                    `${rowsWithUnavailable.length} merljivo, ${availableOnlyCount} samo dostupno`,
                  )
                : t(
                    `${rowsWithUnavailable.length} calculable records`,
                    `${rowsWithUnavailable.length} merljivih zapisa`,
                  )
            }
          />
          <KPI
            label={t("Forced", "Prinudni")}
            value={outageFailed || outageLoading ? "-" : fmtMW(forcedMW)}
            accent="destructive"
            sub={t(`${forcedRows.length} records`, `${forcedRows.length} zapisa`)}
          />
          <KPI
            label={t("Planned", "Planirani")}
            value={outageFailed || outageLoading ? "-" : fmtMW(plannedMW)}
            accent="info"
            sub={t(`${plannedRows.length} records`, `${plannedRows.length} zapisa`)}
          />
          <KPI
            label={t("Zones affected", "Pogođene zone")}
            value={
              outageFailed || outageLoading ? "-" : String(new Set(rows.map((r) => r.zone)).size)
            }
            accent="primary"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <KPI
            label={t("Serbia avg. load", "Prosečna potrošnja - Srbija")}
            value={fmtMW(avgLoad)}
            sub={t(`${loadPointCount} intervals`, `${loadPointCount} intervala`)}
            source={balance.data?.load.status}
          />
          <KPI
            label={t("Serbia avg. generation", "Prosečna proizvodnja - Srbija")}
            value={fmtMW(avgGen)}
            sub={t(`${generationPointCount} intervals`, `${generationPointCount} intervala`)}
            source={balance.data?.generation.status}
          />
          <KPI
            label={t("Serbia weather", "Vreme - Srbija")}
            value={avgTemp == null ? "-" : `${fmtNum(avgTemp)} °C`}
            sub={
              avgWind == null
                ? t("Wind unavailable", "Vetar nije dostupan")
                : t(`Wind ${fmtNum(avgWind)} m/s`, `Vetar ${fmtNum(avgWind)} m/s`)
            }
            source={rsWeather?.status}
          />
          <KPI
            label={t("Danube - Zemun", "Dunav - Zemun")}
            value={latestDischarge == null ? "-" : `${fmtNum(latestDischarge, 0)} m³/s`}
            sub={
              zemun?.latest_observation ??
              t("Latest observation unavailable", "Poslednje osmatranje nije dostupno")
            }
            source={zemun?.status}
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
                              <span className="text-[10px] text-muted-foreground">
                                {row.source}
                              </span>
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
            title="Hydrology - Danube stations"
            actions={danube.data ? <DataBadge source={danube.data.status} /> : undefined}
          >
            {danube.isPending && !danube.data ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Loading river-discharge observations...
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="py-1.5 text-left">Station</th>
                      <th className="text-right">Latest</th>
                      <th className="text-right">Period avg.</th>
                      <th className="text-right">Latest date</th>
                      <th className="text-right">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {danubeStations.map((station) => {
                      const series = station.data ?? [];
                      const latest = series.at(-1)?.discharge_m3s ?? null;
                      const average = series.length
                        ? series.reduce((sum, point) => sum + point.discharge_m3s, 0) /
                          series.length
                        : null;
                      const selected = station.selected_coordinates;
                      return (
                        <tr key={station.name} className="border-t border-border/60">
                          <td className="py-1.5">
                            <div className="font-medium">{station.name}</div>
                            {selected ? (
                              <div className="text-[10px] text-muted-foreground">
                                Grid {selected.lat.toFixed(3)}, {selected.lon.toFixed(3)}
                              </div>
                            ) : station.reason ? (
                              <div className="text-xs text-destructive">
                                {sourceReason(station.reason)}
                              </div>
                            ) : null}
                          </td>
                          <td className="num text-right">
                            {latest == null ? "-" : `${fmtNum(latest, 0)} m³/s`}
                          </td>
                          <td className="num text-right">
                            {average == null ? "-" : `${fmtNum(average, 0)} m³/s`}
                          </td>
                          <td className="num text-right text-xs text-muted-foreground">
                            {station.latest_observation ?? "-"}
                          </td>
                          <td className="text-right">
                            <div className="flex flex-col items-end gap-0.5">
                              <DataBadge source={station.status} />
                              <span className="text-[10px] text-muted-foreground">
                                {station.source}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {!danubeStations.length && (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                          River-discharge data unavailable. {sourceReason(danube.data?.reason)}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
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
          title="All outage publications"
          actions={
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5"
              onClick={() => downloadCSV("outages.csv", rows as never)}
              disabled={!rows.length}
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </Button>
          }
        >
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
                {rows.map((row) => (
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
                {!rows.length && (
                  <tr>
                    <td
                      colSpan={9}
                      className={`py-6 text-center text-sm ${
                        outageFailed ? "text-destructive" : "text-muted-foreground"
                      }`}
                    >
                      {outageLoading
                        ? "Loading outage publications..."
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
