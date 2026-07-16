import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  LineChart,
  Line,
} from "recharts";
import { AlertTriangle, Download } from "lucide-react";

import { getWb6Balance } from "@/lib/data.functions";
import { TopBar } from "@/components/top-bar";
import { Panel } from "@/components/panel";
import { KPI } from "@/components/kpi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDateRange } from "@/lib/date-range";
import { downloadCSV, fmtNum, fmtPct } from "@/lib/format";
import { useLang } from "@/lib/i18n";
import type { ZoneCode } from "@/lib/markets";

export const Route = createFileRoute("/dashboard/wb6")({
  head: () => ({ meta: [{ title: "WB6 Balance - CEA Power Dashboard" }] }),
  component: Wb6Page,
});

type Wb6Country = {
  code: ZoneCode;
  name: string;
  importsMwh: number;
  exportsMwh: number;
  netMwh: number;
  internalImportsMwh: number;
  internalExportsMwh: number;
  externalImportsMwh: number;
  externalExportsMwh: number;
  totalExchangeMwh: number;
  coverageHours: number;
  expectedHours: number;
  coveragePct: number;
  rowCount: number;
  status: "live" | "cache" | "partial" | "unavailable";
};

type CounterpartyRow = {
  country: ZoneCode;
  counterparty: string;
  counterpartyName: string;
  importsMwh: number;
  exportsMwh: number;
  netMwh: number;
};

const WB6_CODES: ZoneCode[] = ["AL", "BA", "XK", "ME", "MK", "RS"];
const LINE_COLORS: Record<string, string> = {
  AL: "#60a5fa",
  BA: "#34d399",
  XK: "#f59e0b",
  ME: "#a78bfa",
  MK: "#f472b6",
  RS: "#22d3ee",
};

