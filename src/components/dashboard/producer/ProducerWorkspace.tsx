import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BatteryCharging,
  Database,
  Download,
  Info,
  Leaf,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartCard, DataUnavailableState, PageLoadingSkeleton } from "@/components/dashboard/atoms";
import {
  DateRangeControl,
  useDashboardRange,
  useRequestedRangeKeys,
} from "@/components/dashboard/DateRangeControl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { belgradeDayKey } from "@/lib/baseload";
import { fetchCaptureSeries, type CapturePoint } from "@/lib/capture.functions";
import { downloadCSV, fmtNum } from "@/lib/format";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { MonthlyCaptureTable } from "./MonthlyCaptureTable";
import { ProducerKpiStrip } from "./ProducerKpiStrip";
import {
  buildProducerInsights,
  captureMetricsByMonth,
  computeProducerMetrics,
  hourlyProfile,
  producerSignal,
  type CapturePeriodMetrics,
} from "./producer-analytics";

type Technology = "solar" | "wind" | "both";
type AnalysisMode = "market" | "capture" | "negative" | "battery";

const chartColours = {
  market: "#2563eb",
  solar: "#d97706",
  wind: "#0f766e",
  negative: "#dc2626",
  battery: "#7c3aed",
  neutral: "#64748b",
};

function finite(value: number | null | undefined) {
  return value != null && Number.isFinite(value);
}

function percentage(value: number | null | undefined) {
  return finite(value) ? `${fmtNum(value! * 100, 1)}%` : "N/A";
}

function price(value: number | null | undefined) {
  return finite(value) ? fmtNum(value, 1) : "N/A";
}

function dailyMetrics(points: CapturePoint[]) {
  const groups = new Map<string, CapturePoint[]>();
  for (const point of points) {
    const key = belgradeDayKey(new Date(point.ts));
    const group = groups.get(key) ?? [];
    group.push(point);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, dayPoints]) => {
      const metrics = computeProducerMetrics(dayPoints);
      return {
        day: day.slice(5),
        fullDay: day,
        baseload: metrics.baseloadEurPerMWh,
        solarCapture: metrics.solarCaptureEurPerMWh,
        windCapture: metrics.windCaptureEurPerMWh,
        solarRate: finite(metrics.solarCaptureRate) ? metrics.solarCaptureRate! * 100 : null,
        windRate: finite(metrics.windCaptureRate) ? metrics.windCaptureRate! * 100 : null,
        solarNegative: finite(metrics.solarNegativeExposure)
          ? metrics.solarNegativeExposure! * 100
          : null,
        windNegative: finite(metrics.windNegativeExposure)
          ? metrics.windNegativeExposure! * 100
          : null,
        bess2Net: metrics.bess.avgNet2,
      };
    });
}

function ProducerHeader({ solarModelled }: { solarModelled: boolean }) {
  const { t } = useLang();
  return (
    <header className="flex flex-col justify-between gap-4 border-b border-border/70 pb-5 lg:flex-row lg:items-end">
      <div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
          <span>Serbia · Day-Ahead · ENTSO-E</span>
          {solarModelled ? (
            <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700">
              {t("Modelled solar", "Modelovano sunce")}
            </Badge>
          ) : null}
        </div>
        <h2 className="mt-2 text-2xl font-semibold">
          {t("RES Producer Performance", "Performanse OIE proizvodjaca")}
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          {t(
            "Capture prices, negative-price exposure, generation profiles and battery co-location signals for Serbia.",
            "Capture cene, izlozenost negativnim cenama, profili proizvodnje i signali za baterijsko skladistenje u Srbiji.",
          )}
        </p>
      </div>
    </header>
  );
}

function CompactSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="grid min-w-[170px] gap-1 text-[11px] font-medium uppercase text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-md border border-border/70 bg-background px-3 text-sm normal-case text-foreground"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function MethodologySheet({ solarModelled }: { solarModelled: boolean }) {
  const { t } = useLang();
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="gap-2">
          <Info className="h-4 w-4" />
          {t("Methodology", "Metodologija")}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{t("Producer methodology", "Metodologija proizvodjaca")}</SheetTitle>
          <SheetDescription>
            {t(
              "Formulas and interpretation for the selected Serbia day-ahead period.",
              "Formule i tumacenje za izabrani period dan-unapred trzista Srbije.",
            )}
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-5 text-sm">
          <Method
            title={t("Capture price", "Capture cena")}
            formula="sum(generation x price) / sum(generation)"
            detail={t(
              "Generation-weighted day-ahead price. Missing technologies remain unavailable.",
              "Dan-unapred cena ponderisana proizvodnjom. Nedostupne tehnologije ostaju N/A.",
            )}
          />
          <Method
            title={t("Capture rate", "Capture stopa")}
            formula="capture price / baseload x 100"
            detail={t(
              "Compares realised profile value with the hourly Serbia baseload average.",
              "Poredi vrednost profila sa prosecnom baznom cenom Srbije.",
            )}
          />
          <Method
            title={t("Negative-price exposure", "Izlozenost negativnim cenama")}
            formula="generation in negative-price intervals / total generation"
            detail={t(
              "Shows the share of the available generation profile exposed to negative prices.",
              "Prikazuje udeo dostupnog profila proizvodnje izlozen negativnim cenama.",
            )}
          />
          <Method
            title={t("BESS signal", "BESS signal")}
            formula="mean(highest N prices) x 85% - mean(lowest N prices)"
            detail={t(
              "Indicative perfect-foresight day-ahead spread, not guaranteed battery revenue.",
              "Indikativni dan-unapred raspon uz savrseno predvidjanje, nije garantovan prihod baterije.",
            )}
          />
          {solarModelled ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 p-4 text-amber-900 dark:text-amber-200">
              {t(
                "Solar capture uses a modelled clear-sky profile because measured Serbia B16 generation was unavailable. The profile is a weighting shape, not measured MWh.",
                "Solar capture koristi modelovani profil vedrog neba jer merena B16 solarna proizvodnja za Srbiju nije bila dostupna. Profil je oblik pondera, a ne merena MWh.",
              )}
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Method({ title, formula, detail }: { title: string; formula: string; detail: string }) {
  return (
    <section>
      <h3 className="font-semibold">{title}</h3>
      <code className="mt-2 block rounded-md bg-muted px-3 py-2 text-xs">{formula}</code>
      <p className="mt-2 text-muted-foreground">{detail}</p>
    </section>
  );
}

type Diagnostic = {
  ok?: boolean;
  reason?: string;
  apiMessage?: string;
  httpStatus?: number;
  psrType?: string;
  parsedPoints?: number;
  matchedHours?: number;
  firstTimestamp?: string | null;
  lastTimestamp?: string | null;
};

function DataQualitySheet({
  source,
  solarSource,
  coveragePct,
  priceHours,
  solarHours,
  windHours,
  from,
  to,
  firstTimestamp,
  lastTimestamp,
  diagnostics,
}: {
  source: string;
  solarSource: string;
  coveragePct: number;
  priceHours: number;
  solarHours: number;
  windHours: number;
  from: string;
  to: string;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  diagnostics: {
    solar?: Diagnostic;
    windOnshore?: Diagnostic;
    windOffshore?: Diagnostic;
  } | null;
}) {
  const { t } = useLang();
  const rows = [
    [t("Market source", "Izvor trzista"), source],
    [t("Generation source", "Izvor proizvodnje"), "ENTSO-E A75"],
    [t("Selected range", "Izabrani period"), `${from} to ${to}`],
    [t("Price intervals", "Cenovni intervali"), String(priceHours)],
    [t("Solar intervals", "Solarni intervali"), String(solarHours)],
    [t("Wind intervals", "Intervali vetra"), String(windHours)],
    [t("Matched coverage", "Uparena pokrivenost"), `${fmtNum(coveragePct, 1)}%`],
    [t("Solar status", "Status sunca"), solarSource],
    [t("First timestamp", "Prvi timestamp"), firstTimestamp ?? "N/A"],
    [t("Last timestamp", "Poslednji timestamp"), lastTimestamp ?? "N/A"],
  ];
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="gap-2">
          <Database className="h-4 w-4" />
          {t("View diagnostics", "Dijagnostika")}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{t("Producer data quality", "Kvalitet producer podataka")}</SheetTitle>
          <SheetDescription>
            {t(
              "Coverage, source classification and ENTSO-E response diagnostics.",
              "Pokrivenost, klasifikacija izvora i ENTSO-E dijagnostika odgovora.",
            )}
          </SheetDescription>
        </SheetHeader>
        <dl className="mt-6 divide-y divide-border/70 rounded-lg border border-border/70 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-[150px_1fr] gap-3 px-4 py-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-all font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-6 space-y-3">
          {[
            ["B16 Solar", diagnostics?.solar],
            ["B19 Onshore wind", diagnostics?.windOnshore],
            ["B18 Offshore wind", diagnostics?.windOffshore],
          ].map(([label, diagnostic]) => {
            const item = diagnostic as Diagnostic | undefined;
            return (
              <section key={label as string} className="rounded-lg border border-border/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold">{label as string}</h3>
                  <Badge variant={item?.ok ? "default" : "outline"}>
                    {item?.ok ? "OK" : (item?.reason ?? "Unavailable")}
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <span>HTTP: {item?.httpStatus ?? "N/A"}</span>
                  <span>Parsed: {item?.parsedPoints ?? 0}</span>
                  <span>Matched: {item?.matchedHours ?? 0}</span>
                  <span>PSR: {item?.psrType ?? "N/A"}</span>
                </div>
                {item?.apiMessage ? (
                  <p className="mt-3 break-words text-xs text-muted-foreground">
                    {item.apiMessage}
                  </p>
                ) : null}
              </section>
            );
          })}
        </div>
        <pre className="mt-6 overflow-x-auto rounded-lg bg-muted p-4 text-[11px]">
          {JSON.stringify(diagnostics, null, 2)}
        </pre>
      </SheetContent>
    </Sheet>
  );
}

function ProducerControlBar({
  technology,
  setTechnology,
  analysisMode,
  setAnalysisMode,
  solarModelled,
  coveragePct,
  firstAvailable,
  latestAvailable,
  refreshing,
  onRefresh,
  onExport,
  dataQuality,
}: {
  technology: Technology;
  setTechnology: (value: Technology) => void;
  analysisMode: AnalysisMode;
  setAnalysisMode: (value: AnalysisMode) => void;
  solarModelled: boolean;
  coveragePct: number;
  firstAvailable?: Date;
  latestAvailable?: Date;
  refreshing: boolean;
  onRefresh: () => void;
  onExport: () => void;
  dataQuality: React.ReactNode;
}) {
  const { t } = useLang();
  return (
    <section className="space-y-3">
      <DateRangeControl firstAvailable={firstAvailable} latestAvailable={latestAvailable} />
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border/70 bg-card p-3 shadow-sm">
        <CompactSelect
          label={t("Technology", "Tehnologija")}
          value={technology}
          onChange={(value) => setTechnology(value as Technology)}
          options={[
            { value: "solar", label: t("Solar", "Sunce") },
            { value: "wind", label: t("Wind", "Vetar") },
            { value: "both", label: t("Solar & Wind", "Sunce i vetar") },
          ]}
        />
        <CompactSelect
          label={t("Analysis mode", "Rezim analize")}
          value={analysisMode}
          onChange={(value) => setAnalysisMode(value as AnalysisMode)}
          options={[
            { value: "market", label: t("Market", "Trziste") },
            { value: "capture", label: "Capture" },
            { value: "negative", label: t("Negative Prices", "Negativne cene") },
            { value: "battery", label: t("Battery Signal", "Baterijski signal") },
          ]}
        />
        <div className="flex min-h-9 items-center gap-2 rounded-md border border-border/70 bg-background px-3 text-xs">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              coveragePct >= 90 ? "bg-positive" : coveragePct >= 60 ? "bg-warning" : "bg-critical",
            )}
          />
          <span>
            {coveragePct >= 90 ? t("Good", "Dobro") : t("Partial", "Delimicno")} ·{" "}
            {fmtNum(coveragePct, 0)}%
          </span>
          {solarModelled ? <Badge variant="outline">{t("Modelled", "Modelovano")}</Badge> : null}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {dataQuality}
          <Button type="button" size="sm" variant="outline" className="gap-2" onClick={onExport}>
            <Download className="h-4 w-4" />
            {t("Export", "Izvoz")}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            title={t("Refresh live data", "Osvezi podatke")}
            disabled={refreshing}
            onClick={onRefresh}
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </Button>
        </div>
      </div>
    </section>
  );
}

