import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
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
  ReferenceLine,
  ComposedChart,
} from "recharts";
import {
  ChartCard,
  DataUnavailableState,
  KpiCard,
  PageLoadingSkeleton,
} from "@/components/dashboard/atoms";
import {
  useDashboardRange,
  useRequestedRangeKeys,
} from "@/components/dashboard/DateRangeControl";
import { DataStatusBanner } from "@/components/dashboard/DataStatusBanner";
import { fetchMarketPrices } from "@/lib/market.functions";
import { useLang } from "@/lib/i18n";
import { bucketByBelgradeDay, aggregatePeriod, type HourlyPrice } from "@/lib/baseload";
import {
  comparisonRangeKeys,
  monthKeysBetween,
  monthOffsetBetween,
  parseComparisonKey,
  shiftMonthKey,
} from "@/lib/comparison";

export const Route = createFileRoute("/dashboard/")({
  head: () => ({
    meta: [
      { title: "Overview — CEA Power Dashboard" },
      {
        name: "description",
        content: "Key Serbian power market and renewable indicators at a glance.",
      },
      { property: "og:title", content: "Overview — CEA Power Dashboard" },
      {
        property: "og:description",
        content: "Key Serbian power market and renewable indicators at a glance.",
      },
      { property: "og:url", content: "https://dashboard.cea.org.rs/dashboard" },
    ],
    links: [{ rel: "canonical", href: "https://dashboard.cea.org.rs/dashboard" }],
  }),
  component: OverviewPage,
});

const fmt = (n: number, d = 1) => (isFinite(n) ? n.toFixed(d) : "—");

function methodology(opts: {
  metric: string;
  range: string;
  comparison?: string;
  hours: number;
  days: number;
  formula: string;
  lastUpdate?: Date;
}) {
  return (
    <div className="space-y-1.5">
      <div className="font-medium">{opts.metric}</div>
      <div>
        <span className="text-muted-foreground">Source:</span> ENTSO-E DA (Serbia SEEPEX, EIC
        10YCS-SERBIATSOV)
      </div>
      <div>
        <span className="text-muted-foreground">Range:</span> {opts.range}
      </div>
      {opts.comparison && (
        <div>
          <span className="text-muted-foreground">Comparison:</span> {opts.comparison}
        </div>
      )}
      <div>
        <span className="text-muted-foreground">Time zone:</span> Europe/Belgrade
      </div>
      <div>
        <span className="text-muted-foreground">Method:</span> {opts.formula}
      </div>
      <div>
        <span className="text-muted-foreground">Sample:</span> {opts.hours} hours · {opts.days}{" "}
        complete day(s)
      </div>
      {opts.lastUpdate && (
        <div>
          <span className="text-muted-foreground">Updated:</span>{" "}
          {opts.lastUpdate.toLocaleString("en-GB", { timeZone: "Europe/Belgrade" })}
        </div>
      )}
    </div>
  );
}

function percentTrend(current?: number | null, previous?: number | null) {
  if (
    current == null ||
    previous == null ||
    previous === 0 ||
    !Number.isFinite(current) ||
    !Number.isFinite(previous)
  ) {
    return undefined;
  }
  return { delta: ((current - previous) / Math.abs(previous)) * 100 };
}

function hoursTrend(current?: number | null, previous?: number | null) {
  if (
    current == null ||
    previous == null ||
    !Number.isFinite(current) ||
    !Number.isFinite(previous)
  ) {
    return undefined;
  }
  return { delta: current - previous, suffix: "h" };
}

