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
  baseload: number;
  solarCapture: number;
  windCapture: number;
  solarRate: number;
  windRate: number;
  solarNegShare: number;
  windNegShare: number;
  negHours: number;
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
  if (!points.length) {
    return {
      baseload: 0,
      solarCapture: 0,
      windCapture: 0,
      solarRate: 0,
      windRate: 0,
      solarNegShare: 0,
      windNegShare: 0,
      negHours: 0,
    };
  }

  let sumP = 0;
  let sumPS = 0;
  let sumPW = 0;
  let sumS = 0;
  let sumW = 0;
  let sumSneg = 0;
  let sumWneg = 0;
  let negHours = 0;

  for (const p of points) {
    sumP += p.price;
    sumPS += p.price * p.solar;
    sumPW += p.price * p.wind;
    sumS += p.solar;
    sumW += p.wind;
    if (p.price < 0) {
      negHours += 1;
      sumSneg += p.solar;
      sumWneg += p.wind;
    }
  }

  const baseload = sumP / points.length;
  const solarCapture = sumS > 0 ? sumPS / sumS : 0;
  const windCapture = sumW > 0 ? sumPW / sumW : 0;

  return {
    baseload,
    solarCapture,
    windCapture,
    solarRate: baseload !== 0 ? solarCapture / baseload : 0,
    windRate: baseload !== 0 ? windCapture / baseload : 0,
    solarNegShare: sumS > 0 ? sumSneg / sumS : 0,
    windNegShare: sumW > 0 ? sumWneg / sumW : 0,
    negHours,
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

  const rangeLabel = range
    ? `${format(range.from, "d MMM yyyy")} – ${format(range.to, "d MMM yyyy")}`
    : "—";

  const warning =
    live.data && live.data.totalHours > 0
      ? `${t("Generation coverage", "Pokrivenost proizvodnje")}: ${live.data.matchedHours}/${live.data.totalHours} ${t("hours matched to price series", "sati uparenih sa cenama")}`
      : undefined;

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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label={t("Solar capture price", "Solar capture price")}
          hint={t("Volume-weighted hourly Serbia day-ahead price using actual solar generation in the selected period.", "Volumenski ponderisana hourly cena Srbije korišćenjem stvarne solarne proizvodnje u izabranom periodu.")}
          value={period.solarCapture.toFixed(1)}
          unit="EUR/MWh"
        />
        <KpiCard
          label={t("Wind capture price", "Wind capture price")}
          value={period.windCapture.toFixed(1)}
          unit="EUR/MWh"
        />
        <KpiCard
          label={t("Solar capture rate", "Solar capture rate")}
          value={`${(period.solarRate * 100).toFixed(1)}%`}
        />
        <KpiCard
          label={t("Wind capture rate", "Wind capture rate")}
          value={`${(period.windRate * 100).toFixed(1)}%`}
        />
        <KpiCard
          label={t("Solar in negative hours", "Solar u negativnim satima")}
          hint={t("Share of solar generation produced during hours with price < 0 EUR/MWh.", "Udeo solarne proizvodnje u satima kada je cena < 0 EUR/MWh.")}
          value={`${(period.solarNegShare * 100).toFixed(2)}%`}
        />
        <KpiCard
          label={t("Wind in negative hours", "Wind u negativnim satima")}
          value={`${(period.windNegShare * 100).toFixed(2)}%`}
        />
        <KpiCard
          label={t("Solar vs baseload", "Solar vs baseload")}
          value={`${(period.solarCapture - period.baseload).toFixed(1)}`}
          unit="EUR/MWh"
        />
        <KpiCard
          label={t("Wind vs baseload", "Wind vs baseload")}
          value={`${(period.windCapture - period.baseload).toFixed(1)}`}
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
              baseload: +m.baseload.toFixed(1),
              solar: +m.solarCapture.toFixed(1),
              wind: +m.windCapture.toFixed(1),
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
                solar: +(m.solarRate * 100).toFixed(1),
                wind: +(m.windRate * 100).toFixed(1),
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
          title={t("Generation share in negative hours", "Udeo proizvodnje u negativnim satima")}
          description={t(
            "Higher bars mean greater merchant downside exposure during negative-price hours.",
            "Više kolone znače veću downside izloženost u negativnim satima.",
          )}
        >
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={monthly.map((m) => ({
                month: m.month.slice(5),
                solar: +(m.solarNegShare * 100).toFixed(2),
                wind: +(m.windNegShare * 100).toFixed(2),
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
        description={t(
          "Selected range: ",
          "Izabrani opseg: ",
        ) + rangeLabel}
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <div className="rounded-xl border border-border/60 p-4">
            <div className="text-muted-foreground">{t("Baseload", "Baseload")}</div>
            <div className="mt-1 text-2xl font-display">{period.baseload.toFixed(1)} <span className="text-xs">EUR/MWh</span></div>
          </div>
          <div className="rounded-xl border border-border/60 p-4">
            <div className="text-muted-foreground">{t("Negative hours", "Negativni sati")}</div>
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
