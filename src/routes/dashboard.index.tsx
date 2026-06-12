import { createFileRoute } from "@tanstack/react-router";
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
} from "recharts";
import { KpiCard, ChartCard } from "@/components/dashboard/atoms";
import { DateRangeControl, useDashboardRange } from "@/components/dashboard/DateRangeControl";
import { DataStatusBanner } from "@/components/dashboard/DataStatusBanner";
import { fetchMarketPrices } from "@/lib/market.functions";
import { useLang } from "@/lib/i18n";
import {
  bucketByBelgradeDay,
  aggregatePeriod,
  type HourlyPrice,
} from "@/lib/baseload";

export const Route = createFileRoute("/dashboard/")({
  head: () => ({
    meta: [
      { title: "Overview — CEA Power Dashboard" },
      { name: "description", content: "Key Serbian power market and renewable indicators at a glance." },
      { property: "og:title", content: "Overview — CEA Power Dashboard" },
      { property: "og:description", content: "Key Serbian power market and renewable indicators at a glance." },
      { property: "og:url", content: "https://ceadash.lovable.app/dashboard" },
    ],
    links: [{ rel: "canonical", href: "https://ceadash.lovable.app/dashboard" }],
  }),
  component: OverviewPage,
});

const fmt = (n: number, d = 1) => (isFinite(n) ? n.toFixed(d) : "—");

function methodology(opts: {
  metric: string;
  range: string;
  hours: number;
  days: number;
  formula: string;
  lastUpdate?: Date;
}) {
  return (
    <div className="space-y-1.5">
      <div className="font-medium">{opts.metric}</div>
      <div><span className="text-muted-foreground">Source:</span> ENTSO-E DA (Serbia SEEPEX, EIC 10YCS-SERBIATSOV)</div>
      <div><span className="text-muted-foreground">Range:</span> {opts.range}</div>
      <div><span className="text-muted-foreground">Time zone:</span> Europe/Belgrade</div>
      <div><span className="text-muted-foreground">Method:</span> {opts.formula}</div>
      <div><span className="text-muted-foreground">Sample:</span> {opts.hours} hours · {opts.days} complete day(s)</div>
      {opts.lastUpdate && (
        <div><span className="text-muted-foreground">Updated:</span> {opts.lastUpdate.toLocaleString("en-GB", { timeZone: "Europe/Belgrade" })}</div>
      )}
    </div>
  );
}

