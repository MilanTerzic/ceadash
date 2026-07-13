import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState, type RefObject } from "react";
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

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function heatScaleDomain(rows: CeaTraderReport["prices"]["serbiaHeatmap"]) {
  const values = rows.flatMap((row) =>
    Object.values(row.hours).filter((value): value is number => finiteNumber(value) && value >= 0),
  );
  return {
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 1,
  };
}

function heatCellFill(value: number | undefined, domain: { min: number; max: number }) {
  if (value == null || !Number.isFinite(value)) return "#e6e3d6";
  if (value < 0) return "#ef4444";
  const ratio =
    domain.max > domain.min ? clamp((value - domain.min) / (domain.max - domain.min), 0, 1) : 0;
  const saturation = 34 + ratio * 18;
  const lightness = 88 - ratio * 48;
  return `hsl(145 ${saturation.toFixed(0)}% ${lightness.toFixed(0)}%)`;
}

function sparklinePath(values: number[], width: number, height: number, padding = 16) {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  return values
    .map((value, index) => {
      const x = padding + (index / (values.length - 1)) * (width - padding * 2);
      const y = height - padding - ((value - min) / spread) * (height - padding * 2);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
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

  const rsDailyBaseload = report.prices.dailyBaseload.filter(
    (row) => typeof row.RS === "number" && Number.isFinite(row.RS),
  );
  const heatDomain = heatScaleDomain(report.prices.serbiaHeatmap);

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
        title={t("Serbia Daily Baseload Price", "Dnevna baseload cena Srbije")}
        description={t(
          "Arithmetic average of available Serbian hourly day-ahead prices per local Belgrade delivery day. Other markets remain in the Market Statistics table below.",
          "Aritmeticki prosek dostupnih hourly day-ahead cena Srbije po lokalnom Belgrade delivery day. Ostala trzista su u tabeli Market Statistics ispod.",
        )}
      >
        {rsDailyBaseload.length ? (
          <ResponsiveContainer width="100%" height={360}>
            <LineChart data={rsDailyBaseload}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              />
              <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} unit=" EUR" />
              <RTooltip
                formatter={(value) => [
                  typeof value === "number" ? `${value.toFixed(2)} EUR/MWh` : "N/A",
                  "RS",
                ]}
                labelFormatter={(label) => `Delivery day ${label}`}
              />
              <Line
                type="monotone"
                dataKey="RS"
                name="RS"
                stroke="var(--color-primary)"
                strokeWidth={3}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("No Serbia price data available.", "Nema dostupnih cena za Srbiju.")}
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
                          className="h-6 rounded-sm border border-border/40"
                          style={{ backgroundColor: heatCellFill(value, heatDomain) }}
                          title={`${row.date} ${String(h).padStart(2, "0")}:00 - ${fmt(value)} EUR/MWh`}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="h-3 w-3 rounded-sm bg-red-500/45" /> negative
                </span>
                <span className="inline-flex items-center gap-1">
                  <span
                    className="h-3 w-16 rounded-sm"
                    style={{
                      background: "linear-gradient(90deg, hsl(145 34% 88%), hsl(145 52% 40%))",
                    }}
                  />{" "}
                  non-negative: lowest lightest
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
  const rsVsHuValue =
    rs?.baseload != null && hu?.baseload != null ? fmt(rs.baseload - hu.baseload) : "N/A";
  const rsDailyRows = report.prices.dailyBaseload.filter((row) => finiteNumber(row.RS));

  return (
    <div className="fixed left-[-10000px] top-0 z-[-1] print:hidden" aria-hidden="true">
      <div
        ref={cardRef}
        className="flex h-[1500px] w-[1200px] flex-col justify-between overflow-hidden bg-background p-14 text-foreground"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        <div>
          <div className="flex items-start justify-between gap-8 border-b border-border pb-6">
            <div>
              <div className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                CEA Power Dashboard
              </div>
              <h1 className="mt-4 font-display text-6xl leading-none">Trader Report</h1>
              <p className="mt-3 max-w-3xl text-xl leading-snug text-muted-foreground">
                Serbia day-ahead prices, regional spreads, RES capture and BESS market signals.
              </p>
            </div>
            <div className="w-[330px] shrink-0 rounded-2xl border border-border bg-card px-6 py-4 text-right">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">
                Europe/Belgrade
              </div>
              <div className="mt-2 font-display text-2xl leading-tight">
                <div>{report.period.from}</div>
                <div className="text-base text-muted-foreground">to</div>
                <div>{report.period.to}</div>
              </div>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-4 gap-5">
            <LinkedInMetric label="RS baseload" value={fmt(rs?.baseload)} unit="EUR/MWh" />
            <LinkedInMetric label="RS peakload" value={fmt(rs?.peakload)} unit="EUR/MWh" />
            <LinkedInMetric label="RS volatility" value={fmt(rs?.volatility)} unit="EUR/MWh" />
            <LinkedInMetric
              label="Negative-price hours"
              value={String(rs?.negativeHours ?? "N/A")}
            />
            <LinkedInMetric label="RS min price" value={fmt(rs?.min)} unit="EUR/MWh" />
            <LinkedInMetric label="RS max price" value={fmt(rs?.max)} unit="EUR/MWh" />
            <LinkedInMetric label="RS vs HU" value={rsVsHuValue} unit="EUR/MWh" />
            <LinkedInMetric
              label="Largest RS spread"
              value={bestSpread?.spreadVsRs != null ? fmt(bestSpread.spreadVsRs) : "N/A"}
              unit={bestSpread ? `vs ${bestSpread.zone}` : "EUR/MWh"}
            />
            <LinkedInMetric
              label="Solar capture"
              value={fmt(capture?.solarCapture)}
              unit="EUR/MWh"
            />
            <LinkedInMetric label="Wind capture" value={fmt(capture?.windCapture)} unit="EUR/MWh" />
            <LinkedInMetric label="BESS 2h net" value={fmt(capture?.bessNet2h)} unit="EUR/MWh" />
            <LinkedInMetric label="BESS 4h net" value={fmt(capture?.bessNet4h)} unit="EUR/MWh" />
          </div>

          <div className="mt-9">
            <LinkedInDailyPriceChart rows={rsDailyRows} />
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-6 text-base text-muted-foreground">
          <span>Source: ENTSO-E / CEA calculations. No demo data substituted.</span>
          <span>ceadash.lovable.app</span>
        </div>
      </div>
    </div>
  );
}

function LinkedInDailyPriceChart({
  rows,
}: {
  rows: Array<Record<string, string | number | null>>;
}) {
  const points = rows
    .map((row) => ({
      date: String(row.date ?? ""),
      value: finiteNumber(row.RS) ? row.RS : null,
    }))
    .filter((point): point is { date: string; value: number } => finiteNumber(point.value));
  const values = points.map((point) => point.value);
  const min = values.length ? Math.min(...values) : null;
  const max = values.length ? Math.max(...values) : null;
  const last = points[points.length - 1];
  const path = sparklinePath(values, 610, 270, 28);

  return (
    <div className="rounded-3xl border border-border bg-card p-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm uppercase tracking-widest text-muted-foreground">
            Serbia Daily Baseload
          </div>
          <div className="mt-2 font-display text-4xl">
            {last ? fmt(last.value) : "N/A"}
            <span className="ml-2 text-lg text-muted-foreground">EUR/MWh latest</span>
          </div>
        </div>
        <div className="text-right text-sm text-muted-foreground">
          <div>min {fmt(min)}</div>
          <div>max {fmt(max)}</div>
        </div>
      </div>
      <svg className="mt-6 h-[270px] w-full" viewBox="0 0 610 270" role="img">
        <defs>
          <linearGradient id="linkedin-price-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#0f9f8f" stopOpacity="0.26" />
            <stop offset="100%" stopColor="#0f9f8f" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((line) => (
          <line
            key={line}
            x1="24"
            x2="586"
            y1={34 + line * 62}
            y2={34 + line * 62}
            stroke="#d5d1bf"
            strokeDasharray="6 7"
          />
        ))}
        {path ? (
          <>
            <path d={`${path} L 582 246 L 28 246 Z`} fill="url(#linkedin-price-fill)" />
            <path d={path} fill="none" stroke="#0f9f8f" strokeLinecap="round" strokeWidth="8" />
            {points.map((point, index) => {
              if (!values.length) return null;
              const minValue = Math.min(...values);
              const maxValue = Math.max(...values);
              const spread = maxValue - minValue || 1;
              const x = 28 + (index / Math.max(1, points.length - 1)) * (610 - 56);
              const y = 270 - 28 - ((point.value - minValue) / spread) * (270 - 56);
              return <circle key={point.date} cx={x} cy={y} r="5" fill="#263126" />;
            })}
          </>
        ) : (
          <text x="305" y="145" textAnchor="middle" fill="#646759" fontSize="26">
            No Serbia daily price data
          </text>
        )}
      </svg>
      <div className="mt-2 flex justify-between text-sm text-muted-foreground">
        <span>{points[0]?.date ?? "No data"}</span>
        <span>{last?.date ?? ""}</span>
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