function OverviewPage() {
  const { t } = useLang();
  const search = useSearch({ strict: false }) as { compare?: string };
  const comparison = parseComparisonKey(search.compare);
  const requestedRange = useRequestedRangeKeys();
  const live = useQuery({
    queryKey: [
      "market-prices",
      requestedRange.fromKey,
      requestedRange.toKey,
      requestedRange.preset,
    ],
    queryFn: () =>
      fetchMarketPrices({ data: { from: requestedRange.fromKey, to: requestedRange.toKey } }),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
  const hasReal = (live.data?.points?.length ?? 0) > 0;

  const data = useMemo<HourlyPrice[]>(
    () => (live.data?.points ?? []).map((p) => ({ ts: new Date(p.ts), price: p.price })),
    [live.data],
  );

  const buckets = useMemo(() => bucketByBelgradeDay(data), [data]);
  const completeDays = useMemo(() => buckets.filter((b) => b.complete), [buckets]);
  const incompleteCount = buckets.length - completeDays.length;
  const firstAvailable = completeDays[0]?.date;
  const latestAvailable = completeDays[completeDays.length - 1]?.date;
  const lastTs = data[data.length - 1]?.ts;

  const { fromKey, toKey, range } = useDashboardRange({ firstAvailable, latestAvailable });

  const period = useMemo(() => aggregatePeriod(buckets, fromKey, toKey), [buckets, fromKey, toKey]);
  const comparisonRange = useMemo(
    () => comparisonRangeKeys({ from: fromKey, to: toKey }, comparison),
    [comparison, fromKey, toKey],
  );
  const cmpFrom = comparisonRange?.from;
  const cmpTo = comparisonRange?.to;
  const comparisonQuery = useQuery({
    queryKey: ["market-prices", cmpFrom, cmpTo],
    queryFn: () => fetchMarketPrices({ data: { from: cmpFrom!, to: cmpTo! } }),
    enabled: Boolean(comparisonRange),
    staleTime: 5 * 60_000,
  });
  const comparisonData = useMemo<HourlyPrice[]>(
    () =>
      (comparisonQuery.data?.points ?? []).map((p) => ({ ts: new Date(p.ts), price: p.price })),
    [comparisonQuery.data],
  );
  const comparisonBuckets = useMemo(
    () => bucketByBelgradeDay(comparisonData),
    [comparisonData],
  );
  const comparisonCompleteDays = useMemo(
    () => comparisonBuckets.filter((b) => b.complete),
    [comparisonBuckets],
  );
  const comparisonPeriod = useMemo(
    () =>
      comparisonRange
        ? aggregatePeriod(comparisonBuckets, comparisonRange.from, comparisonRange.to)
        : undefined,
    [comparisonBuckets, comparisonRange],
  );

  // Rolling references (independent of selected range)
  const last7 = useMemo(() => completeDays.slice(-7), [completeDays]);
  const last30 = useMemo(() => completeDays.slice(-30), [completeDays]);
  const baseload7 = last7.length ? last7.reduce((a, b) => a + b.baseload, 0) / last7.length : NaN;
  const baseload30 = last30.length
    ? last30.reduce((a, b) => a + b.baseload, 0) / last30.length
    : NaN;

  // Monthly series — every month spanned by the selected analysis range.
  const monthly = useMemo(() => {
    if (completeDays.length === 0 || !fromKey || !toKey) return [];
    const currentAgg = new Map<string, { sum: number; n: number; neg: number }>();
    for (const b of completeDays) {
      if (b.key < fromKey || b.key > toKey) continue;
      const key = b.key.slice(0, 7);
      const cur = currentAgg.get(key) ?? { sum: 0, n: 0, neg: 0 };
      cur.sum += b.baseload;
      cur.n += 1;
      cur.neg += b.hours.filter((h) => h.price < 0).length;
      currentAgg.set(key, cur);
    }

    const comparisonAgg = new Map<string, { sum: number; n: number }>();
    if (comparisonRange) {
      for (const b of comparisonCompleteDays) {
        if (b.key < comparisonRange.from || b.key > comparisonRange.to) continue;
        const key = b.key.slice(0, 7);
        const cur = comparisonAgg.get(key) ?? { sum: 0, n: 0 };
        cur.sum += b.baseload;
        cur.n += 1;
        comparisonAgg.set(key, cur);
      }
    }

    const months = monthKeysBetween(fromKey, toKey);
    const sameYear = fromKey.slice(0, 4) === toKey.slice(0, 4);
    const offset = comparisonRange ? monthOffsetBetween(comparisonRange.from, fromKey) : 0;

    return months.map((month) => {
      const current = currentAgg.get(month);
      const comparisonMonth = comparisonRange ? shiftMonthKey(month, -offset) : undefined;
      const previous = comparisonMonth ? comparisonAgg.get(comparisonMonth) : undefined;
      return {
        month: sameYear ? month.slice(5) : month,
        baseload: current && current.n ? +(current.sum / current.n).toFixed(1) : null,
        prevBaseload: previous && previous.n ? +(previous.sum / previous.n).toFixed(1) : null,
        negHours: current ? current.neg : 0,
      };
    });
  }, [completeDays, comparisonCompleteDays, comparisonRange, fromKey, toKey]);

  // Daily chart (in-range), with the comparison period aligned by day index.
  const inRangeDaily = useMemo(() => {
    const current = buckets.filter(
      (b) => (!fromKey || b.key >= fromKey) && (!toKey || b.key <= toKey),
    );
    const previous = comparisonRange
      ? comparisonBuckets.filter(
          (b) => b.key >= comparisonRange.from && b.key <= comparisonRange.to,
        )
      : [];
    return current.map((b, index) => ({
      day: b.key.slice(5),
      baseload: +b.baseload.toFixed(1),
      peakload: b.peakload != null ? +b.peakload.toFixed(1) : null,
      prevBaseload: previous[index] ? +previous[index].baseload.toFixed(1) : null,
    }));
  }, [buckets, comparisonBuckets, comparisonRange, fromKey, toKey]);

  const last48Chart = useMemo(() => {
    const current = data.slice(-48);
    const previous = comparisonData.slice(-48);
    return current.map((p, index) => ({
      t: p.ts.toISOString().slice(5, 16).replace("T", " "),
      price: +p.price.toFixed(1),
      prevPrice: previous[index] ? +previous[index].price.toFixed(1) : null,
    }));
  }, [comparisonData, data]);

  const refreshing = live.isFetching || comparisonQuery.isFetching;

  if (live.isLoading) {
    return <PageLoadingSkeleton />;
  }
  if (!hasReal) {
    return (
      <DataUnavailableState
        title={t("Live ENTSO-E data unavailable", "ENTSO-E podaci trenutno nisu dostupni")}
        description={
          <>
            {t(
              "We could not retrieve the latest Serbian day-ahead price data for the selected period. Try retrying live data or selecting a different range.",
              "Nismo uspeli da preuzmemo najnovije day-ahead cene za Srbiju u izabranom periodu. Pokušajte ponovo ili izaberite drugi period.",
            )}
            {live.isError && <span className="mt-1 block text-critical">{String(live.error)}</span>}
          </>
        }
        onRetry={() => live.refetch()}
      />
    );
  }

  const rangeLabel = range
    ? `${range.from.toISOString().slice(0, 10)} → ${range.to.toISOString().slice(0, 10)}`
    : "—";
  const comparisonLabel = comparisonRange
    ? `${comparisonRange.from} → ${comparisonRange.to}`
    : undefined;

  return (
    <div className="space-y-4">
      <DataStatusBanner
        source={(live.data?.source as "entsoe" | "cache" | "none") ?? "none"}
        lastUpdate={lastTs}
        hours={data.length}
        completeDays={period.completeDaysCount}
        incompleteDays={incompleteCount}
        selectedFrom={fromKey}
        selectedTo={toKey}
        availableFrom={live.data?.loadedFrom ?? completeDays[0]?.key}
        availableTo={live.data?.loadedTo ?? completeDays[completeDays.length - 1]?.key}
        missingDays={live.data?.missingDays?.length ?? 0}
        reasons={live.data?.reasons}
        incompleteDayList={live.data?.incompleteDays}
        failedFetches={live.data?.failedFetches}
        totalSelectedDays={live.data?.totalSelectedDays}
        attemptedDaysCount={live.data?.attemptedDaysCount}
        fetchedDaysCount={live.data?.fetchedDaysCount}
        failureCounts={live.data?.failureCounts}
        capReached={live.data?.capReached}
        maxFetchPerCall={live.data?.maxFetchPerCall}
        debugSummary={live.data?.debugSummary}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-4">
        <KpiCard
          loading={refreshing}
          label={t("Baseload (period)", "Bazna cena u periodu")}
          value={fmt(period.baseload)}
          unit="EUR/MWh"
          trend={percentTrend(period.baseload, comparisonPeriod?.baseload)}
          hint={methodology({
            metric: "Period baseload",
            range: rangeLabel,
            comparison: comparisonLabel,
            hours: period.hoursCount,
            days: period.completeDaysCount,
            formula:
              "Mean of hourly prices on complete days (≥20 of 24 local Belgrade hours); incomplete days are excluded.",
            lastUpdate: lastTs,
          })}
        />
        <KpiCard
          loading={refreshing}
          label={t("Peakload (period)", "Vršno opterećenje u periodu")}
          value={fmt(period.peakload ?? NaN)}
          unit="EUR/MWh"
          trend={percentTrend(period.peakload, comparisonPeriod?.peakload)}
          hint={methodology({
            metric: "Period peakload",
            range: rangeLabel,
            comparison: comparisonLabel,
            hours: period.hoursCount,
            days: period.completeDaysCount,
            formula:
              "Mean of Mon–Fri 08:00–20:00 Europe/Belgrade prices on complete days (≥20 of 24 local hours).",
            lastUpdate: lastTs,
          })}
        />
        <KpiCard
          loading={refreshing}
          label={t("Negative hours", "Sati sa negativnom cenom")}
          value={period.negHours}
          unit={t("hours", "sati")}
          trend={hoursTrend(period.negHours, comparisonPeriod?.negHours)}
          hint={methodology({
            metric: "Negative price hours",
            range: rangeLabel,
            comparison: comparisonLabel,
            hours: period.hoursCount,
            days: period.completeDaysCount,
            formula:
              "Count of all observed hourly DA prices < 0 EUR/MWh in the selected range, including incomplete days.",
          })}
        />
        <KpiCard
          loading={refreshing}
          label={t("Volatility (σ)", "Volatilnost (σ)")}
          value={fmt(period.sd)}
          unit="EUR/MWh"
          trend={percentTrend(period.sd, comparisonPeriod?.sd)}
          hint={methodology({
            metric: "Volatility",
            range: rangeLabel,
            comparison: comparisonLabel,
            hours: period.hoursCount,
            days: period.completeDaysCount,
            formula:
              "Population standard deviation of hourly DA prices on the same complete-day sample as baseload.",
          })}
        />
        <KpiCard
          loading={refreshing}
          label={t("Min hour", "Najniži sat")}
          value={fmt(period.minHour, 0)}
          unit="EUR/MWh"
        />
        <KpiCard
          loading={refreshing}
          label={t("Max hour", "Najviši sat")}
          value={fmt(period.maxHour, 0)}
          unit="EUR/MWh"
        />
        <KpiCard
          loading={refreshing}
          label={t("7-day baseload", "Bazna cena 7 dana")}
          value={fmt(baseload7)}
          unit="EUR/MWh"
          hint={methodology({
            metric: "Rolling 7-day baseload",
            range: `${last7[0]?.key ?? "?"} → ${last7[last7.length - 1]?.key ?? "?"}`,
            hours: last7.reduce((a, b) => a + b.hours.length, 0),
            days: last7.length,
            formula: "Mean of last 7 complete daily baseloads.",
          })}
        />
        <KpiCard
          loading={refreshing}
          label={t("30-day baseload", "Bazna cena 30 dana")}
          value={fmt(baseload30)}
          unit="EUR/MWh"
          hint={methodology({
            metric: "Rolling 30-day baseload",
            range: `${last30[0]?.key ?? "?"} → ${last30[last30.length - 1]?.key ?? "?"}`,
            hours: last30.reduce((a, b) => a + b.hours.length, 0),
            days: last30.length,
            formula: "Mean of last 30 complete daily baseloads.",
          })}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          loading={refreshing}
          title={t("Hourly day-ahead price", "Satna day-ahead cena")}
          description={t(
            "Last 48 hours of SEEPEX-style hourly prices.",
            "Poslednjih 48 sati satnih cena u SEEPEX formatu.",
          )}
        >
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={last48Chart} margin={{ left: 0, right: 12, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" strokeOpacity={0.5} />
              <XAxis dataKey="t" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <RTooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12, color: "var(--color-popover-foreground)" }} labelStyle={{ color: "var(--color-muted-foreground)" }} />
              <Legend />
              <ReferenceLine y={0} stroke="var(--color-critical)" strokeDasharray="4 4" />
              <Line
                type="monotone"
                dataKey="price"
                stroke="var(--color-chart-1)"
                strokeWidth={2}
                dot={false}
                name={t("Current period", "Tekući period")}
              />
              <Line
                type="monotone"
                dataKey="prevPrice"
                stroke="var(--color-chart-3)"
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                name={t("Prev. period", "Prethodni period")}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          loading={refreshing}
          title={t("Daily baseload & peakload (period)", "Dnevna bazna i vršna cena u periodu")}
          description={t(
            "In selected range. Peakload = Mon–Fri 08:00–20:00.",
            "U izabranom periodu. Peakload = ponedeljak-petak 08:00-20:00.",
          )}
        >
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={inRangeDaily}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" strokeOpacity={0.5} />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <RTooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12, color: "var(--color-popover-foreground)" }} labelStyle={{ color: "var(--color-muted-foreground)" }} />
              <Legend />
              <Bar
                dataKey="baseload"
                fill="var(--color-chart-1)"
                name={t("Baseload", "Bazna cena")}
              />
              <Bar
                dataKey="peakload"
                fill="var(--color-chart-3)"
                name={t("Peakload", "Vršno opterećenje")}
              />
              <Line
                type="monotone"
                dataKey="prevBaseload"
                stroke="var(--color-chart-2)"
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                name={t("Prev. period", "Prethodni period")}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title={t("Monthly baseload", "Mesečna bazna cena")} loading={refreshing}>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={monthly}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" strokeOpacity={0.5} />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              />
              <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <RTooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12, color: "var(--color-popover-foreground)" }} labelStyle={{ color: "var(--color-muted-foreground)" }} />
              <Legend />
              <Line
                type="monotone"
                dataKey="baseload"
                stroke="var(--color-chart-2)"
                strokeWidth={2}
                name={t("Baseload", "Bazna cena")}
              />
              <Line
                type="monotone"
                dataKey="prevBaseload"
                stroke="var(--color-chart-3)"
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                name={t("Prev. period", "Prethodni period")}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          loading={refreshing}
          title={t("Negative price hours per month", "Sati sa negativnom cenom po mesecu")}
        >
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={monthly}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" strokeOpacity={0.5} />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              />
              <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <RTooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12, color: "var(--color-popover-foreground)" }} labelStyle={{ color: "var(--color-muted-foreground)" }} />
              <Bar dataKey="negHours" fill="var(--color-critical)" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="space-y-2 rounded-[10px] border border-border/70 bg-card p-4 text-sm">
        <h3 className="font-display text-base font-semibold">
          {t("Data check & methodology", "Provera podataka i metodologija")}
        </h3>
        <p className="text-muted-foreground">
          {t(
            "Period baseload is the mean of hourly SEEPEX DA prices on complete days, where a complete day has at least 20 of its 24 local Europe/Belgrade hours. Incomplete days caused by DST-related gaps, missing data or today-so-far are excluded; volatility uses the same complete-day sample. When a comparison period is selected, KPI deltas are shown against that period.",
            "Bazna cena za period je prosek satnih SEEPEX DA cena tokom potpunih dana, pri čemu potpuni dan ima najmanje 20 od 24 lokalna sata u vremenskoj zoni Europe/Belgrade. Nepotpuni dani usled DST odstupanja, nedostajućih podataka ili tekućeg dana izuzimaju se, a volatilnost koristi isti uzorak potpunih dana. Kada je izabran period za poređenje, KPI kartice prikazuju promene u odnosu na taj period.",
          )}
        </p>
        <p className="text-muted-foreground">
          {t(
            "Negative-hour counts and min/max use all observed hours, including incomplete days. If you see a small gap vs SEEPEX WB, note that SEEPEX WB is a regional Western Balkans reference; this dashboard uses the Serbia bidding zone (EIC 10YCS-SERBIATSOV) directly from ENTSO-E. Hover the info icons on the four comparison KPIs to see the selected and comparison ranges; deltas appear only when a comparison period is selected.",
            "Broj sati sa negativnom cenom i minimalna/maksimalna cena koriste sve zabeležene sate, uključujući nepotpune dane. Ako vidite manje odstupanje u odnosu na SEEPEX WB, imajte u vidu da je SEEPEX WB regionalna referenca za Zapadni Balkan; ova platforma koristi srpsku bidding zonu (EIC 10YCS-SERBIATSOV) direktno sa ENTSO-E. Pređite mišem preko info ikonica na četiri KPI kartice za poređenje da vidite izabrani i uporedni period; promene se prikazuju samo kada je period za poređenje izabran.",
          )}
        </p>
      </div>
    </div>
  );
}
