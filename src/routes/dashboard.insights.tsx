import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ChartCard, SignalPill } from "@/components/dashboard/atoms";
import { belgradeDayKey } from "@/lib/baseload";
import { fetchCaptureSeries, type CapturePoint } from "@/lib/capture.functions";
import { getEkapijaNews } from "@/lib/news.functions";

export const Route = createFileRoute("/dashboard/insights")({
  head: () => ({
    meta: [
      { title: "Market Insights — CEA Power Dashboard" },
      {
        name: "description",
        content:
          "Live analytical indicators for Serbian day-ahead prices, renewable capture and flexibility.",
      },
      { property: "og:title", content: "Market Insights — CEA Power Dashboard" },
      {
        property: "og:description",
        content:
          "Live analytical indicators for Serbian day-ahead prices, renewable capture and flexibility.",
      },
      { property: "og:url", content: "https://dashboard.cea.org.rs/dashboard/insights" },
    ],
    links: [{ rel: "canonical", href: "https://dashboard.cea.org.rs/dashboard/insights" }],
  }),
  component: InsightsPage,
});

type Signal = "Positive" | "Neutral" | "Warning" | "Critical";

function dayISO(offset = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function hour(ts: string) {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Belgrade",
      hour: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date(ts))
      .find((p) => p.type === "hour")?.value ?? "0",
  );
}

