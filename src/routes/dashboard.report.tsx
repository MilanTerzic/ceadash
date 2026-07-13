import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { toJpeg } from "html-to-image";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download, ImageDown, Printer } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChartCard, KpiCard } from "@/components/dashboard/atoms";
import { DateRangeControl, useRequestedRangeKeys } from "@/components/dashboard/DateRangeControl";
import { useLang } from "@/lib/i18n";
import { getCeaTraderReport, type CeaTraderReport } from "@/lib/report.functions";
import type { CaptureSummary, MarketPriceSummary } from "@/lib/report.analytics";

export const Route = createFileRoute("/dashboard/report")({
  head: () => ({
    meta: [
      { title: "Trader Report - CEA Power Dashboard" },
      {
        name: "description",
        content: "CEA-styled trading report combining Serbia and regional power-market signals.",
      },
      { property: "og:title", content: "Trader Report - CEA Power Dashboard" },
      {
        property: "og:description",
        content:
          "Serbia day-ahead, regional spreads, RES capture, BESS spreads and physical-flow snapshot.",
      },
    ],
  }),
  component: TraderReportPage,
});

const MARKET_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-chart-6)",
  "oklch(0.58 0.10 150)",
  "oklch(0.58 0.09 300)",
  "oklch(0.62 0.13 55)",
  "oklch(0.48 0.06 210)",
];

function fmt(v: number | null | undefined, digits = 1) {
  return v == null || !Number.isFinite(v) ? "N/A" : v.toFixed(digits);
}

function fmtPct(v: number | null | undefined, digits = 0) {
  return v == null || !Number.isFinite(v) ? "N/A" : `${(v * 100).toFixed(digits)}%`;
}

function csvEscape(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function tableToCsv(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(",")),
  ].join("\n");
}