function ProducerIntelligence({
  metrics,
  coveragePct,
  solarModelled,
  source,
  latestTimestamp,
  dataQuality,
}: {
  metrics: CapturePeriodMetrics;
  coveragePct: number;
  solarModelled: boolean;
  source: string;
  latestTimestamp: string | null;
  dataQuality: React.ReactNode;
}) {
  const { t } = useLang();
  const signal = producerSignal(metrics);
  const insights = buildProducerInsights(metrics);
  const risks = [
    metrics.solarCaptureRate != null && metrics.solarCaptureRate < 0.8
      ? t("High solar capture discount", "Visok solarni capture diskont")
      : null,
    metrics.windCaptureRate != null && metrics.windCaptureRate < 0.8
      ? t("High wind capture discount", "Visok capture diskont vetra")
      : null,
    Math.max(metrics.solarNegativeExposure ?? 0, metrics.windNegativeExposure ?? 0) > 0.05
      ? t("Material negative-price exposure", "Znacajna izlozenost negativnim cenama")
      : null,
    coveragePct < 90
      ? t("Incomplete generation coverage", "Nepotpuna pokrivenost proizvodnje")
      : null,
    solarModelled ? t("Solar is modelled, not measured", "Sunce je modelovano, nije mereno") : null,
  ].filter((risk): risk is string => risk != null);
  const tone =
    signal.tone === "positive"
      ? "border-positive/30 bg-positive/8"
      : signal.tone === "critical"
        ? "border-critical/30 bg-critical/8"
        : signal.tone === "warning"
          ? "border-warning/30 bg-warning/8"
          : "border-border/70 bg-card";

  return (
    <aside className="space-y-4">
      <section className={cn("rounded-lg border p-4", tone)}>
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase text-muted-foreground">
          <Sparkles className="h-4 w-4" />
          {t("Current producer signal", "Trenutni producer signal")}
        </div>
        <h3 className="mt-3 text-lg font-semibold">{signal.label}</h3>
        <p className="mt-2 text-sm leading-5 text-muted-foreground">{signal.detail}</p>
      </section>
      <section className="rounded-lg border border-border/70 bg-card p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Leaf className="h-4 w-4 text-positive" />
          {t("Key insights", "Kljucni uvidi")}
        </h3>
        <ul className="mt-3 space-y-3 text-sm text-muted-foreground">
          {(insights.length
            ? insights
            : [t("No reliable insight available.", "Nema pouzdanog uvida.")]
          ).map((insight) => (
            <li key={insight} className="border-l-2 border-positive/50 pl-3">
              {insight}
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-lg border border-border/70 bg-card p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle className="h-4 w-4 text-warning" />
          {t("Key risks", "Kljucni rizici")}
        </h3>
        <ul className="mt-3 space-y-3 text-sm text-muted-foreground">
          {(risks.length
            ? risks.slice(0, 4)
            : [t("No material flags in the selected period.", "Nema znacajnih upozorenja.")]
          ).map((risk) => (
            <li key={risk} className="border-l-2 border-warning/60 pl-3">
              {risk}
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-lg border border-border/70 bg-card p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-blue-600" />
          {t("Data quality", "Kvalitet podataka")}
        </h3>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt className="text-muted-foreground">{t("Source", "Izvor")}</dt>
            <dd className="mt-1 font-medium">{source}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("Coverage", "Pokrivenost")}</dt>
            <dd className="mt-1 font-medium">{fmtNum(coveragePct, 1)}%</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("Solar", "Sunce")}</dt>
            <dd className="mt-1 font-medium">{solarModelled ? "Modelled" : "Measured"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("Latest", "Poslednje")}</dt>
            <dd className="mt-1 font-medium">
              {latestTimestamp ? new Date(latestTimestamp).toLocaleDateString("en-GB") : "N/A"}
            </dd>
          </div>
        </dl>
        <div className="mt-4">{dataQuality}</div>
      </section>
    </aside>
  );
}

function CapturePriceChart({
  rows,
  technology,
}: {
  rows: ReturnType<typeof dailyMetrics>;
  technology: Technology;
}) {
  const { t } = useLang();
  return (
    <ChartCard
      title={t("Capture price versus baseload", "Capture cena prema baznoj ceni")}
      description={t(
        "Daily generation-weighted prices with missing data left as gaps.",
        "Dnevne cene ponderisane proizvodnjom; nedostajuci podaci ostaju praznine.",
      )}
    >
      <div className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
            <XAxis dataKey="day" minTickGap={24} tick={{ fontSize: 11 }} />
            <YAxis
              tick={{ fontSize: 11 }}
              width={48}
              label={{ value: "EUR/MWh", angle: -90, position: "insideLeft", fontSize: 11 }}
            />
            <RechartsTooltip
              labelFormatter={(_, payload) => payload?.[0]?.payload?.fullDay ?? ""}
              formatter={(value: number, name: string) => [`${fmtNum(value, 1)} EUR/MWh`, name]}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="baseload"
              name="Serbia baseload"
              stroke={chartColours.market}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
            {technology !== "wind" ? (
              <Line
                type="monotone"
                dataKey="solarCapture"
                name="Solar capture"
                stroke={chartColours.solar}
                strokeWidth={2}
                dot={false}
                connectNulls={false}
              />
            ) : null}
            {technology !== "solar" ? (
              <Line
                type="monotone"
                dataKey="windCapture"
                name="Wind capture"
                stroke={chartColours.wind}
                strokeWidth={2}
                dot={false}
                connectNulls={false}
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function CaptureRateChart({
  rows,
  technology,
}: {
  rows: ReturnType<typeof dailyMetrics>;
  technology: Technology;
}) {
  const { t } = useLang();
  return (
    <ChartCard
      title={t("Capture rate and negative-price exposure", "Capture stopa i negativna izlozenost")}
      description={t(
        "Capture rate uses the left axis; negative-price generation share uses the right axis.",
        "Capture stopa koristi levu osu, a udeo proizvodnje pri negativnim cenama desnu.",
      )}
    >
      <div className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
            <XAxis dataKey="day" minTickGap={24} tick={{ fontSize: 11 }} />
            <YAxis
              yAxisId="rate"
              tick={{ fontSize: 11 }}
              width={44}
              unit="%"
              domain={[0, "auto"]}
            />
            <YAxis
              yAxisId="negative"
              orientation="right"
              tick={{ fontSize: 11 }}
              width={44}
              unit="%"
              domain={[0, "auto"]}
            />
            <RechartsTooltip formatter={(value: number) => `${fmtNum(value, 1)}%`} />
            <Legend />
            <ReferenceLine
              yAxisId="rate"
              y={100}
              stroke={chartColours.neutral}
              strokeDasharray="4 4"
            />
            {technology !== "wind" ? (
              <>
                <Line
                  yAxisId="rate"
                  type="monotone"
                  dataKey="solarRate"
                  name="Solar capture rate"
                  stroke={chartColours.solar}
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                />
                <Area
                  yAxisId="negative"
                  type="monotone"
                  dataKey="solarNegative"
                  name="Solar negative exposure"
                  stroke={chartColours.negative}
                  fill={chartColours.negative}
                  fillOpacity={0.08}
                  connectNulls={false}
                />
              </>
            ) : null}
            {technology !== "solar" ? (
              <Line
                yAxisId="rate"
                type="monotone"
                dataKey="windRate"
                name="Wind capture rate"
                stroke={chartColours.wind}
                strokeWidth={2}
                dot={false}
                connectNulls={false}
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function MonthlyCaptureChart({
  rows,
  technology,
}: {
  rows: ReturnType<typeof captureMetricsByMonth>;
  technology: Technology;
}) {
  const data = rows.map((row) => ({
    month: row.month,
    baseload: row.baseloadEurPerMWh,
    solar: row.solarCaptureEurPerMWh,
    wind: row.windCaptureEurPerMWh,
  }));
  return (
    <ChartCard title="Monthly capture price" description="EUR/MWh · one market reference scale">
      <div className="h-[270px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={45} />
            <RechartsTooltip formatter={(value: number) => `${fmtNum(value, 1)} EUR/MWh`} />
            <Legend />
            <Bar
              dataKey="baseload"
              name="Baseload"
              fill={chartColours.market}
              radius={[3, 3, 0, 0]}
            />
            {technology !== "wind" ? (
              <Line
                dataKey="solar"
                name="Solar capture"
                stroke={chartColours.solar}
                strokeWidth={2}
              />
            ) : null}
            {technology !== "solar" ? (
              <Line dataKey="wind" name="Wind capture" stroke={chartColours.wind} strokeWidth={2} />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function HourlyProfileChart({
  rows,
  defaultTechnology,
}: {
  rows: ReturnType<typeof hourlyProfile>;
  defaultTechnology: Technology;
}) {
  return (
    <ChartCard
      title="Average hourly profile"
      description="Europe/Belgrade local hour · generation profile and day-ahead price use separate axes"
    >
      <Tabs defaultValue={defaultTechnology === "wind" ? "wind" : "solar"}>
        <TabsList>
          <TabsTrigger value="solar">Solar vs Price</TabsTrigger>
          <TabsTrigger value="wind">Wind vs Price</TabsTrigger>
        </TabsList>
        {(["solar", "wind"] as const).map((technology) => (
          <TabsContent key={technology} value={technology}>
            <div className="h-[255px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                  <XAxis dataKey="label" interval={2} tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="profile" tick={{ fontSize: 11 }} width={42} />
                  <YAxis yAxisId="price" orientation="right" tick={{ fontSize: 11 }} width={48} />
                  <RechartsTooltip />
                  <Legend />
                  <Area
                    yAxisId="profile"
                    type="monotone"
                    dataKey={technology === "solar" ? "solar" : "windMW"}
                    name={technology === "solar" ? "Solar profile" : "Wind MW"}
                    stroke={technology === "solar" ? chartColours.solar : chartColours.wind}
                    fill={technology === "solar" ? chartColours.solar : chartColours.wind}
                    fillOpacity={0.14}
                  />
                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="priceEurPerMWh"
                    name="Price EUR/MWh"
                    stroke={chartColours.market}
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </ChartCard>
  );
}

function BessOpportunityPanel({ metrics }: { metrics: CapturePeriodMetrics }) {
  return (
    <ChartCard
      title="Battery co-location signal"
      description="Indicative day-ahead arbitrage signal · 85% round-trip efficiency"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <BessMetric label="Best typical charging price · 2h" value={metrics.bess.avgCharge2} />
        <BessMetric label="Best typical discharge price · 2h" value={metrics.bess.avgDischarge2} />
        <BessMetric label="2h gross spread" value={metrics.bess.avgGross2} />
        <BessMetric label="2h net spread" value={metrics.bess.avgNet2} emphasis />
        <BessMetric label="4h gross spread" value={metrics.bess.avgGross4} />
        <BessMetric label="4h net spread" value={metrics.bess.avgNet4} emphasis />
      </div>
      <div className="mt-4 flex items-center gap-2 border-t border-border/70 pt-3 text-xs text-muted-foreground">
        <BatteryCharging className="h-4 w-4 text-violet-600" />
        {metrics.bess.days} complete pricing days included. This is not guaranteed project revenue.
      </div>
    </ChartCard>
  );
}

function BessMetric({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: number | null;
  emphasis?: boolean;
}) {
  return (
    <div className={cn("rounded-md border border-border/60 p-3", emphasis && "bg-violet-500/8")}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">
        {price(value)} <span className="text-xs font-normal text-muted-foreground">EUR/MWh</span>
      </div>
    </div>
  );
}

export function ProducerWorkspace() {
  const { t } = useLang();
  const requestedRange = useRequestedRangeKeys();
  const [technology, setTechnology] = useState<Technology>("both");
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("capture");
  const live = useQuery({
    queryKey: [
      "capture-series",
      requestedRange.fromKey,
      requestedRange.toKey,
      requestedRange.preset,
    ],
    queryFn: () =>
      fetchCaptureSeries({
        data: { from: requestedRange.fromKey, to: requestedRange.toKey },
      }),
    staleTime: 5 * 60_000,
  });

  const data = live.data;
  const points = useMemo(() => data?.points ?? [], [data]);
  const solarSource =
    data && "solarSource" in data ? (data.solarSource as "entsoe" | "modelled" | "none") : "none";
  const solarModelled = solarSource === "modelled";
  const firstTimestamp =
    data && "firstPriceTs" in data ? (data.firstPriceTs as string | null) : (points[0]?.ts ?? null);
  const lastTimestamp =
    data && "lastPriceTs" in data
      ? (data.lastPriceTs as string | null)
      : (points[points.length - 1]?.ts ?? null);
  const diagnostics =
    data && "diagnostics" in data
      ? (data.diagnostics as {
          solar?: Diagnostic;
          windOnshore?: Diagnostic;
          windOffshore?: Diagnostic;
        })
      : null;
  const { fromKey, toKey } = useDashboardRange({
    firstAvailable: firstTimestamp ? new Date(firstTimestamp) : undefined,
    latestAvailable: lastTimestamp ? new Date(lastTimestamp) : undefined,
  });
  const selectedPoints = useMemo(
    () =>
      points.filter((point) => {
        const day = belgradeDayKey(new Date(point.ts));
        return (!fromKey || day >= fromKey) && (!toKey || day <= toKey);
      }),
    [points, fromKey, toKey],
  );
  const metrics = useMemo(() => computeProducerMetrics(selectedPoints), [selectedPoints]);
  const monthly = useMemo(
    () => captureMetricsByMonth(selectedPoints, solarSource),
    [selectedPoints, solarSource],
  );
  const daily = useMemo(() => dailyMetrics(selectedPoints), [selectedPoints]);
  const profile = useMemo(() => hourlyProfile(selectedPoints), [selectedPoints]);
  const matchedHours =
    data && "matchedHours" in data
      ? Number(data.matchedHours)
      : selectedPoints.filter((point) => point.solar > 0 || point.wind > 0).length;
  const totalHours = data && "totalHours" in data ? Number(data.totalHours) : selectedPoints.length;
  const coveragePct = totalHours > 0 ? Math.min(100, (matchedHours / totalHours) * 100) : 0;
  const source = data?.source ?? "none";
  const dataQuality = (
    <DataQualitySheet
      source={source}
      solarSource={solarSource}
      coveragePct={coveragePct}
      priceHours={metrics.priceHours}
      solarHours={metrics.solarHours}
      windHours={metrics.windHours}
      from={requestedRange.fromKey}
      to={requestedRange.toKey}
      firstTimestamp={firstTimestamp}
      lastTimestamp={lastTimestamp}
      diagnostics={diagnostics}
    />
  );
  const exportRows = selectedPoints.map((point) => ({
    timestamp_utc: point.ts,
    day_ahead_price_eur_per_mwh: point.price,
    solar_profile_value: point.solar,
    solar_profile_source: solarSource,
    wind_generation_mw: point.wind,
  }));

  if (live.isLoading) return <PageLoadingSkeleton />;
  if (live.isError || !points.length) {
    return (
      <DataUnavailableState
        title={t("Producer data unavailable", "Producer podaci nisu dostupni")}
        description={t(
          "Serbia day-ahead prices or generation profiles could not be loaded for the selected period.",
          "Dan-unapred cene Srbije ili profili proizvodnje nisu ucitani za izabrani period.",
        )}
        onRetry={() => void live.refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <ProducerHeader solarModelled={solarModelled} />
      <ProducerControlBar
        technology={technology}
        setTechnology={setTechnology}
        analysisMode={analysisMode}
        setAnalysisMode={setAnalysisMode}
        solarModelled={solarModelled}
        coveragePct={coveragePct}
        firstAvailable={firstTimestamp ? new Date(firstTimestamp) : undefined}
        latestAvailable={lastTimestamp ? new Date(lastTimestamp) : undefined}
        refreshing={live.isFetching}
        onRefresh={() => void live.refetch()}
        onExport={() => downloadCSV("serbia-producer-hourly.csv", exportRows)}
        dataQuality={dataQuality}
      />

      {coveragePct < 90 || solarModelled ? (
        <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/8 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div>
            <span className="font-medium">
              {coveragePct < 60
                ? t("Limited generation coverage.", "Ogranicena pokrivenost proizvodnje.")
                : t("Data-quality notice.", "Napomena o kvalitetu podataka.")}
            </span>{" "}
            <span className="text-muted-foreground">
              {solarModelled
                ? t(
                    "Solar capture is based on a modelled clear-sky weighting profile; measured wind remains separately classified.",
                    "Solar capture je zasnovan na modelovanom profilu vedrog neba; mereni vetar je posebno klasifikovan.",
                  )
                : t(
                    "Some generation intervals are not matched to market prices; affected metrics remain incomplete.",
                    "Neki intervali proizvodnje nisu upareni sa cenama; povezane metrike su nepotpune.",
                  )}
            </span>
          </div>
        </div>
      ) : null}

      <ProducerKpiStrip metrics={metrics} technology={technology} solarModelled={solarModelled} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <main className="min-w-0 space-y-5">
          {analysisMode === "battery" ? (
            <BessOpportunityPanel metrics={metrics} />
          ) : analysisMode === "negative" ? (
            <CaptureRateChart rows={daily} technology={technology} />
          ) : (
            <CapturePriceChart rows={daily} technology={technology} />
          )}
          {analysisMode !== "negative" ? (
            <CaptureRateChart rows={daily} technology={technology} />
          ) : (
            <CapturePriceChart rows={daily} technology={technology} />
          )}
        </main>
        <ProducerIntelligence
          metrics={metrics}
          coveragePct={coveragePct}
          solarModelled={solarModelled}
          source={source}
          latestTimestamp={lastTimestamp}
          dataQuality={dataQuality}
        />
      </div>

      <section className="grid gap-5 lg:grid-cols-2">
        <MonthlyCaptureChart rows={monthly} technology={technology} />
        <HourlyProfileChart rows={profile} defaultTechnology={technology} />
        <BessOpportunityPanel metrics={metrics} />
        <ChartCard
          title={t("Period snapshot", "Pregled perioda")}
          description={t(
            "Commercial metrics remain separated from profile-source diagnostics.",
            "Komercijalne metrike ostaju odvojene od dijagnostike izvora profila.",
          )}
          right={<MethodologySheet solarModelled={solarModelled} />}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Snapshot label="Solar capture rate" value={percentage(metrics.solarCaptureRate)} />
            <Snapshot label="Wind capture rate" value={percentage(metrics.windCaptureRate)} />
            <Snapshot
              label="Solar negative exposure"
              value={percentage(metrics.solarNegativeExposure)}
            />
            <Snapshot
              label="Wind negative exposure"
              value={percentage(metrics.windNegativeExposure)}
            />
            <Snapshot label="Price intervals" value={String(metrics.priceHours)} />
            <Snapshot label="Matched coverage" value={`${fmtNum(coveragePct, 1)}%`} />
          </div>
        </ChartCard>
      </section>

      <MonthlyCaptureTable rows={monthly} />
    </div>
  );
}

function Snapshot({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