function mean(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function compute(points: CapturePoint[]) {
  const valid = points.filter((p) => Number.isFinite(p.price));
  const baseload = mean(valid.map((p) => p.price));
  let solarValue = 0;
  let solarGen = 0;
  let windValue = 0;
  let windGen = 0;
  const midday: number[] = [];
  const evening: number[] = [];
  const byDay = new Map<string, number[]>();

  for (const p of valid) {
    const h = hour(p.ts);
    if (h >= 11 && h < 16) midday.push(p.price);
    if (h >= 18 && h < 22) evening.push(p.price);
    const solar = p.solar > 0 ? p.solar : 0;
    const wind = p.wind > 0 ? p.wind : 0;
    solarValue += p.price * solar;
    solarGen += solar;
    windValue += p.price * wind;
    windGen += wind;
    const key = belgradeDayKey(new Date(p.ts));
    const arr = byDay.get(key) ?? [];
    arr.push(p.price);
    byDay.set(key, arr);
  }

  const solarCapture = solarGen > 0 ? solarValue / solarGen : null;
  const windCapture = windGen > 0 ? windValue / windGen : null;
  const solarRate = baseload && solarCapture != null ? solarCapture / baseload : null;
  const windRate = baseload && windCapture != null ? windCapture / baseload : null;
  const middayAvg = mean(midday);
  const eveningAvg = mean(evening);
  const dailyRange: number[] = [];
  const bess: number[] = [];

  for (const prices of byDay.values()) {
    if (prices.length < 20) continue;
    const sorted = [...prices].sort((a, b) => a - b);
    dailyRange.push(sorted.at(-1)! - sorted[0]);
    const charge = (sorted[0] + sorted[1]) / 2;
    const discharge = (sorted.at(-1)! + sorted.at(-2)!) / 2;
    bess.push(discharge * 0.85 - charge);
  }

  return {
    baseload,
    solarCapture,
    windCapture,
    solarRate,
    windRate,
    negHours: valid.filter((p) => p.price < 0).length,
    middayAvg,
    middayDelta: baseload && middayAvg != null ? (middayAvg - baseload) / Math.abs(baseload) : null,
    eveningPremium: baseload != null && eveningAvg != null ? eveningAvg - baseload : null,
    avgRange: mean(dailyRange),
    bessNet2h: mean(bess),
    completeDays: dailyRange.length,
  };
}

function fmt(v: number | null, digits = 1) {
  return v == null || !Number.isFinite(v) ? "N/A" : v.toFixed(digits);
}

function pct(v: number | null) {
  return v == null || !Number.isFinite(v) ? "N/A" : `${(v * 100).toFixed(0)}%`;
}

function InsightsPage() {
  const newsFn = useServerFn(getEkapijaNews);
  const newsQuery = useQuery({
    queryKey: ["signals_news_policy"],
    queryFn: () => newsFn(),
    refetchInterval: 30 * 60 * 1000,
    staleTime: 15 * 60 * 1000,
    retry: 1,
  });

  const from = dayISO(-30);
  const to = dayISO(1);
  const liveQuery = useQuery({
    queryKey: ["live-market-indicators", from, to],
    queryFn: () => fetchCaptureSeries({ data: { from, to } }),
    refetchInterval: 30 * 60 * 1000,
    staleTime: 15 * 60 * 1000,
    retry: 1,
  });
  const points = liveQuery.data?.points ?? [];
  const metrics = useMemo(() => compute(points), [points]);
  const lastTs = points.at(-1)?.ts;

  const indicators: { title: string; text: string; metric: string; signal: Signal }[] = [
    {
      title: "Solar capture vs baseload",
      text: "Shows the realised solar-profile price relative to Serbian day-ahead baseload in the rolling 30-day window.",
      metric: `Solar ${fmt(metrics.solarCapture)} €/MWh · capture rate ${pct(metrics.solarRate)}`,
      signal: metrics.solarRate == null ? "Neutral" : metrics.solarRate < 0.75 ? "Critical" : metrics.solarRate < 0.9 ? "Warning" : "Neutral",
    },
    {
      title: "Negative-price hours",
      text: "Counts observed Serbian day-ahead hours below zero in the rolling 30-day window.",
      metric: `${metrics.negHours} hours below 0 €/MWh`,
      signal: metrics.negHours > 20 ? "Critical" : metrics.negHours > 5 ? "Warning" : "Neutral",
    },
    {
      title: "Midday discount",
      text: "Compares the 11:00–16:00 average with baseload to quantify the midday price dip.",
      metric: `${fmt(metrics.middayAvg)} €/MWh · ${pct(metrics.middayDelta)} vs baseload`,
      signal: metrics.middayDelta == null ? "Neutral" : metrics.middayDelta < -0.3 ? "Critical" : metrics.middayDelta < -0.15 ? "Warning" : "Neutral",
    },
    {
      title: "Evening premium",
      text: "Compares 18:00–22:00 prices with baseload to quantify the evening premium.",
      metric: `${fmt(metrics.eveningPremium)} €/MWh above baseload`,
      signal: metrics.eveningPremium != null && metrics.eveningPremium > 10 ? "Positive" : "Neutral",
    },
    {
      title: "BESS 2h net spread",
      text: "Ex-post two-hour price spread using the two cheapest and two most expensive hours of each complete day at 85% round-trip efficiency.",
      metric: `${fmt(metrics.bessNet2h)} €/MWh · ${metrics.completeDays} complete days`,
      signal: metrics.bessNet2h != null && metrics.bessNet2h > 30 ? "Positive" : "Neutral",
    },
    {
      title: "Wind vs solar capture",
      text: "Compares technology-specific capture rates to show how production shape affects realised market prices.",
      metric: `Wind ${pct(metrics.windRate)} · Solar ${pct(metrics.solarRate)}`,
      signal: metrics.windRate != null && metrics.solarRate != null && metrics.windRate - metrics.solarRate > 0.1 ? "Positive" : "Neutral",
    },
    {
      title: "Intraday price range",
      text: "Average complete-day maximum minus minimum price over the rolling window.",
      metric: `${fmt(metrics.avgRange)} €/MWh average daily range`,
      signal: metrics.avgRange != null && metrics.avgRange > 45 ? "Positive" : "Neutral",
    },
  ];

  return (
    <div className="space-y-6">
      <ChartCard
        title="Live analytical indicators"
        description="Rules-based metrics calculated from the latest rolling 30-day Serbian day-ahead and renewable capture dataset."
        right={
          <button
            type="button"
            onClick={() => liveQuery.refetch()}
            className="min-h-9 rounded-md border border-border/70 px-3 text-xs text-foreground hover:bg-muted"
          >
            Refresh
          </button>
        }
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-background/40 p-3 text-xs text-muted-foreground">
          <span>
            Source: Serbian DA prices + ENTSO-E generation where available
            {liveQuery.data?.solarSource === "modelled" ? " · solar profile modelled where B16 is unavailable" : ""}
          </span>
          <span>
            {liveQuery.isFetching ? "Refreshing…" : lastTs ? `Data through ${new Date(lastTs).toLocaleString("en-GB", { timeZone: "Europe/Belgrade" })}` : "No live timestamp"}
          </span>
        </div>

        {liveQuery.isLoading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading live indicators...</p>
        ) : points.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Live market data is currently unavailable. Demo values are not substituted.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {indicators.map((i) => (
              <article key={i.title} className="rounded-xl border border-border/70 bg-background/40 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="font-display text-lg leading-tight">{i.title}</h4>
                  <SignalPill signal={i.signal} />
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{i.text}</p>
                <div className="mt-3 text-xs font-medium uppercase tracking-wider text-foreground/80">{i.metric}</div>
              </article>
            ))}
          </div>
        )}
      </ChartCard>

      <ChartCard
        title="News and policy monitor"
        description="Automatically refreshes recent Serbian energy news and policy items from the configured public source."
      >
        <div className="mb-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>Refreshes every 30 minutes while this page is open.</span>
          <button
            type="button"
            onClick={() => newsQuery.refetch()}
            className="min-h-9 rounded-md border border-border/70 px-3 text-foreground hover:bg-muted"
          >
            Refresh
          </button>
        </div>
        {newsQuery.isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading news...</p>
        ) : (newsQuery.data?.items ?? []).length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            News source is currently unavailable or returned no items.
          </p>
        ) : (
          <div className="divide-y divide-border/60">
            {(newsQuery.data?.items ?? []).slice(0, 10).map((item) => (
              <a
                key={item.original_url}
                href={item.original_url}
                target="_blank"
                rel="noreferrer"
                className="block py-3 hover:bg-muted/40"
              >
                <div className="text-sm font-medium">{item.summary_en || item.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {item.date} - {item.source}
                </div>
              </a>
            ))}
          </div>
        )}
      </ChartCard>
    </div>
  );
}