function Wb6Page() {
  const { t } = useLang();
  const fn = useServerFn(getWb6Balance);
  const { range } = useDateRange();
  const q = useQuery({
    queryKey: ["wb6-balance", range.from, range.to],
    queryFn: () => fn({ data: { from: range.from, to: range.to } }),
    staleTime: 15 * 60_000,
  });

  const countries = useMemo(() => (q.data?.countries ?? []) as Wb6Country[], [q.data?.countries]);
  const counterparties = useMemo(
    () => (q.data?.counterparties ?? []) as CounterpartyRow[],
    [q.data?.counterparties],
  );
  const hourly = useMemo(() => q.data?.hourly ?? [], [q.data?.hourly]);
  const topImporter = q.data?.topImporter as Wb6Country | null | undefined;
  const topExporter = q.data?.topExporter as Wb6Country | null | undefined;
  const topNetImporter = q.data?.topNetImporter as Wb6Country | null | undefined;
  const topNetExporter = q.data?.topNetExporter as Wb6Country | null | undefined;
  const totals = q.data?.totals;

  const chartRows = useMemo(
    () =>
      countries.map((country) => ({
        code: country.code,
        name: country.name,
        imports: country.importsMwh,
        exports: country.exportsMwh,
        net: country.netMwh,
        coverage: country.coveragePct,
        internal: country.internalImportsMwh + country.internalExportsMwh,
        external: country.externalImportsMwh + country.externalExportsMwh,
      })),
    [countries],
  );

  const csvRows = countries.map((country) => ({
    country: country.name,
    code: country.code,
    imports_mwh: country.importsMwh,
    exports_mwh: country.exportsMwh,
    net_import_mwh: country.netMwh,
    internal_exchange_mwh: country.internalImportsMwh + country.internalExportsMwh,
    external_exchange_mwh: country.externalImportsMwh + country.externalExportsMwh,
    coverage_hours: country.coverageHours,
    expected_hours: country.expectedHours,
    coverage_pct: country.coveragePct.toFixed(1),
    cached_rows: country.rowCount,
    status: country.status,
  }));

  return (
    <>
      <TopBar
        title="WB6"
        subtitle={t(
          "Western Balkans 6 physical-flow net position, imports and exports",
          "Neto pozicija, uvoz i izvoz fizičkih tokova za Zapadni Balkan 6",
        )}
        onRefresh={() => q.refetch()}
        isRefreshing={q.isFetching}
        lastRefresh={q.data?.fetched_at}
      />
      <div className="space-y-5 p-4 md:p-6">
        <Panel>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-sm font-semibold">
                {t("What this page shows", "Šta prikazuje ova strana")}
              </h2>
              <p className="mt-1 max-w-4xl text-sm text-muted-foreground">
                {t(
                  "Cached ENTSO-E physical cross-border flows are aggregated for Albania, Bosnia and Herzegovina, Kosovo, Montenegro, North Macedonia and Serbia. Positive net means net importer; negative net means net exporter.",
                  "Keširani ENTSO-E fizički prekogranični tokovi agregiraju se za Albaniju, Bosnu i Hercegovinu, Kosovo, Crnu Goru, Severnu Makedoniju i Srbiju. Pozitivan neto znači neto uvoznik; negativan neto znači neto izvoznik.",
                )}
              </p>
            </div>
            <Badge variant="outline" className="w-fit">
              {q.data?.status ?? "loading"}
            </Badge>
          </div>
          <div className="mt-3 rounded-lg border border-border/60 bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
            {t(
              "Methodology: imports and exports are directional physical flows converted to hourly MWh equivalents. This is not official system imbalance and depends on cached border coverage.",
              "Metodologija: uvoz i izvoz su usmereni fizički tokovi pretvoreni u satne MWh ekvivalente. Ovo nije zvanični sistemski disbalans i zavisi od pokrivenosti keširanih granica.",
            )}
          </div>
        </Panel>

        {q.data?.reason && (
          <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
            {q.data.reason}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <KPI
            label={t("Top importer", "Najveći uvoznik")}
            value={topImporter ? topImporter.code : "-"}
            sub={
              topImporter ? `${topImporter.name} · ${fmtMWh(topImporter.importsMwh)}` : noData(t)
            }
            accent="info"
          />
          <KPI
            label={t("Top exporter", "Najveći izvoznik")}
            value={topExporter ? topExporter.code : "-"}
            sub={
              topExporter ? `${topExporter.name} · ${fmtMWh(topExporter.exportsMwh)}` : noData(t)
            }
            accent="success"
          />
          <KPI
            label={t("Top net importer", "Najveći neto uvoznik")}
            value={topNetImporter ? topNetImporter.code : "-"}
            sub={topNetImporter ? fmtSignedMWh(topNetImporter.netMwh) : noData(t)}
            accent="warning"
          />
          <KPI
            label={t("Top net exporter", "Najveći neto izvoznik")}
            value={topNetExporter ? topNetExporter.code : "-"}
            sub={topNetExporter ? fmtSignedMWh(topNetExporter.netMwh) : noData(t)}
            accent="success"
          />
          <KPI
            label={t("Intra-WB6 share", "Udeo unutar WB6")}
            value={fmtPct(totals?.intraWb6Share)}
            sub={
              totals
                ? `${fmtMWh(totals.internalExchangeMwh)} ${t("internal legs", "interni tokovi")}`
                : noData(t)
            }
            accent="primary"
          />
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <Panel title={t("Net balance by country", "Neto bilans po zemlji")}>
            {chartRows.length ? (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={chartRows} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-grid)" />
                  <XAxis dataKey="code" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtAxis(Number(v))} />
                  <ReferenceLine y={0} stroke="var(--color-muted-foreground)" />
                  <Tooltip content={<ChartTooltip suffix="MWh" />} />
                  <Bar dataKey="net" name={t("Net import", "Neto uvoz")} radius={[4, 4, 0, 0]}>
                    {chartRows.map((row) => (
                      <Cell
                        key={row.code}
                        fill={row.net >= 0 ? "var(--color-info)" : "var(--color-success)"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState />
            )}
          </Panel>

          <Panel title={t("Imports and exports", "Uvoz i izvoz")}>
            {chartRows.length ? (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={chartRows} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-grid)" />
                  <XAxis dataKey="code" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtAxis(Number(v))} />
                  <Tooltip content={<ChartTooltip suffix="MWh" />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    dataKey="imports"
                    name={t("Imports", "Uvoz")}
                    fill="var(--color-info)"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="exports"
                    name={t("Exports", "Izvoz")}
                    fill="var(--color-success)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState />
            )}
          </Panel>
        </div>

        <Panel title={t("Hourly net position", "Satna neto pozicija")}>
          {hourly.length ? (
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={hourly} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-grid)" />
                <XAxis
                  dataKey="ts"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(ts) =>
                    new Date(String(ts)).toLocaleString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      timeZone: "Europe/Belgrade",
                    })
                  }
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtAxis(Number(v))} />
                <ReferenceLine y={0} stroke="var(--color-muted-foreground)" />
                <Tooltip
                  labelFormatter={(label) =>
                    new Date(String(label)).toLocaleString("en-GB", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Europe/Belgrade",
                    })
                  }
                  formatter={(value) => [fmtSignedMWh(Number(value)), t("Net", "Neto")]}
                  contentStyle={{
                    background: "var(--color-surface-2)",
                    border: "1px solid var(--color-border)",
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {WB6_CODES.map((code) => (
                  <Line
                    key={code}
                    type="monotone"
                    dataKey={code}
                    name={code}
                    stroke={LINE_COLORS[code]}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState />
          )}
        </Panel>

        <div className="grid gap-5 xl:grid-cols-2">
          <Panel title={t("Internal vs external exchange", "Interna i eksterna razmena")}>
            {chartRows.length ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartRows} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-grid)" />
                  <XAxis dataKey="code" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtAxis(Number(v))} />
                  <Tooltip content={<ChartTooltip suffix="MWh" />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    dataKey="internal"
                    name={t("Intra-WB6", "Unutar WB6")}
                    stackId="exchange"
                    fill="var(--color-chart-2)"
                  />
                  <Bar
                    dataKey="external"
                    name={t("External borders", "Eksterne granice")}
                    stackId="exchange"
                    fill="var(--color-chart-4)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState />
            )}
          </Panel>

          <Panel
            title={t("Main counterparties", "Glavni kontra-partneri")}
            actions={
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5"
                onClick={() => downloadCSV("wb6-balance.csv", csvRows)}
              >
                <Download className="h-3.5 w-3.5" />
                CSV
              </Button>
            }
          >
            {counterparties.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr className="border-b border-border/60">
                      <th className="px-2 py-2 text-left">{t("Country", "Zemlja")}</th>
                      <th className="text-left">{t("Counterparty", "Kontra-partner")}</th>
                      <th className="text-right">{t("Imports", "Uvoz")}</th>
                      <th className="text-right">{t("Exports", "Izvoz")}</th>
                      <th className="text-right">{t("Net", "Neto")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {counterparties.map((row) => (
                      <tr
                        key={`${row.country}-${row.counterparty}`}
                        className="border-b border-border/40"
                      >
                        <td className="px-2 py-2 font-medium">{row.country}</td>
                        <td>
                          <span className="font-medium">{row.counterparty}</span>
                          <span className="ml-2 text-muted-foreground">{row.counterpartyName}</span>
                        </td>
                        <td className="num text-right">{fmtMWh(row.importsMwh)}</td>
                        <td className="num text-right">{fmtMWh(row.exportsMwh)}</td>
                        <td
                          className={`num text-right font-medium ${
                            row.netMwh >= 0 ? "text-info" : "text-success"
                          }`}
                        >
                          {fmtSignedMWh(row.netMwh)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState />
            )}
          </Panel>
        </div>

        <Panel title={t("Data coverage", "Pokrivenost podataka")}>
          {countries.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b border-border/60">
                    <th className="px-2 py-2 text-left">{t("Country", "Zemlja")}</th>
                    <th className="text-right">{t("Coverage", "Pokrivenost")}</th>
                    <th className="text-right">{t("Hours", "Sati")}</th>
                    <th className="text-right">{t("Rows", "Redovi")}</th>
                    <th className="text-center">{t("Status", "Status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {countries.map((country) => (
                    <tr key={country.code} className="border-b border-border/40">
                      <td className="px-2 py-2">
                        <span className="font-medium">{country.code}</span>
                        <span className="ml-2 text-muted-foreground">{country.name}</span>
                      </td>
                      <td className="num text-right">{fmtPct(country.coveragePct)}</td>
                      <td className="num text-right">
                        {country.coverageHours}/{country.expectedHours}
                      </td>
                      <td className="num text-right">{fmtNum(country.rowCount, 0)}</td>
                      <td className="text-center">
                        <Badge variant="outline" className={statusClass(country.status)}>
                          {country.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState />
          )}
        </Panel>

        {q.isError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {t("Failed to load WB6 balance data.", "Učitavanje WB6 bilansa nije uspelo.")}
          </div>
        )}
      </div>
    </>
  );
}

function fmtMWh(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "-" : `${fmtNum(value, 0)} MWh`;
}

function fmtSignedMWh(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${fmtMWh(value)}`;
}

function fmtAxis(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${fmtNum(value / 1_000_000, 1)}m`;
  if (abs >= 1_000) return `${fmtNum(value / 1_000, 0)}k`;
  return fmtNum(value, 0);
}

function noData(t: (en: string, sr: string) => string) {
  return t("No data", "Nema podataka");
}

function statusClass(status: Wb6Country["status"]) {
  if (status === "live") return "border-info/40 bg-info/10 text-info";
  if (status === "cache") return "border-success/40 bg-success/10 text-success";
  if (status === "partial") return "border-warning/40 bg-warning/10 text-warning";
  return "border-muted bg-muted/20 text-muted-foreground";
}

function EmptyState() {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
      <AlertTriangle className="h-5 w-5 opacity-60" />
      No cached WB6 flow data available for this selection.
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  suffix,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
  suffix: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs shadow">
      <div className="mb-1 font-medium">{label}</div>
      <div className="space-y-1">
        {payload.map((item) => (
          <div key={item.name} className="flex items-center justify-between gap-4">
            <span style={{ color: item.color }}>{item.name}</span>
            <span className="num">
              {fmtNum(Number(item.value ?? 0), 0)} {suffix}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
