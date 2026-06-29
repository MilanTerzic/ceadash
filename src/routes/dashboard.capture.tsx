import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { format } from "date-fns";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Legend,
  BarChart,
  Bar,
  ComposedChart,
  Area,
  AreaChart,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { ChartCard, KpiCard } from "@/components/dashboard/atoms";
import { DateRangeControl, useDashboardRange, useRequestedFromKey } from "@/components/dashboard/DateRangeControl";
import { DataStatusBanner } from "@/components/dashboard/DataStatusBanner";
import { useLang } from "@/lib/i18n";
import { belgradeDayKey, bucketByBelgradeDay, type HourlyPrice } from "@/lib/baseload";
import { fetchCaptureSeries, type CapturePoint } from "@/lib/capture.functions";

export const Route = createFileRoute("/dashboard/capture")({
  head: () => ({
    meta: [
      { title: "Capture Prices — CEA Power Dashboard" },
      { name: "description", content: "Solar and wind capture prices, capture rates and negative-price exposure for Serbia." },
      { property: "og:title", content: "Capture Prices — CEA Power Dashboard" },
      { property: "og:description", content: "Solar and wind capture prices, capture rates and negative-price exposure for Serbia." },
      { property: "og:url", content: "https://ceadash.lovable.app/dashboard/capture" },
    ],
    links: [{ rel: "canonical", href: "https://ceadash.lovable.app/dashboard/capture" }],
  }),
  component: CapturePage,
});

type CapturePeriodMetrics = {
  baseload: number | null;
  solarCapture: number | null;
  windCapture: number | null;
  solarRate: number | null;
  windRate: number | null;
  solarNegShare: number | null;
  windNegShare: number | null;
  negHours: number;
  solarHours: number;
  windHours: number;
  priceHours: number;
};

function monthKey(d: Date): string {
  return belgradeDayKey(d).slice(0, 7);
}

function localHour(d: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Belgrade",
      hour: "2-digit",
      hour12: false,
    })
      .formatToParts(d)
      .find((p) => p.type === "hour")?.value ?? d.getUTCHours(),
  );
}

function computeMetrics(points: CapturePoint[]): CapturePeriodMetrics {
  const empty: CapturePeriodMetrics = {
    baseload: null,
    solarCapture: null,
    windCapture: null,
    solarRate: null,
    windRate: null,
    solarNegShare: null,
    windNegShare: null,
    negHours: 0,
    solarHours: 0,
    windHours: 0,
    priceHours: 0,
  };
  if (!points.length) return empty;

  let sumP = 0;
  let priceHours = 0;
  let sumPS = 0;
  let sumS = 0;
  let solarHours = 0;
  let sumSneg = 0;
  let sumPW = 0;
  let sumW = 0;
  let windHours = 0;
  let sumWneg = 0;
  let negHours = 0;

  for (const p of points) {
    if (!Number.isFinite(p.price)) continue;
    sumP += p.price;
    priceHours += 1;
    if (p.price < 0) negHours += 1;
    if (Number.isFinite(p.solar) && p.solar > 0) {
      sumPS += p.price * p.solar;
      sumS += p.solar;
      solarHours += 1;
      if (p.price < 0) sumSneg += p.solar;
    }
    if (Number.isFinite(p.wind) && p.wind > 0) {
      sumPW += p.price * p.wind;
      sumW += p.wind;
      windHours += 1;
      if (p.price < 0) sumWneg += p.wind;
    }
  }

  const baseload = priceHours > 0 ? sumP / priceHours : null;
  const solarCapture = sumS > 0 ? sumPS / sumS : null;
  const windCapture = sumW > 0 ? sumPW / sumW : null;

  return {
    baseload,
    solarCapture,
    windCapture,
    solarRate:
      baseload != null && baseload !== 0 && solarCapture != null ? solarCapture / baseload : null,
    windRate:
      baseload != null && baseload !== 0 && windCapture != null ? windCapture / baseload : null,
    solarNegShare: sumS > 0 ? sumSneg / sumS : null,
    windNegShare: sumW > 0 ? sumWneg / sumW : null,
    negHours,
    solarHours,
    windHours,
    priceHours,
  };
}