function OverviewPage() {
  const { t } = useLang();
  const live = useQuery({
    queryKey: ["market-prices"],
    queryFn: () => fetchMarketPrices(),
    staleTime: 60 * 60_000,
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

  // Rolling references (independent of selected range)
  const last7 = useMemo(() => completeDays.slice(-7), [completeDays]);
  const last30 = useMemo(() => completeDays.slice(-30), [completeDays]);
  const baseload7 = last7.length ? last7.reduce((a, b) => a + b.baseload, 0) / last7.length : NaN;
  const baseload30 = last30.length ? last30.reduce((a, b) => a + b.baseload, 0) / last30.length : NaN;

  // Monthly series (full history) for charts
  const monthly = useMemo(() => {
    const m = new Map<string, { sum: number; n: number; neg: number }>();
    for (const b of completeDays) {
      const k = b.key.slice(0, 7);
      const cur = m.get(k) ?? { sum: 0, n: 0, neg: 0 };
      cur.sum += b.baseload;
      cur.n += 1;
      cur.neg += b.hours.filter((h) => h.price < 0).length;
      m.set(k, cur);
    }
    return Array.from(m.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => ({
        month: k.slice(5),
        baseload: +(v.sum / v.n).toFixed(1),
        negHours: v.neg,
      }));
  }, [completeDays]);

  // Daily chart (in-range)
  const inRangeDaily = useMemo(
    () =>
      buckets
        .filter((b) => (!fromKey || b.key >= fromKey) && (!toKey || b.key <= toKey))
        .map((b) => ({
          day: b.key.slice(5),
          baseload: +b.baseload.toFixed(1),
          peakload: b.peakload != null ? +b.peakload.toFixed(1) : null,
        })),
    [buckets, fromKey, toKey],
  );

  const last48Chart = useMemo(
    () =>
      data.slice(-48).map((p) => ({
        t: p.ts.toISOString().slice(5, 16).replace("T", " "),
        price: +p.price.toFixed(1),
      })),
    [data],
  );

  if (live.isLoading) {
    return <p className="text-sm text-muted-foreground">{t("Fetching live ENTSO-E day-ahead prices…", "Učitavanje uživo ENTSO-E day-ahead cena…")}</p>;
  }
  if (!hasReal) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("Live ENTSO-E day-ahead data is currently unavailable. Please retry shortly.", "Day-ahead podaci sa ENTSO-E trenutno nisu dostupni. Pokušajte ponovo uskoro.")}
        {live.isError && <span className="block mt-1 text-critical">{String(live.error)}</span>}
      </p>
    );
  }

  const rangeLabel = range
    ? `${range.from.toISOString().slice(0, 10)} → ${range.to.toISOString().slice(0, 10)}`
    : "—";

  return (
    <div className="space-y-6">
      <DataStatusBanner
        source={(live.data?.source as "entsoe" | "cache" | "none") ?? "none"}
        lastUpdate={lastTs}
        hours={data.length}
        completeDays={completeDays.length}
        incompleteDays={incompleteCount}
        warning={
          incompleteCount > 0
            ? t(
                `${incompleteCount} day(s) excluded from baseload because they have fewer than 24 hourly prices (DST or today-so-far).`,
                `${incompleteCount} dan(a) izuzeto iz baseload-a zbog manje od 24 satnih cena (DST ili tekući dan).`,
              )
            : undefined
        }
      />

      <DateRangeControl firstAvailable={firstAvailable} latestAvailable={latestAvailable} />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t("Baseload (period)", "Baseload (period)")}
          value={fmt(period.baseload)}
          unit="EUR/MWh"
          hint={methodology({
            metric: "Period baseload",
            range: rangeLabel,
            hours: period.hoursCount,
            days: period.completeDaysCount,
            formula: "Mean of daily baseloads (each = mean of 24 hourly prices) over complete days only.",
            lastUpdate: lastTs,
          })}
        />
        <KpiCard
          label={t("Peakload (period)", "Peakload (period)")}
          value={fmt(period.peakload ?? NaN)}
          unit="EUR/MWh"
          hint={methodology({
            metric: "Period peakload",
            range: rangeLabel,
            hours: period.hoursCount,
            days: period.completeDaysCount,
            formula: "Mean of daily peakloads (Mon–Fri 08:00–20:00 Europe/Belgrade) over complete days.",
            lastUpdate: lastTs,
          })}
        />
        <KpiCard
          label={t("Negative hours", "Negativni sati")}
          value={period.negHours}
          unit={t("hours", "sati")}
          hint={methodology({
            metric: "Negative price hours",
            range: rangeLabel,
            hours: period.hoursCount,
            days: period.completeDaysCount,
            formula: "Count of hourly DA prices < 0 EUR/MWh in the selected range.",
          })}
        />
        <KpiCard
          label={t("Volatility (σ)", "Volatilnost (σ)")}
          value={fmt(period.sd)}
          unit="EUR/MWh"
          hint={methodology({
            metric: "Volatility",
            range: rangeLabel,
            hours: period.hoursCount,
            days: period.completeDaysCount,
            formula: "Population standard deviation of hourly DA prices in the range.",
          })}
        />
        <KpiCard label={t("Min hour", "Min sat")} value={fmt(period.minHour, 0)} unit="EUR/MWh" />
        <KpiCard label={t("Max hour", "Max sat")} value={fmt(period.maxHour, 0)} unit="EUR/MWh" />
        <KpiCard
          label={t("7-day baseload", "Baseload 7d")}
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
          label={t("30-day baseload", "Baseload 30d")}
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

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title={t("Hourly day-ahead price", "Satna day-ahead cena")}
          description={t("Last 48 hours of SEEPEX-style hourly prices.", "Poslednja 48 sati SEEPEX-style satnih cena.")}
        >
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={last48Chart} margin={{ left: 0, right: 12, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="t" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <RTooltip />
              <ReferenceLine y={0} stroke="var(--color-critical)" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="price" stroke="var(--color-chart-1)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title={t("Daily baseload & peakload (period)", "Dnevni baseload i peakload (period)")}
          description={t("In selected range. Peakload = Mon–Fri 08:00–20:00.", "U izabranom opsegu. Peakload = Pon–Pet 08:00–20:00.")}
        >
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={inRangeDaily}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <RTooltip />
              <Legend />
              <Bar dataKey="baseload" fill="var(--color-chart-1)" name={t("Baseload", "Baseload")} />
              <Bar dataKey="peakload" fill="var(--color-chart-3)" name={t("Peakload", "Peakload")} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title={t("Monthly baseload", "Mesečni baseload")}>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={monthly}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <RTooltip />
              <Line type="monotone" dataKey="baseload" stroke="var(--color-chart-2)" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title={t("Negative price hours per month", "Sati negativnih cena po mesecu")}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={monthly}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <RTooltip />
              <Bar dataKey="negHours" fill="var(--color-critical)" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-card text-sm space-y-2">
        <h3 className="font-display text-lg">{t("Data check & methodology", "Provera podataka i metodologija")}</h3>
        <p className="text-muted-foreground">
          {t(
            "Baseload prices are computed as the simple mean of daily baseloads, where each daily baseload is the simple mean of that day's 24 hourly SEEPEX DA prices in Europe/Belgrade local time. Incomplete days (DST or today-so-far) are excluded so that month-to-date numbers are comparable with exchange-published averages.",
            "Baseload cene se računaju kao prost prosek dnevnih baseload-a, gde je dnevni baseload prost prosek 24 satnih SEEPEX DA cena u lokalnom vremenu Europe/Belgrade. Nepotpuni dani (DST ili tekući dan) se izuzimaju kako bi MTD brojevi bili uporedivi sa zvaničnim prosecima berze.",
          )}
        </p>
        <p className="text-muted-foreground">
          {t(
            "If you see a small gap vs SEEPEX WB — note that SEEPEX WB is a regional Western Balkans reference; this dashboard uses the Serbia bidding zone (EIC 10YCS-SERBIATSOV) directly from ENTSO-E. Hover the info icons on any KPI to see exact range, hours included and last update.",
            "Ako vidite malo odstupanje u odnosu na SEEPEX WB — SEEPEX WB je regionalna referenca Zapadnog Balkana; ova kontrolna tabla koristi srpsku zonu (EIC 10YCS-SERBIATSOV) direktno sa ENTSO-E. Pređite mišem preko info ikonica na KPI-jevima za tačan opseg, sate i poslednje ažuriranje.",
          )}
        </p>
      </div>
    </div>
  );
}
