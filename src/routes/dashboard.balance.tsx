import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { DataBadge } from "@/components/data-badge";
import { KPI } from "@/components/kpi";
import { Panel } from "@/components/panel";
import { TopBar } from "@/components/top-bar";
import { useDateRange } from "@/lib/date-range";
import { getBalance, getWb6Balance } from "@/lib/data.functions";
import { fmtMW, fmtNum } from "@/lib/format";
import { useLang } from "@/lib/i18n";

export const Route = createFileRoute("/dashboard/balance")({
  head: () => ({ meta: [{ title: "Regional & Serbia Balance - CEA Power Dashboard" }] }),
  component: BalancePage,
});

function BalancePage() {
  const balanceFn = useServerFn(getBalance);
  const wb6Fn = useServerFn(getWb6Balance);
  const { range } = useDateRange();
  const { t } = useLang();
  const balance = useQuery({
    queryKey: ["balance", range.from, range.to],
    queryFn: () => balanceFn({ data: { from: range.from, to: range.to } }),
  });
  const wb6 = useQuery({
    queryKey: ["wb6_balance", range.from, range.to],
    queryFn: () => wb6Fn({ data: { from: range.from, to: range.to } }),
    staleTime: 15 * 60 * 1000,
    retry: 1,
  });

  const data = (balance.data?.points ?? []).map((p, i) => ({
    hour: i,
    load: p.load_mw,
    gen: p.gen_mw,
    delta: p.gen_mw != null && p.load_mw != null ? p.gen_mw - p.load_mw : null,
  }));
  const sumLoad = (balance.data?.points ?? []).reduce(
    (sum, point) =>
      sum +
      (point.load_mw != null && point.loadDurationMinutes != null
        ? (point.load_mw * point.loadDurationMinutes) / 60
        : 0),
    0,
  );
  const sumGen = (balance.data?.points ?? []).reduce(
    (sum, point) =>
      sum +
      (point.gen_mw != null && point.generationDurationMinutes != null
        ? (point.gen_mw * point.generationDurationMinutes) / 60
        : 0),
    0,
  );
  const net = sumGen - sumLoad;
  const wb6Countries = wb6.data?.countries ?? [];
  const wb6NetChart = wb6Countries.map((country) => ({
    country: country.code,
    net: country.netMwh,
    imports: country.importsMwh,
    exports: country.exportsMwh,
  }));

  return (
    <>
      <TopBar
        title={t("Regional & Serbia Balance", "Regionalni bilans i bilans Srbije")}
        subtitle={t(
          "Serbia load and generation plus WB6 physical import, export and net-position comparison.",
          "Potrošnja i proizvodnja Srbije uz WB6 poređenje fizičkog uvoza, izvoza i neto pozicije.",
        )}
        onRefresh={() => {
          balance.refetch();
          wb6.refetch();
        }}
        isRefreshing={balance.isFetching || wb6.isFetching}
        lastRefresh={wb6.data?.fetched_at}
        hideRange
      />
      <div className="space-y-5 p-6">
        <Panel title={t("Serbia market position", "Pozicija tržišta Srbije")}>
          <div className="mb-4 grid gap-3 md:grid-cols-3">
            <KPI
              label={t("Total load (MWh)", "Ukupna potrošnja (MWh)")}
              value={fmtMW(sumLoad)}
              source={balance.data?.load.status}
            />
            <KPI
              label={t("Total generation (MWh)", "Ukupna proizvodnja (MWh)")}
              value={fmtMW(sumGen)}
              source={balance.data?.generation.status}
            />
            <KPI
              label={t("Generation minus load", "Proizvodnja umanjena za potrošnju")}
              value={fmtMW(net)}
              sub={
                net > 0
                  ? t("generation surplus", "višak proizvodnje")
                  : t("generation deficit", "manjak proizvodnje")
              }
              accent={net > 0 ? "success" : "destructive"}
            />
          </div>
          <div className="h-80">
            <ResponsiveContainer>
              <ComposedChart data={data}>
                <CartesianGrid stroke="var(--color-grid)" strokeDasharray="3 3" />
                <XAxis dataKey="hour" stroke="var(--color-muted-foreground)" fontSize={11} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={11} unit=" MW" />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-surface-2)",
                    border: "1px solid var(--color-border)",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar
                  dataKey="delta"
                  name={t("Gen - Load", "Proizv. − Potr.")}
                  fill="#1ec8c8"
                  opacity={0.5}
                />
                <Line
                  dataKey="load"
                  name={t("Load", "Potrošnja")}
                  stroke="#f5b14c"
                  dot={false}
                  strokeWidth={2}
                />
                <Line
                  dataKey="gen"
                  name={t("Generation", "Proizvodnja")}
                  stroke="#34d399"
                  dot={false}
                  strokeWidth={2}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel
          title={t("WB6 comparison", "Poređenje WB6")}
          actions={wb6.data ? <DataBadge source={wb6.data.status} /> : undefined}
        >
          {wb6.data?.reason ? (
            <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
              {wb6.data.reason}
            </div>
          ) : null}
          <div className="mb-4 grid gap-3 md:grid-cols-4">
            <KPI
              label={t("Top importer", "Najveći uvoznik")}
              value={wb6.data?.topImporter?.code ?? "n/a"}
              sub={fmtMW(wb6.data?.topImporter?.importsMwh ?? null)}
            />
            <KPI
              label={t("Top exporter", "Najveći izvoznik")}
              value={wb6.data?.topExporter?.code ?? "n/a"}
              sub={fmtMW(wb6.data?.topExporter?.exportsMwh ?? null)}
            />
            <KPI
              label={t("Top net importer", "Najveći neto uvoznik")}
              value={wb6.data?.topNetImporter?.code ?? "n/a"}
              sub={fmtMW(wb6.data?.topNetImporter?.netMwh ?? null)}
              accent="destructive"
            />
            <KPI
              label={t("Intra-WB6 share", "Udeo unutar WB6")}
              value={
                wb6.data?.totals.intraWb6Share == null
                  ? "n/a"
                  : `${fmtNum(wb6.data.totals.intraWb6Share)}%`
              }
              sub={t("of measured exchange", "izmerenih razmena")}
            />
          </div>
          <div className="h-80">
            <ResponsiveContainer>
              <RechartsBarChart data={wb6NetChart}>
                <CartesianGrid stroke="var(--color-grid)" strokeDasharray="3 3" />
                <XAxis dataKey="country" stroke="var(--color-muted-foreground)" fontSize={11} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={11} unit=" MWh" />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-surface-2)",
                    border: "1px solid var(--color-border)",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="imports" name={t("Imports", "Uvoz")} fill="#f5b14c" />
                <Bar dataKey="exports" name={t("Exports", "Izvoz")} fill="#34d399" />
                <Bar dataKey="net" name={t("Net imports", "Neto uvoz")} fill="#1ec8c8" />
              </RechartsBarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel
          title={t(
            "Import, export and net-balance analysis",
            "Analiza uvoza, izvoza i neto bilansa",
          )}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-1.5 text-left">{t("Country", "Zemlja")}</th>
                  <th className="text-right">{t("Imports", "Uvoz")}</th>
                  <th className="text-right">{t("Exports", "Izvoz")}</th>
                  <th className="text-right">{t("Net imports", "Neto uvoz")}</th>
                  <th className="text-right">{t("External exchange", "Spoljna razmena")}</th>
                  <th className="text-right">{t("Coverage", "Pokrivenost")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {wb6Countries.map((country) => (
                  <tr key={country.code} className="border-t border-border/60">
                    <td className="py-1.5 font-medium">
                      {country.name} ({country.code})
                    </td>
                    <td className="num text-right">{fmtMW(country.importsMwh)}</td>
                    <td className="num text-right">{fmtMW(country.exportsMwh)}</td>
                    <td className="num text-right">{fmtMW(country.netMwh)}</td>
                    <td className="num text-right">
                      {fmtMW(country.externalImportsMwh + country.externalExportsMwh)}
                    </td>
                    <td className="num text-right">{fmtNum(country.coveragePct)}%</td>
                    <td className="text-right">
                      <DataBadge source={country.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {t(
              "Physical cross-border net position is not official system imbalance. Positive net means measured imports exceed measured exports for the selected period.",
              "Fizička prekogranična neto pozicija nije zvanični sistemski debalans. Pozitivan neto znači da je mereni uvoz veći od merenog izvoza za izabrani period.",
            )}
          </p>
        </Panel>
      </div>
    </>
  );
}