function captureMetricsByMonth(points: CapturePoint[]) {
  const map = new Map<string, CapturePoint[]>();
  for (const p of points) {
    const key = monthKey(new Date(p.ts));
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, pts]) => ({
      month,
      ...computeMetrics(pts),
    }));
}

function hourlyProfile(points: CapturePoint[]) {
  const buckets: { p: number[]; s: number[]; w: number[] }[] = Array.from({ length: 24 }, () => ({
    p: [],
    s: [],
    w: [],
  }));
  for (const pt of points) {
    const h = localHour(new Date(pt.ts));
    buckets[h].p.push(pt.price);
    buckets[h].s.push(pt.solar);
    buckets[h].w.push(pt.wind);
  }
  return buckets.map((b, h) => ({
    h,
    price: b.p.length ? +(b.p.reduce((a, x) => a + x, 0) / b.p.length).toFixed(1) : 0,
    solar: b.s.length ? +(b.s.reduce((a, x) => a + x, 0) / b.s.length).toFixed(3) : 0,
    wind: b.w.length ? +(b.w.reduce((a, x) => a + x, 0) / b.w.length).toFixed(3) : 0,
  }));
}

function fmtValue(v: number | null | undefined, digits = 1) {
  return v == null || !Number.isFinite(v) ? "N/A" : v.toFixed(digits);
}

function fmtPct(v: number | null | undefined, digits = 1) {
  return v == null || !Number.isFinite(v) ? "N/A" : `${(v * 100).toFixed(digits)}%`;
}

function fmtDiff(a: number | null | undefined, b: number | null | undefined, digits = 1) {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return "N/A";
  return (a - b).toFixed(digits);
}

function nz(v: number | null | undefined) {
  return v == null || !Number.isFinite(v) ? 0 : v;
}

