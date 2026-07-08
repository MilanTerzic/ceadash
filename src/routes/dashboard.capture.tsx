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
import { DateRangeControl, useDashboardRange, useRequestedRangeKeys } from "@/components/dashboard/DateRangeControl";
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

const ROUND_TRIP_EFF = 0.85;

type BessDayMetrics = {
  charge2: number;
  discharge2: number;
  gross2: number;
  net2: number;
  charge4: number;
  discharge4: number;
  gross4: number;
  net4: number;
};

type BessAggregate = {
  days: number;
  avgCharge2: number | null;
  avgDischarge2: number | null;
  avgGross2: number | null;
  avgNet2: number | null;
  avgCharge4: number | null;
  avgDischarge4: number | null;
  avgGross4: number | null;
  avgNet4: number | null;
};

type CapturePeriodMetrics = {
  baseload: number | null;
  solarCapture: number | null;
  windCapture: number | null;
  solarRate: number | null;
  windRate: number | null;
  solarNegShare: number | null;
  windNegShare: number | null;
  solarNegMwh: number;
  windNegMwh: number;
  solarTotalMwh: number;
  windTotalMwh: number;
  negHours: number;
  solarHours: number;
  windHours: number;
  priceHours: number;
  bess: BessAggregate;
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

/** Compute BESS 2h/4h daily arbitrage spreads and average across all complete
 *  days in the input. Rules:
 *   - group hourly prices by Belgrade calendar day (only rows with finite prices)
 *   - a day contributes to 2h metrics if it has >= 4 hours (2 charge + 2 discharge)
 *     and to 4h metrics if it has >= 8 hours (4 charge + 4 discharge)
 *   - charge = mean of N cheapest hours; discharge = mean of N most expensive hours
 *   - gross = discharge - charge; net = discharge * 0.85 - charge
 */
function bessDaily(points: CapturePoint[]): BessDayMetrics[] {
  const byDay = new Map<string, number[]>();
  for (const p of points) {
    if (!Number.isFinite(p.price)) continue;
    const k = belgradeDayKey(new Date(p.ts));
    const arr = byDay.get(k) ?? [];
    arr.push(p.price);
    byDay.set(k, arr);
  }
  const out: BessDayMetrics[] = [];
  for (const prices of byDay.values()) {
    if (prices.length < 4) continue;
    const sorted = [...prices].sort((a, b) => a - b);
    const low2 = sorted.slice(0, 2);
    const high2 = sorted.slice(-2);
    const charge2 = low2.reduce((a, b) => a + b, 0) / low2.length;
    const discharge2 = high2.reduce((a, b) => a + b, 0) / high2.length;
    let charge4 = NaN;
    let discharge4 = NaN;
    if (prices.length >= 8) {
      const low4 = sorted.slice(0, 4);
      const high4 = sorted.slice(-4);
      charge4 = low4.reduce((a, b) => a + b, 0) / low4.length;
      discharge4 = high4.reduce((a, b) => a + b, 0) / high4.length;
    }
    out.push({
      charge2,
      discharge2,
      gross2: discharge2 - charge2,
      net2: discharge2 * ROUND_TRIP_EFF - charge2,
      charge4,
      discharge4,
      gross4: Number.isFinite(charge4) ? discharge4 - charge4 : NaN,
      net4: Number.isFinite(charge4) ? discharge4 * ROUND_TRIP_EFF - charge4 : NaN,
    });
  }
  return out;
}

function aggregateBess(days: BessDayMetrics[]): BessAggregate {
  const mean = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const has4 = days.filter((d) => Number.isFinite(d.gross4));
  return {
    days: days.length,
    avgCharge2: mean(days.map((d) => d.charge2)),
    avgDischarge2: mean(days.map((d) => d.discharge2)),
    avgGross2: mean(days.map((d) => d.gross2)),
    avgNet2: mean(days.map((d) => d.net2)),
    avgCharge4: mean(has4.map((d) => d.charge4)),
    avgDischarge4: mean(has4.map((d) => d.discharge4)),
    avgGross4: mean(has4.map((d) => d.gross4)),
    avgNet4: mean(has4.map((d) => d.net4)),
  };
}

function computeMetrics(points: CapturePoint[]): CapturePeriodMetrics {
  const emptyBess: BessAggregate = {
    days: 0,
    avgCharge2: null,
    avgDischarge2: null,
    avgGross2: null,
    avgNet2: null,
    avgCharge4: null,
    avgDischarge4: null,
    avgGross4: null,
    avgNet4: null,
  };
  const empty: CapturePeriodMetrics = {
    baseload: null,
    solarCapture: null,
    windCapture: null,
    solarRate: null,
    windRate: null,
    solarNegShare: null,
    windNegShare: null,
    solarNegMwh: 0,
    windNegMwh: 0,
    solarTotalMwh: 0,
    windTotalMwh: 0,
    negHours: 0,
    solarHours: 0,
    windHours: 0,
    priceHours: 0,
    bess: emptyBess,
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
    // Treat negative generation as zero per spec.
    const solar = Number.isFinite(p.solar) && p.solar > 0 ? p.solar : 0;
    const wind = Number.isFinite(p.wind) && p.wind > 0 ? p.wind : 0;
    if (solar > 0) {
      sumPS += p.price * solar;
      sumS += solar;
      solarHours += 1;
      if (p.price < 0) sumSneg += solar;
    }
    if (wind > 0) {
      sumPW += p.price * wind;
      sumW += wind;
      windHours += 1;
      if (p.price < 0) sumWneg += wind;
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
    solarNegMwh: sumSneg,
    windNegMwh: sumWneg,
    solarTotalMwh: sumS,
    windTotalMwh: sumW,
    negHours,
    solarHours,
    windHours,
    priceHours,
    bess: aggregateBess(bessDaily(points)),
  };
}

export type MonthlyCaptureRow = { month: string } & CapturePeriodMetrics;

function captureMetricsByMonth(points: CapturePoint[]): MonthlyCaptureRow[] {
  const map = new Map<string, CapturePoint[]>();
  for (const p of points) {
    const key = monthKey(new Date(p.ts));
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, pts]) => ({ month, ...computeMetrics(pts) }));
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
  const requestedRange = useRequestedRangeKeys();

  const live = useQuery({
    queryKey: ["capture-series", requestedRange.fromKey, requestedRange.toKey, requestedRange.preset],
    queryFn: () => fetchCaptureSeries({ data: { from: requestedRange.fromKey, to: requestedRange.toKey } }),
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

  if (!inRange.length) {
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
        source={(live.data?.source as "entsoe" | "cache" | "none") ?? "none"}
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

      {(period.solarCapture == null || period.windCapture == null) && (
        <div className="rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm text-foreground">
          <div className="font-medium">
            {t("Missing ENTSO-E generation data", "Nedostaju ENTSO-E podaci o proizvodnji")}
          </div>
          <p className="mt-1 text-muted-foreground">
            {period.solarCapture == null
              ? t(
                  "No Serbia solar generation (psrType B16) was returned by ENTSO-E for hours overlapping the SEEPEX prices in the selected period. Solar capture price, rate and premium are shown as N/A instead of 0.",
                  "ENTSO-E nije vratio podatke o solarnoj proizvodnji Srbije (psrType B16) za sate koji se preklapaju sa SEEPEX cenama u izabranom periodu. Solar capture price, rate i premija prikazani su kao N/A umesto 0.",
                )
              : t(
                  "No Serbia wind generation (psrType B18+B19) was returned by ENTSO-E for hours overlapping the SEEPEX prices in the selected period. Wind capture metrics are shown as N/A.",
                  "ENTSO-E nije vratio podatke o vetro proizvodnji Srbije (psrType B18+B19) za sate koji se preklapaju sa SEEPEX cenama u izabranom periodu. Wind capture metrike prikazane su kao N/A.",
                )}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label={t("Baseload average price", "Baseload prosečna cena")}
          hint={t("Simple mean of hourly Serbia day-ahead prices in the selected period.", "Prosek satnih day-ahead cena za Srbiju u izabranom periodu.")}
          value={fmtValue(period.baseload)}
          unit="EUR/MWh"
        />
        <KpiCard
          label={t("Negative-price hours", "Negativni sati")}
          hint={t("Number of hours in the selected period with day-ahead price < 0 EUR/MWh.", "Broj sati u izabranom periodu sa day-ahead cenom < 0 EUR/MWh.")}
          value={period.negHours}
        />
        <KpiCard
          label={t("Solar capture price", "Solar capture cena")}
          hint={methodologyHint}
          value={veryLowCoverage ? "N/A" : fmtValue(period.solarCapture)}
          unit={
            veryLowCoverage || period.solarRate == null
              ? "EUR/MWh"
              : `EUR/MWh · ${fmtPct(period.solarRate)}`
          }
        />
        <KpiCard
          label={t("Wind capture price", "Wind capture cena")}
          hint={methodologyHint}
          value={veryLowCoverage ? "N/A" : fmtValue(period.windCapture)}
          unit={
            veryLowCoverage || period.windRate == null
              ? "EUR/MWh"
              : `EUR/MWh · ${fmtPct(period.windRate)}`
          }
        />
        <KpiCard
          label={t("BESS 2h net spread", "BESS 2h neto spread")}
          hint={t(
            "Daily 2-hour BESS arbitrage spread net of 85% round-trip efficiency, averaged over days in the selected period. Formula: mean(2 highest daily prices) × 0.85 − mean(2 lowest daily prices). One cycle/day, no degradation/fees/imbalance.",
            "Dnevni 2-časovni BESS arbitražni spread nakon 85% round-trip efikasnosti, prosečno po danima u izabranom periodu. Formula: prosek(2 najviše dnevne cene) × 0.85 − prosek(2 najniže dnevne cene). Jedan ciklus/dan, bez degradacije/naknada.",
          )}
          value={fmtValue(period.bess.avgNet2)}
          unit="EUR/MWh · net"
        />
        <KpiCard
          label={t("BESS 4h net spread", "BESS 4h neto spread")}
          hint={t(
            "Daily 4-hour BESS arbitrage spread net of 85% round-trip efficiency, averaged over days. Formula: mean(4 highest daily prices) × 0.85 − mean(4 lowest daily prices). One cycle/day, no degradation/fees/imbalance.",
            "Dnevni 4-časovni BESS arbitražni spread nakon 85% round-trip efikasnosti, prosečno po danima. Formula: prosek(4 najviše dnevne cene) × 0.85 − prosek(4 najniže dnevne cene). Jedan ciklus/dan, bez degradacije/naknada.",
          )}
          value={fmtValue(period.bess.avgNet4)}
          unit="EUR/MWh · net"
        />
        <KpiCard
          label={t("Solar output in negative-price hours", "Solar output u negativnim satima")}
          hint={t("Share and absolute MWh of solar generation produced during hours with price < 0 EUR/MWh.", "Udeo i apsolutni MWh solarne proizvodnje u satima sa cenom < 0 EUR/MWh.")}
          value={veryLowCoverage ? "N/A" : fmtPct(period.solarNegShare, 2)}
          unit={veryLowCoverage ? undefined : `${period.solarNegMwh.toFixed(0)} MWh`}
        />
        <KpiCard
          label={t("Wind output in negative-price hours", "Wind output u negativnim satima")}
          hint={t("Share and absolute MWh of wind generation produced during hours with price < 0 EUR/MWh.", "Udeo i apsolutni MWh vetro proizvodnje u satima sa cenom < 0 EUR/MWh.")}
          value={veryLowCoverage ? "N/A" : fmtPct(period.windNegShare, 2)}
          unit={veryLowCoverage ? undefined : `${period.windNegMwh.toFixed(0)} MWh`}
        />
      </div>

      <MonthlyCaptureTable rows={monthly} rangeLabel={rangeLabel} />


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