function exportReportCsv(report: CeaTraderReport) {
  const parts = [
    "# CEA Trader Report",
    `# Period,${report.period.from},${report.period.to}`,
    "",
    "# Market Summary",
    tableToCsv(report.prices.marketSummary as unknown as Array<Record<string, unknown>>),
    "",
    "# Daily Baseload",
    tableToCsv(report.prices.dailyBaseload),
    "",
    "# Daily RES Capture",
    tableToCsv(report.capture.daily as unknown as Array<Record<string, unknown>>),
    "",
    "# Latest 24h Flow Snapshot",
    tableToCsv(report.flows.latest24h as unknown as Array<Record<string, unknown>>),
    "",
    "# Coverage",
    tableToCsv(report.coverage as unknown as Array<Record<string, unknown>>),
  ];
  const blob = new Blob([parts.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cea-trader-report-${report.period.from}-${report.period.to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function heatCellColor(value: number | undefined) {
  if (value == null || !Number.isFinite(value)) return "bg-muted/30";
  if (value < 0) return "bg-sky-500/35";
  if (value < 40) return "bg-positive/30";
  if (value < 90) return "bg-primary/25";
  if (value < 150) return "bg-warning/35";
  return "bg-critical/35";
}

function PeriodBadge({ report }: { report: CeaTraderReport }) {
  return (
    <Badge variant="secondary" className="text-[10px]">
      {report.period.from} {"->"} {report.period.to} - {report.period.timezone}
    </Badge>
  );
}

function TraderReportPage() {
  const { t } = useLang();
  const linkedinCardRef = useRef<HTMLDivElement>(null);
  const [isExportingLinkedIn, setIsExportingLinkedIn] = useState(false);
  const requested = useRequestedRangeKeys();
  const reportQuery = useQuery({
    queryKey: ["cea-trader-report", requested.fromKey, requested.toKey, requested.preset],
    queryFn: () => getCeaTraderReport({ data: { from: requested.fromKey, to: requested.toKey } }),
    staleTime: 30 * 60_000,
  });

  const report = reportQuery.data;
  const zones = useMemo(
    () => report?.prices.marketSummary.map((m) => m.zone) ?? [],
    [report?.prices.marketSummary],
  );
  const rs = report?.prices.marketSummary.find((m) => m.zone === "RS");
  const hu = report?.prices.marketSummary.find((m) => m.zone === "HU");
  const capture = report?.capture.summary ?? null;
  const bestSpread = report?.prices.marketSummary
    .filter((m) => m.zone !== "RS" && m.spreadVsRs != null)
    .sort((a, b) => Math.abs(b.spreadVsRs ?? 0) - Math.abs(a.spreadVsRs ?? 0))[0];

  const exportLinkedInJpeg = async () => {
    if (!report || !linkedinCardRef.current) return;
    setIsExportingLinkedIn(true);
    try {
      await document.fonts?.ready;
      const dataUrl = await toJpeg(linkedinCardRef.current, {
        quality: 0.95,
        pixelRatio: 1,
        cacheBust: true,
        backgroundColor: "#fefff2",
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `cea-trader-linkedin-${report.period.from}-${report.period.to}.jpg`;
      a.click();
      toast.success(t("LinkedIn JPEG created", "LinkedIn JPEG je kreiran"));
    } catch (error) {
      toast.error(
        `${t("JPEG export failed", "JPEG izvoz nije uspeo")}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      setIsExportingLinkedIn(false);
    }
  };

  if (reportQuery.isLoading) {
    return (
      <div className="space-y-6">
        <DateRangeControl />
        <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-card">
          <p className="text-sm text-muted-foreground">
            {t("Building trader report...", "Priprema traderskog izvestaja...")}
          </p>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="space-y-6">
        <DateRangeControl />
        <div className="rounded-2xl border border-warning/40 bg-warning/10 p-5 text-sm">
          {t(
            "No report data is available for this period.",
            "Nema dostupnih podataka za izvestaj u ovom periodu.",
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 print:bg-white">
      <div className="print:hidden">
        <DateRangeControl />
      </div>

      <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-3xl">{t("Trader Report", "Traderski izvestaj")}</h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              {t(
                "CEA-style market brief combining Serbia day-ahead prices, regional spreads, RES capture signals, BESS spreads and a latest physical-flow snapshot.",
                "CEA market brief koji spaja Serbia day-ahead cene, regionalne spreadove, RES capture signale, BESS spreadove i poslednji snapshot fizickih tokova.",
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PeriodBadge report={report} />
            <Button size="sm" variant="outline" onClick={() => exportReportCsv(report)}>
              <Download className="mr-2 h-4 w-4" />
              CSV
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isExportingLinkedIn}
              onClick={exportLinkedInJpeg}
            >
              <ImageDown className="mr-2 h-4 w-4" />
              {isExportingLinkedIn ? t("Creating...", "Kreiram...") : "LinkedIn JPEG"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />
              {t("Print", "Stampaj")}
            </Button>
          </div>
        </div>
      </section>

      <LinkedInReportCard
        cardRef={linkedinCardRef}
        report={report}
        rs={rs}
        hu={hu}
        capture={capture}
        bestSpread={bestSpread}
      />

      <ChartCard
        title={t("Desk Summary", "Desk Summary")}
        description={t(
          "Deterministic observations calculated from available report data. Missing inputs are skipped, not replaced with demo values.",
          "Deterministicki zakljucci iz dostupnih podataka. Nedostajuci inputi se preskacu, ne zamenjuju demo vrednostima.",
        )}
        right={<PeriodBadge report={report} />}
      >
        {report.deskSummary.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {report.deskSummary.map((line) => (
              <div
                key={line}
                className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm leading-relaxed"
              >
                {line}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t(
              "No complete observations can be generated for this range.",
              "Nema dovoljno podataka za zakljucke u ovom opsegu.",
            )}
          </p>
        )}
      </ChartCard>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="RS baseload" value={fmt(rs?.baseload)} unit="EUR/MWh" />
        <KpiCard label="RS peakload" value={fmt(rs?.peakload)} unit="EUR/MWh" />
        <KpiCard label="RS volatility" value={fmt(rs?.volatility)} unit="EUR/MWh" />
        <KpiCard label="Negative-price hours" value={rs?.negativeHours ?? "N/A"} />
        <KpiCard label="RS min price" value={fmt(rs?.min)} unit="EUR/MWh" />
        <KpiCard label="RS max price" value={fmt(rs?.max)} unit="EUR/MWh" />
        <KpiCard
          label="RS vs HU"
          value={
            rs?.baseload != null && hu?.baseload != null ? fmt(rs.baseload - hu.baseload) : "N/A"
          }
          unit="EUR/MWh"
        />
        <KpiCard
          label="Largest RS spread"
          value={bestSpread?.spreadVsRs != null ? fmt(bestSpread.spreadVsRs) : "N/A"}
          unit={bestSpread ? `vs ${bestSpread.zone}` : "EUR/MWh"}
        />
        <KpiCard label="Solar capture" value={fmt(capture?.solarCapture)} unit="EUR/MWh" />
        <KpiCard label="Wind capture" value={fmt(capture?.windCapture)} unit="EUR/MWh" />
        <KpiCard label="BESS 2h net" value={fmt(capture?.bessNet2h)} unit="EUR/MWh" />
        <KpiCard label="BESS 4h net" value={fmt(capture?.bessNet4h)} unit="EUR/MWh" />
      </div>

      <ChartCard
        title={t("Daily Baseload Prices by Market", "Dnevne baseload cene po trzistu")}
        description={t(
          "Arithmetic average of available hourly day-ahead prices per local Belgrade delivery day.",
          "Aritmeticki prosek dostupnih hourly day-ahead cena po lokalnom Belgrade delivery day.",
        )}
      >
        {report.prices.dailyBaseload.length ? (
          <ResponsiveContainer width="100%" height={360}>
            <LineChart data={report.prices.dailyBaseload}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              />
              <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} unit=" EUR" />
              <RTooltip />
              <Legend />
              {zones.map((zone, idx) => (
                <Line
                  key={zone}
                  type="monotone"
                  dataKey={zone}
                  name={zone}
                  stroke={
                    zone === "RS"
                      ? "var(--color-primary)"
                      : MARKET_COLORS[idx % MARKET_COLORS.length]
                  }
                  strokeWidth={zone === "RS" ? 3 : 1.7}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("No price data available.", "Nema dostupnih cena.")}
          </p>
        )}
      </ChartCard>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <ChartCard
          title={t("Serbia Hourly Price Heatmap", "Hourly heatmap cena Srbije")}
          description={t(
            "Rows are Belgrade delivery dates; columns are local hours 00-23.",
            "Redovi su Belgrade delivery datumi; kolone su lokalni sati 00-23.",
          )}
        >
          {report.prices.serbiaHeatmap.length ? (
            <div className="overflow-x-auto">
              <div
                className="grid min-w-[760px] gap-1 text-[10px]"
                style={{ gridTemplateColumns: "92px repeat(24, minmax(22px, 1fr))" }}
              >
                <div />
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="text-center text-muted-foreground">
                    {String(h).padStart(2, "0")}
                  </div>
                ))}
                {report.prices.serbiaHeatmap.map((row) => (
                  <div key={row.date} className="contents">
                    <div key={`${row.date}-label`} className="pr-2 text-xs text-muted-foreground">
                      {row.date}
                    </div>
                    {Array.from({ length: 24 }, (_, h) => {
                      const value = row.hours[String(h)];
                      return (
                        <div
                          key={`${row.date}-${h}`}
                          className={`h-6 rounded-sm border border-border/40 ${heatCellColor(value)}`}
                          title={`${row.date} ${String(h).padStart(2, "0")}:00 - ${fmt(value)} EUR/MWh`}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="h-3 w-3 rounded-sm bg-sky-500/35" /> negative
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-3 w-3 rounded-sm bg-positive/30" /> low
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-3 w-3 rounded-sm bg-warning/35" /> high
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-3 w-3 rounded-sm bg-critical/35" /> extreme
                </span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("No Serbia hourly data available.", "Nema hourly podataka za Srbiju.")}
            </p>
          )}
        </ChartCard>

        <ChartCard
          title={t("RES Capture and BESS Signals", "RES capture i BESS signali")}
          description={t(
            "Capture uses Serbia day-ahead prices and available ENTSO-E generation inputs; solar may be modelled where ENTSO-E does not publish Serbia B16.",
            "Capture koristi Serbia day-ahead cene i dostupne ENTSO-E podatke o proizvodnji; solar moze biti modelovan kada ENTSO-E ne objavljuje B16 za Srbiju.",
          )}
          right={
            report.capture.solarSource ? (
              <Badge variant="outline" className="text-[10px]">
                solar: {report.capture.solarSource}
              </Badge>
            ) : null
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <MiniMetric label="Solar capture rate" value={fmtPct(capture?.solarCaptureRate, 1)} />
            <MiniMetric label="Wind capture rate" value={fmtPct(capture?.windCaptureRate, 1)} />
            <MiniMetric
              label="Solar neg. exposure"
              value={fmtPct(capture?.solarNegativeShare, 2)}
            />
            <MiniMetric label="Wind neg. exposure" value={fmtPct(capture?.windNegativeShare, 2)} />
          </div>
          <div className="mt-5">
            {report.capture.daily.length ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={report.capture.daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                  />
                  <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
                  <RTooltip />
                  <Legend />
                  <Bar dataKey="solarCapture" name="Solar capture" fill="var(--color-chart-3)" />
                  <Bar dataKey="windCapture" name="Wind capture" fill="var(--color-chart-2)" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("No RES capture inputs available.", "Nema RES capture inputa.")}
              </p>
            )}
          </div>
        </ChartCard>
      </div>

      <ChartCard
        title={t("Market Statistics", "Trzisna statistika")}
        description={t(
          "Spreads and correlations use overlapping hourly timestamps only. RS spread = Serbia price minus comparison-market price.",
          "Spreadovi i korelacije koriste samo poklopljene hourly timestampove. RS spread = cena Srbije minus cena uporednog trzista.",
        )}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/60 text-left text-muted-foreground">
                <th className="sticky left-0 bg-card py-2 pr-3">Market</th>
                <th className="py-2 pr-3 text-right">Base</th>
                <th className="py-2 pr-3 text-right">Peak</th>
                <th className="py-2 pr-3 text-right">Offpeak</th>
                <th className="py-2 pr-3 text-right">Min</th>
                <th className="py-2 pr-3 text-right">Max</th>
                <th className="py-2 pr-3 text-right">Std</th>
                <th className="py-2 pr-3 text-right">Neg h</th>
                <th className="py-2 pr-3 text-right">Spread vs RS</th>
                <th className="py-2 pr-3 text-right">Abs spread</th>
                <th className="py-2 pr-3 text-right">Cheaper than RS</th>
                <th className="py-2 pr-3 text-right">Corr vs RS</th>
                <th className="py-2 pr-3 text-right">Hours</th>
              </tr>
            </thead>
            <tbody>
              {report.prices.marketSummary.map((m) => (
                <tr key={m.zone} className="border-b border-border/40 hover:bg-muted/20">
                  <td className="sticky left-0 bg-card py-2 pr-3 font-medium">
                    {m.zone} <span className="text-muted-foreground">{m.name}</span>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmt(m.baseload)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmt(m.peakload)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmt(m.offpeak)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmt(m.min)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmt(m.max)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmt(m.volatility)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{m.negativeHours}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmt(m.spreadVsRs)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmt(m.absSpreadVsRs)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {fmtPct(m.cheaperThanRsPct)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmt(m.correlationVsRs, 2)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{m.availableHours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title={t(
            "Latest Serbia Physical-Flow Snapshot",
            "Poslednji snapshot fizickih tokova Srbije",
          )}
          description={report.flows.note}
        >
          {report.flows.latest24h.length ? (
            <div className="space-y-2">
              {report.flows.latest24h.map((f) => (
                <div
                  key={f.border}
                  className="flex items-center justify-between rounded-xl border border-border/60 p-3 text-sm"
                >
                  <div>
                    <div className="font-medium">{f.border}</div>
                    <div className="text-xs text-muted-foreground">{f.direction}</div>
                  </div>
                  <div className="text-right tabular-nums">
                    <div className={f.netMw >= 0 ? "text-positive" : "text-warning"}>
                      {fmt(f.netMw, 0)} MW
                    </div>
                    <div className="text-xs text-muted-foreground">abs {fmt(f.absMw, 0)} MW</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("No physical-flow snapshot available.", "Nema snapshota fizickih tokova.")}
            </p>
          )}
        </ChartCard>

        <ChartCard
          title={t("Data Coverage and Sources", "Pokrivenost podataka i izvori")}
          description="No missing dataset is converted to zero."
        >
          <div className="space-y-2">
            {report.coverage.map((row) => (
              <div key={row.dataset} className="rounded-xl border border-border/60 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{row.dataset}</span>
                  <Badge
                    variant={
                      row.status === "empty" || row.status === "error" ? "destructive" : "secondary"
                    }
                    className="text-[10px]"
                  >
                    {row.status}
                  </Badge>
                </div>
                <div className="mt-1 grid gap-x-3 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                  <span>
                    Rows: <span className="text-foreground">{row.rows}</span>
                  </span>
                  <span>
                    First: <span className="text-foreground">{row.firstTimestamp ?? "N/A"}</span>
                  </span>
                  <span>
                    Last: <span className="text-foreground">{row.lastTimestamp ?? "N/A"}</span>
                  </span>
                  {row.message ? (
                    <span className="sm:col-span-2">
                      Note: <span className="text-foreground">{row.message}</span>
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>

      <p className="text-xs text-muted-foreground">
        {t(
          "Indicative trading analytics before losses, fees, nomination constraints, balancing costs, taxes and other transaction costs.",
          "Indikativna trading analitika pre gubitaka, naknada, nominacionih ogranicenja, balancing troskova, poreza i drugih troskova transakcije.",
        )}
      </p>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl">{value}</div>
    </div>
  );
}

function LinkedInReportCard({
  cardRef,
  report,
  rs,
  hu,
  capture,
  bestSpread,
}: {
  cardRef: RefObject<HTMLDivElement | null>;
  report: CeaTraderReport;
  rs: MarketPriceSummary | undefined;
  hu: MarketPriceSummary | undefined;
  capture: CaptureSummary | null;
  bestSpread: MarketPriceSummary | undefined;
}) {
  const rsVsHu =
    rs?.baseload != null && hu?.baseload != null
      ? `${fmt(rs.baseload - hu.baseload)} EUR/MWh`
      : "N/A";
  const topRows = report.prices.marketSummary.slice(0, 5);

  return (
    <div className="fixed left-[-10000px] top-0 z-[-1] print:hidden" aria-hidden="true">
      <div
        ref={cardRef}
        className="flex h-[1200px] w-[1200px] flex-col justify-between overflow-hidden bg-background p-16 text-foreground"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        <div>
          <div className="flex items-start justify-between gap-8 border-b border-border pb-8">
            <div>
              <div className="text-sm uppercase tracking-[0.28em] text-muted-foreground">
                CEA Power Dashboard
              </div>
              <h1 className="mt-5 font-display text-7xl leading-none">Trader Report</h1>
              <p className="mt-4 max-w-3xl text-2xl leading-snug text-muted-foreground">
                Serbia day-ahead prices, regional spreads, RES capture and BESS market signals.
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card px-6 py-4 text-right">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">
                Europe/Belgrade
              </div>
              <div className="mt-1 font-display text-3xl">
                {report.period.from} {"->"} {report.period.to}
              </div>
            </div>
          </div>

          <div className="mt-10 grid grid-cols-4 gap-5">
            <LinkedInMetric label="RS baseload" value={fmt(rs?.baseload)} unit="EUR/MWh" />
            <LinkedInMetric label="RS peakload" value={fmt(rs?.peakload)} unit="EUR/MWh" />
            <LinkedInMetric label="Negative hours" value={String(rs?.negativeHours ?? "N/A")} />
            <LinkedInMetric label="RS vs HU" value={rsVsHu} />
            <LinkedInMetric
              label="Solar capture"
              value={fmt(capture?.solarCapture)}
              unit="EUR/MWh"
            />
            <LinkedInMetric label="Wind capture" value={fmt(capture?.windCapture)} unit="EUR/MWh" />
            <LinkedInMetric label="BESS 2h net" value={fmt(capture?.bessNet2h)} unit="EUR/MWh" />
            <LinkedInMetric label="BESS 4h net" value={fmt(capture?.bessNet4h)} unit="EUR/MWh" />
          </div>

          <div className="mt-10 grid grid-cols-[1.1fr_0.9fr] gap-8">
            <div className="rounded-3xl border border-border bg-card p-7">
              <div className="text-sm uppercase tracking-widest text-muted-foreground">
                Desk Summary
              </div>
              <div className="mt-5 space-y-4 text-2xl leading-snug">
                {(report.deskSummary.length
                  ? report.deskSummary
                  : ["No complete observations available."]
                )
                  .slice(0, 5)
                  .map((line) => (
                    <div key={line} className="flex gap-3">
                      <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />
                      <span>{line}</span>
                    </div>
                  ))}
              </div>
            </div>

            <div className="rounded-3xl border border-border bg-card p-7">
              <div className="text-sm uppercase tracking-widest text-muted-foreground">
                Regional Baseload
              </div>
              <div className="mt-5 space-y-3">
                {topRows.map((row) => (
                  <div
                    key={row.zone}
                    className="grid grid-cols-[56px_1fr_140px] items-center gap-3"
                  >
                    <div className="font-display text-3xl">{row.zone}</div>
                    <div className="h-3 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{
                          width: `${Math.max(8, Math.min(100, ((row.baseload ?? 0) / 180) * 100))}%`,
                        }}
                      />
                    </div>
                    <div className="text-right text-2xl tabular-nums">{fmt(row.baseload)}</div>
                  </div>
                ))}
              </div>
              <div className="mt-7 rounded-2xl border border-border/70 bg-muted/30 p-5">
                <div className="text-xs uppercase tracking-widest text-muted-foreground">
                  Largest RS spread
                </div>
                <div className="mt-1 font-display text-4xl">
                  {bestSpread?.spreadVsRs != null ? fmt(bestSpread.spreadVsRs) : "N/A"}
                  <span className="ml-2 text-xl text-muted-foreground">
                    {bestSpread ? `vs ${bestSpread.zone}` : "EUR/MWh"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-7 text-lg text-muted-foreground">
          <span>Source: ENTSO-E / CEA calculations. No demo data substituted.</span>
          <span>ceadash.lovable.app</span>
        </div>
      </div>
    </div>
  );
}

function LinkedInMetric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-3 flex items-baseline gap-2">
        <div className="font-display text-4xl">{value}</div>
        {unit ? <div className="text-sm text-muted-foreground">{unit}</div> : null}
      </div>
    </div>
  );
}