function CapturePage() {
  const { t } = useLang();
  const requestedFrom = useRequestedFromKey();

  const live = useQuery({
    queryKey: ["capture-series", requestedFrom],
    queryFn: () => fetchCaptureSeries({ data: { from: requestedFrom } }),
    staleTime: 60 * 60_000,
  });

  const rawPoints = live.data?.points ?? [];
  const priceSeries = useMemo<HourlyPrice[]>(
    () => rawPoints.map((p) => ({ ts: new Date(p.ts), price: p.price })),
    [rawPoints],
  );
  const buckets = useMemo(() => bucketByBelgradeDay(priceSeries), [priceSeries]);
  const completeDays = useMemo(() => buckets.filter((b) => b.complete), [buckets]);
  const firstAvailable = completeDays[0]?.date;
  const latestAvailable = completeDays[completeDays.length - 1]?.date;
  const lastTs = priceSeries[priceSeries.length - 1]?.ts;

  const { fromKey, toKey, range } = useDashboardRange({ firstAvailable, latestAvailable });

  const inRange = useMemo(
    () =>
      rawPoints.filter((p) => {
        const key = belgradeDayKey(new Date(p.ts));
        return (!fromKey || key >= fromKey) && (!toKey || key <= toKey);
      }),
    [rawPoints, fromKey, toKey],
  );

  const period = useMemo(() => computeMetrics(inRange), [inRange]);
  const monthly = useMemo(() => captureMetricsByMonth(inRange), [inRange]);
  const hourly = useMemo(() => hourlyProfile(inRange), [inRange]);
  const solarHoursInRange = useMemo(() => inRange.filter((p) => p.solar > 0).length, [inRange]);
  const windHoursInRange = useMemo(() => inRange.filter((p) => p.wind > 0).length, [inRange]);
  const matchedHoursInRange = useMemo(() => inRange.filter((p) => p.solar > 0 || p.wind > 0).length, [inRange]);

  const rangeLabel = range
    ? `${format(range.from, "d MMM yyyy")} – ${format(range.to, "d MMM yyyy")}`
    : "—";

  const coverageRatio = inRange.length ? matchedHoursInRange / inRange.length : 0;
  const lowCoverage = coverageRatio < 0.6;
  const veryLowCoverage = coverageRatio < 0.25;

  const warning =
    live.data && (live.data.totalHours ?? 0) > 0
      ? `${t("Generation coverage", "Pokrivenost proizvodnje")}: ${(coverageRatio * 100).toFixed(0)}% (${matchedHoursInRange}/${inRange.length} ${t("hours matched to price series", "sati uparenih sa cenama")})`
      : undefined;

  const methodologyHint = t(
    "Capture price = Σ(hourly price × hourly generation) ÷ Σ(hourly generation), using Serbia day-ahead prices and ENTSO-E generation by technology.",
    "Capture price = Σ(hourly cena × hourly proizvodnja) ÷ Σ(hourly proizvodnja), koristeći Serbia day-ahead cene i ENTSO-E proizvodnju po tehnologiji.",
  );

  if (live.isLoading) {
    return <p className="text-sm text-muted-foreground">{t("Fetching Serbia capture-price inputs…", "Učitavanje ulaznih podataka za capture price Srbije…")}</p>;
  }

  if (!live.data?.ok || !inRange.length) {
    return (
      <p className="text-sm text-muted-foreground">
        {t(
          "Capture-price inputs are currently unavailable. Please retry shortly.",
          "Ulazni podaci za capture price trenutno nisu dostupni. Pokušajte ponovo uskoro.",
        )}
        {live.data?.reason && <span className="block mt-1 text-critical">{live.data.reason}</span>}
        {live.isError && <span className="block mt-1 text-critical">{String(live.error)}</span>}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <DataStatusBanner
        source={(live.data.source as "entsoe" | "cache" | "none") ?? "none"}
        lastUpdate={lastTs}
        hours={rawPoints.length}
        completeDays={completeDays.length}
        incompleteDays={buckets.length - completeDays.length}
        marketArea="Serbia day-ahead + ENTSO-E RES generation"
        warning={warning}
      />

      <DateRangeControl firstAvailable={firstAvailable} latestAvailable={latestAvailable} />

      <ChartCard
        title={t("Methodology", "Metodologija")}
        description={methodologyHint}
      >
        <div className="grid gap-3 md:grid-cols-3 text-sm">
          <div className="rounded-xl border border-border/60 p-4">
            <div className="text-muted-foreground">{t("Price reference", "Referentna cena")}</div>
            <div className="mt-1 font-medium">{t("Serbia day-ahead hourly market", "Hourly Serbia day-ahead tržište")}</div>
          </div>
          <div className="rounded-xl border border-border/60 p-4">
            <div className="text-muted-foreground">{t("Generation weighting", "Ponderisanje proizvodnjom")}</div>
            <div className="mt-1 font-medium">{t("ENTSO-E solar (B16) and wind (B18+B19)", "ENTSO-E solar (B16) i wind (B18+B19)")}</div>
          </div>
          <div className="rounded-xl border border-border/60 p-4">
            <div className="text-muted-foreground">{t("Coverage in selected range", "Pokrivenost u izabranom opsegu")}</div>
            <div className="mt-1 font-medium">{(coverageRatio * 100).toFixed(0)}%</div>
          </div>
        </div>
      </ChartCard>

      {lowCoverage && (
        <div className="rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm text-foreground">
          <div className="font-medium">
            {veryLowCoverage
              ? t("Very low generation coverage", "Veoma niska pokrivenost proizvodnje")
              : t("Partial generation coverage", "Delimična pokrivenost proizvodnje")}
          </div>
          <p className="mt-1 text-muted-foreground">
            {veryLowCoverage
              ? t(
                  "Selected-period capture metrics are hidden until more Serbia solar/wind generation hours are available, to avoid misleading conclusions.",
                  "Metrike capture price za izabrani period su skrivene dok ne bude više sati sa dostupnom srpskom solar/wind proizvodnjom, da ne bismo prikazivali pogrešne zaključke.",
                )
              : t(
                  "Interpret capture metrics with caution: prices are complete, but generation weighting is only partially available in the selected range.",
                  "Tumači capture metrike oprezno: cene su kompletne, ali ponderisanje proizvodnjom je samo delimično dostupno u izabranom opsegu.",
                )}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label={t("Solar capture price", "Solar capture cena")}
          hint={methodologyHint}
          value={veryLowCoverage ? "N/A" : fmtValue(period.solarCapture)}
          unit="EUR/MWh"
        />
        <KpiCard
          label={t("Wind capture price", "Wind capture cena")}
          hint={methodologyHint}
          value={veryLowCoverage ? "N/A" : fmtValue(period.windCapture)}
          unit="EUR/MWh"
        />
        <KpiCard
          label={t("Solar capture rate", "Solar capture rate")}
          hint={t("Capture price divided by baseload over the same selected period.", "Capture price podeljen sa baseload cenom za isti izabrani period.")}
          value={veryLowCoverage ? "N/A" : fmtPct(period.solarRate)}
        />
        <KpiCard
          label={t("Wind capture rate", "Wind capture rate")}
          hint={t("Capture price divided by baseload over the same selected period.", "Capture price podeljen sa baseload cenom za isti izabrani period.")}
          value={veryLowCoverage ? "N/A" : fmtPct(period.windRate)}
        />
        <KpiCard
          label={t("Solar output in negative-price hours", "Solar output u negativnim satima")}
          hint={t("Share of solar generation produced during hours with price < 0 EUR/MWh.", "Udeo solarne proizvodnje u satima kada je cena < 0 EUR/MWh.")}
          value={veryLowCoverage ? "N/A" : fmtPct(period.solarNegShare, 2)}
        />
        <KpiCard
          label={t("Wind output in negative-price hours", "Wind output u negativnim satima")}
          hint={t("Share of wind generation produced during hours with price < 0 EUR/MWh.", "Udeo vetro proizvodnje u satima kada je cena < 0 EUR/MWh.")}
          value={veryLowCoverage ? "N/A" : fmtPct(period.windNegShare, 2)}
        />
        <KpiCard
          label={t("Solar premium / discount vs baseload", "Solar premija / diskont vs baseload")}
          hint={t("Positive means solar capture is above baseload; negative means below baseload.", "Pozitivno znači da je solar capture iznad baseload-a; negativno znači ispod baseload-a.")}
          value={veryLowCoverage ? "N/A" : fmtDiff(period.solarCapture, period.baseload)}
          unit="EUR/MWh"
        />
        <KpiCard
          label={t("Wind premium / discount vs baseload", "Wind premija / diskont vs baseload")}
          hint={t("Positive means wind capture is above baseload; negative means below baseload.", "Pozitivno znači da je wind capture iznad baseload-a; negativno znači ispod baseload-a.")}
          value={veryLowCoverage ? "N/A" : fmtDiff(period.windCapture, period.baseload)}
          unit="EUR/MWh"
        />
      </div>

      <ChartCard
        title={t("Monthly capture price vs baseload", "Mesečni capture price vs baseload")}
        description={t(
          "Methodology: Serbia hourly day-ahead baseload versus volume-weighted realized capture by technology over the selected period.",
          "Metodologija: hourly day-ahead baseload za Srbiju naspram volumenski ponderisanog realizovanog capture-a po tehnologiji u izabranom periodu.",
        )}
      >
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart
            data={monthly.map((m) => ({
              month: m.month.slice(5),
              baseload: m.baseload != null ? +m.baseload.toFixed(1) : null,
              solar: m.solarCapture != null ? +m.solarCapture.toFixed(1) : null,
              wind: m.windCapture != null ? +m.windCapture.toFixed(1) : null,
            }))}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
            <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
            <RTooltip />
            <Legend />
            <Bar dataKey="solar" fill="var(--color-chart-3)" name="Solar capture" />
            <Bar dataKey="wind" fill="var(--color-chart-2)" name="Wind capture" />
            <Line type="monotone" dataKey="baseload" stroke="var(--color-chart-5)" strokeWidth={2} name="Baseload" />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title={t("Capture rate trend", "Trend capture rate-a")} description={t("Capture price ÷ baseload price.", "Capture price ÷ baseload cena.")}>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart
              data={monthly.map((m) => ({
                month: m.month.slice(5),
                solar: m.solarRate != null ? +(m.solarRate * 100).toFixed(1) : null,
                wind: m.windRate != null ? +(m.windRate * 100).toFixed(1) : null,
              }))}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <YAxis unit="%" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <RTooltip />
              <Legend />
              <Line type="monotone" dataKey="solar" stroke="var(--color-chart-3)" name="Solar rate" />
              <Line type="monotone" dataKey="wind" stroke="var(--color-chart-2)" name="Wind rate" />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title={t("Generation share in negative-price hours", "Udeo proizvodnje u negativnim satima")}
          description={t(
            "Higher bars mean greater merchant downside exposure during negative-price hours.",
            "Više kolone znače veću downside izloženost u negativnim satima.",
          )}
        >
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={monthly.map((m) => ({
                month: m.month.slice(5),
                solar: m.solarNegShare != null ? +(m.solarNegShare * 100).toFixed(2) : null,
                wind: m.windNegShare != null ? +(m.windNegShare * 100).toFixed(2) : null,
              }))}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <YAxis unit="%" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <RTooltip />
              <Legend />
              <Bar dataKey="solar" fill="var(--color-chart-3)" name="Solar" />
              <Bar dataKey="wind" fill="var(--color-chart-2)" name="Wind" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title={t("Average hourly solar profile vs price", "Prosečan hourly solar profil vs cena")}
          description={t(
            "Real Serbia solar generation profile against realized hourly day-ahead prices in the selected period.",
            "Stvarni solarni profil Srbije naspram realizovanih hourly day-ahead cena u izabranom periodu.",
          )}
        >
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={hourly}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="h" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <YAxis yAxisId="l" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <RTooltip />
              <Legend />
              <Area yAxisId="r" type="monotone" dataKey="solar" stroke="var(--color-chart-3)" fill="var(--color-chart-3)" fillOpacity={0.25} name="Solar" />
              <Line yAxisId="l" type="monotone" dataKey="price" stroke="var(--color-chart-1)" name="Price" />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title={t("Average hourly wind profile vs price", "Prosečan hourly wind profil vs cena")}
          description={t(
            "Real Serbia wind generation profile against realized hourly day-ahead prices in the selected period.",
            "Stvarni vetro profil Srbije naspram realizovanih hourly day-ahead cena u izabranom periodu.",
          )}
        >
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={hourly}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="h" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <YAxis yAxisId="l" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <RTooltip />
              <Legend />
              <Area yAxisId="r" type="monotone" dataKey="wind" stroke="var(--color-chart-2)" fill="var(--color-chart-2)" fillOpacity={0.2} name="Wind" />
              <Line yAxisId="l" type="monotone" dataKey="price" stroke="var(--color-chart-1)" name="Price" />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <ChartCard
        title={t("Selected period summary", "Rezime izabranog perioda")}
        description={t("Selected range: ", "Izabrani opseg: ") + rangeLabel}
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <div className="rounded-xl border border-border/60 p-4">
            <div className="text-muted-foreground">{t("Baseload", "Baseload")}</div>
            <div className="mt-1 text-2xl font-display">{fmtValue(period.baseload)} <span className="text-xs">EUR/MWh</span></div>
          </div>
          <div className="rounded-xl border border-border/60 p-4">
            <div className="text-muted-foreground">{t("Negative-price hours", "Negativni sati")}</div>
            <div className="mt-1 text-2xl font-display">{period.negHours}</div>
          </div>
          <div className="rounded-xl border border-border/60 p-4">
            <div className="text-muted-foreground">{t("Hours with solar output", "Sati sa solarnom proizvodnjom")}</div>
            <div className="mt-1 text-2xl font-display">{solarHoursInRange}</div>
          </div>
          <div className="rounded-xl border border-border/60 p-4">
            <div className="text-muted-foreground">{t("Hours with wind output", "Sati sa vetro proizvodnjom")}</div>
            <div className="mt-1 text-2xl font-display">{windHoursInRange}</div>
          </div>
        </div>
      </ChartCard>
    </div>
  );
}

const _u = AreaChart;
void _u;
