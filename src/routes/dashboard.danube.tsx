import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Droplets, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataBadge } from "@/components/data-badge";
import { KPI } from "@/components/kpi";
import { Panel } from "@/components/panel";
import { TopBar } from "@/components/top-bar";
import { fmtNum } from "@/lib/format";
import { getDanubeWaterLevels } from "@/lib/rhmz-hydrology.functions";

export const Route = createFileRoute("/dashboard/danube")({
  head: () => ({ meta: [{ title: "Danube Hydrology - CEA Power Dashboard" }] }),
  component: DanubeHydrologyPage,
});

function signedCm(value: number | null) {
  if (value == null) return "-";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${fmtNum(value, 0)} cm`;
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

function DanubeHydrologyPage() {
  const [selectedName, setSelectedName] = useState("Smederevo");
  const waterLevelFn = useServerFn(getDanubeWaterLevels);
  const query = useQuery({
    queryKey: ["rhmz-danube-water-levels"],
    queryFn: () => waterLevelFn({ data: {} }),
    refetchInterval: 60 * 60 * 1000,
  });

  const stations = query.data?.stations ?? [];
  const selected = stations.find((station) => station.name === selectedName) ?? stations[0];
  const chartRows = selected?.data ?? [];

  return (
    <>
      <TopBar
        title="Danube Hydrology"
        subtitle="Official RHMZ water-level gauges · hourly observations · last 7 days"
        onRefresh={() => query.refetch()}
        isRefreshing={query.isFetching}
        lastRefresh={query.data?.fetchedAt}
        hideRange
      />

      <div className="space-y-5 p-6">
        <div className="rounded-xl border border-primary/25 bg-primary/5 p-4 text-sm text-muted-foreground">
          <div className="mb-1 flex items-center gap-2 font-medium text-foreground">
            <Droplets className="h-4 w-4 text-primary" />
            Official Serbian Danube gauge signal
          </div>
          Water levels are station-relative gauge readings. Compare each station with its own recent
          history rather than comparing the absolute centimetre values between stations.
        </div>

        <Panel
          title="RHMZ Danube stations"
          actions={<DataBadge source={query.data?.source ?? (query.isLoading ? "partial" : "empty")} />}
        >
          <div className="flex flex-wrap gap-2">
            {stations.map((station) => (
              <Button
                key={station.id}
                size="sm"
                variant={selected?.id === station.id ? "default" : "outline"}
                onClick={() => setSelectedName(station.name)}
              >
                {station.name}
              </Button>
            ))}
          </div>
          {query.isLoading ? (
            <p className="py-5 text-sm text-muted-foreground">Loading RHMZ observations...</p>
          ) : !stations.length ? (
            <p className="py-5 text-sm text-destructive">
              RHMZ water-level data is currently unavailable. {query.data?.reason}
            </p>
          ) : null}
        </Panel>

        {selected && (
          <>
            <div className="grid gap-4 md:grid-cols-4">
              <KPI
                label={`${selected.name} water level`}
                value={selected.latest_level_cm == null ? "-" : `${fmtNum(selected.latest_level_cm, 0)} cm`}
                sub={formatObservation(selected.latest_observation)}
              />
              <KPI
                label="24h change"
                value={signedCm(selected.change_24h_cm)}
                sub={
                  selected.change_24h_cm == null
                    ? "Insufficient hourly history"
                    : selected.change_24h_cm > 0
                      ? "Rising"
                      : selected.change_24h_cm < 0
                        ? "Falling"
                        : "Stable"
                }
              />
              <KPI
                label="7-day minimum"
                value={selected.min_7d_cm == null ? "-" : `${fmtNum(selected.min_7d_cm, 0)} cm`}
                sub={`Gauge zero ${fmtNum(selected.gauge_zero_m, 2)} m a.s.l.`}
              />
              <KPI
                label="7-day maximum"
                value={selected.max_7d_cm == null ? "-" : `${fmtNum(selected.max_7d_cm, 0)} cm`}
                sub={`${selected.data.length} hourly observations`}
              />
            </div>

            <Panel
              title={`${selected.name} - Danube water level (cm)`}
              actions={<DataBadge source={selected.status} />}
            >
              {chartRows.length ? (
                <div className="h-80">
                  <ResponsiveContainer>
                    <LineChart data={chartRows}>
                      <CartesianGrid stroke="var(--color-grid)" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="ts"
                        minTickGap={36}
                        fontSize={11}
                        tickFormatter={(value) =>
                          new Date(value).toLocaleDateString("en-GB", {
                            timeZone: "Europe/Belgrade",
                            day: "2-digit",
                            month: "short",
                          })
                        }
                      />
                      <YAxis
                        fontSize={11}
                        domain={["dataMin - 5", "dataMax + 5"]}
                        tickFormatter={(value) => `${value}`}
                      />
                      <Tooltip
                        labelFormatter={(value) => formatObservation(String(value))}
                        formatter={(value) => [`${fmtNum(Number(value), 0)} cm`, "Water level"]}
                        contentStyle={{
                          background: "var(--color-surface-2)",
                          border: "1px solid var(--color-border)",
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="level_cm"
                        name="Water level"
                        stroke="var(--color-primary)"
                        dot={false}
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No hourly observations returned for this station.
                </p>
              )}
            </Panel>
          </>
        )}

        <Panel title="Station overview">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-2 text-left">Station</th>
                  <th className="text-right">Latest</th>
                  <th className="text-right">24h change</th>
                  <th className="text-right">7d range</th>
                  <th className="text-right">Observed</th>
                  <th className="text-right">Source</th>
                </tr>
              </thead>
              <tbody>
                {stations.map((station) => (
                  <tr key={station.id} className="border-t border-border/60">
                    <td className="py-2 font-medium">{station.name}</td>
                    <td className="num text-right">
                      {station.latest_level_cm == null ? "-" : `${fmtNum(station.latest_level_cm, 0)} cm`}
                    </td>
                    <td className="num text-right">{signedCm(station.change_24h_cm)}</td>
                    <td className="num text-right">
                      {station.min_7d_cm == null || station.max_7d_cm == null
                        ? "-"
                        : `${fmtNum(station.min_7d_cm, 0)} to ${fmtNum(station.max_7d_cm, 0)} cm`}
                    </td>
                    <td className="text-right text-xs text-muted-foreground">
                      {formatObservation(station.latest_observation)}
                    </td>
                    <td className="text-right">
                      <a
                        href={station.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        RHMZ <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}
