import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, Download } from "lucide-react";

import { KpiCard, PageLoadingSkeleton } from "@/components/dashboard/atoms";
import { AssetEmptyState } from "@/components/dashboard/WorkspaceSelectors";
import { Button } from "@/components/ui/button";
import { useDateRange } from "@/lib/date-range";
import { getFlowAnalytics } from "@/lib/data.functions";
import { downloadCSV, fmtMW, fmtNum } from "@/lib/format";
import { useLang } from "@/lib/i18n";
import { formatEnergyMWh, integratePowerSeries } from "@/lib/units";

export const Route = createFileRoute("/dashboard/markets/system")({
  head: () => ({ meta: [{ title: "System & Borders - CEA Power Dashboard" }] }),
  component: SystemPage,
});

function SystemPage() {
  const { t } = useLang();
  const { range } = useDateRange();
  const fn = useServerFn(getFlowAnalytics);
  const q = useQuery({
    queryKey: ["system-borders", range.from, range.to],
    queryFn: () => fn({ data: { from: range.from, to: range.to } }),
  });
  const borders = q.data?.borders ?? [];
  const rows = borders.map((border) => {
    const last = border.hourly[border.hourly.length - 1];
    const netValues = border.hourly.map((point) => point.net_mw);
    const peak = netValues.length ? Math.max(...netValues.map(Math.abs)) : null;
    const avg =
      netValues.length > 0
        ? netValues.reduce((sum, value) => sum + value, 0) / netValues.length
        : null;
    const netEnergy = integratePowerSeries(
      border.hourly.map((point) => ({
        ts: point.ts,
        mw: point.net_mw,
        durationMinutes: point.durationMinutes,
      })),
    );
    const cap = avg != null && avg >= 0 ? border.capacity_imp_mw : border.capacity_exp_mw;
    const util = avg != null && cap ? (Math.abs(avg) / cap) * 100 : null;
    return {
      neighbour: border.neighbour,
      net: last?.net_mw ?? null,
      avg,
      peak,
      netEnergyMWh: netEnergy.mwh,
      energyCoveragePct: netEnergy.coveragePct,
      cap,
      capacityImportMW: border.capacity_imp_mw,
      capacityExportMW: border.capacity_exp_mw,
      util,
      source:
        border.source_imp === "empty" && border.source_exp === "empty"
          ? "Unavailable"
          : "Available",
    };
  });
  const latestNetPositionMW =
    rows.length > 0 ? rows.reduce((sum, row) => sum + (row.net ?? 0), 0) : null;
  const totalNetEnergyMWh =
    rows.length > 0 ? rows.reduce((sum, row) => sum + row.netEnergyMWh, 0) : null;
  const incompleteEnergyRows = rows.filter(
    (row) => row.energyCoveragePct != null && row.energyCoveragePct < 99.5,
  );
  const highestUtil = rows
    .filter((row) => row.util != null)
    .sort((a, b) => (b.util ?? 0) - (a.util ?? 0))[0];
  const exportCsv = () => {
    downloadCSV(
      `system-borders-${range.from}-${range.to}.csv`,
      rows.map((row) => ({
        neighbour: row.neighbour,
        latest_flow_mw: row.net,
        average_flow_mw: row.avg,
        peak_flow_mw: row.peak,
        net_energy_mwh: row.netEnergyMWh,
        energy_coverage_pct: row.energyCoveragePct,
        capacity_import_mw: row.capacityImportMW,
        capacity_export_mw: row.capacityExportMW,
        selected_capacity_mw: row.cap,
        utilization_pct: row.util,
        source: row.source,
      })),
    );
  };

  if (q.isLoading) return <PageLoadingSkeleton />;
  if (!rows.length) {
    return (
      <AssetEmptyState
        title={t("System data unavailable", "Sistemski podaci nisu dostupni")}
        description={t(
          "Physical-flow and capacity rows are unavailable for the selected period.",
          "Fizicki tokovi i kapaciteti nisu dostupni za izabrani period.",
        )}
      />
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold">{t("System & Borders", "Sistem i granice")}</h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              {t(
                "Commercial border view combining physical flow direction, available capacity and utilization. Physical net position is not official system imbalance.",
                "Komercijalni pregled granica koji kombinuje smer fizickog toka, raspolozivi kapacitet i iskoriscenost. Fizicka neto pozicija nije zvanicni sistemski debalans.",
              )}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" className="gap-2" onClick={exportCsv}>
            <Download className="h-4 w-4" />
            CSV
          </Button>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Serbia latest net position"
          value={latestNetPositionMW == null ? "N/A" : fmtMW(latestNetPositionMW)}
        />
        <KpiCard
          label="Net transferred energy"
          value={totalNetEnergyMWh == null ? "N/A" : formatEnergyMWh(totalNetEnergyMWh)}
          unit={range.to !== range.from ? `${range.from} to ${range.to}` : range.from}
        />
        <KpiCard
          label="Highest utilization"
          value={highestUtil ? `${fmtNum(highestUtil.util)}%` : "N/A"}
          unit={highestUtil?.neighbour}
        />
        <KpiCard
          label="Measured borders"
          value={String(rows.filter((row) => row.source === "Available").length)}
        />
      </section>

      {incompleteEnergyRows.length > 0 ? (
        <div className="rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
          {t(
            "Energy totals skip intervals without reliable duration; coverage is incomplete for one or more border series in the selected period.",
            "Energetski zbir preskace intervale bez pouzdanog trajanja; pokrivenost je nepotpuna za jednu ili vise granicnih serija u izabranom periodu.",
          )}
        </div>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => (
          <div key={row.neighbour} className="rounded-lg border border-border/70 bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-base font-semibold">
                <ArrowLeftRight className="h-4 w-4 text-primary" />
                {row.neighbour} ↔ RS
              </div>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                {row.source}
              </span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Latest flow</dt>
                <dd className="num font-semibold">{fmtMW(row.net)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Avg flow</dt>
                <dd className="num font-semibold">{fmtMW(row.avg)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Peak flow</dt>
                <dd className="num font-semibold">{fmtMW(row.peak)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Utilization</dt>
                <dd className="num font-semibold">
                  {row.util == null ? "N/A" : `${fmtNum(row.util)}%`}
                </dd>
              </div>
            </dl>
          </div>
        ))}
      </section>
    </div>
  );
}
