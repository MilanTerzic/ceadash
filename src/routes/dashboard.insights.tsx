import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { ChartCard, SignalPill } from "@/components/dashboard/atoms";
import { captureMetricsByMonth, getDemoYear } from "@/lib/demo-data";

export const Route = createFileRoute("/dashboard/insights")({
  head: () => ({
    meta: [
      { title: "Market Insights — CEA Power Dashboard" },
      { name: "description", content: "Analytical insights on renewable energy market signals, capture rates and storage opportunities in Serbia." },
      { property: "og:title", content: "Market Insights — CEA Power Dashboard" },
      { property: "og:description", content: "Analytical insights on renewable energy market signals, capture rates and storage opportunities in Serbia." },
      { property: "og:url", content: "https://dashboard.cea.org.rs/dashboard/insights" },
    ],
    links: [{ rel: "canonical", href: "https://dashboard.cea.org.rs/dashboard/insights" }],
  }),
  component: InsightsPage,
});

type Signal = "Positive" | "Neutral" | "Warning" | "Critical";

function InsightsPage() {
  const data = useMemo(() => getDemoYear(), []);
  const monthly = useMemo(() => captureMetricsByMonth(data), [data]);
  const latest = monthly[monthly.length - 1];
  const prev = monthly[monthly.length - 2];

  const insights: { title: string; text: string; metric: string; signal: Signal }[] = [
    {
      title: "Solar capture price below baseload",
      text: "Solar production is increasingly concentrated in hours with lower market prices. This reduces realised merchant revenue compared with the simple baseload market average.",
      metric: `Solar capture: ${latest.solarCapture.toFixed(1)} €/MWh vs baseload ${latest.baseload.toFixed(1)} €/MWh`,
      signal: latest.solarRate < 0.85 ? "Warning" : "Neutral",
    },
    {
      title: "Negative prices emerging as a real market signal",
      text: "Negative prices on SEEPEX are now technically possible and have already occurred. Solar projects with high merchant exposure should model negative-price curtailment and downside scenarios.",
      metric: `${latest.negHours} negative-price hours last month`,
      signal: latest.negHours > 20 ? "Critical" : latest.negHours > 5 ? "Warning" : "Neutral",
    },
    {
      title: "Midday price depression intensifying",
      text: "The midday solar-driven dip in prices is becoming more pronounced, particularly in spring. Storage and demand-shifting can monetise the spread.",
      metric: "Avg midday price 30–40% below baseload",
      signal: "Warning",
    },
    {
      title: "Evening peak premium remains strong",
      text: "Evening hours (18:00–21:00) consistently price above baseload, sustaining the business case for batteries with 2–4 hour duration.",
      metric: "Evening peak premium +25–40 €/MWh",
      signal: "Positive",
    },
    {
      title: "Battery storage opportunity",
      text: "The widening intraday spread between midday lows and evening highs supports the economics of co-located solar + battery configurations.",
      metric: "Avg daily spread > 60 €/MWh",
      signal: "Positive",
    },
    {
      title: "Wind capture rate above solar",
      text: "Wind generation in Serbia is more evenly distributed across hours than solar, resulting in a relatively higher capture rate and lower cannibalisation risk.",
      metric: `Wind: ${(latest.windRate * 100).toFixed(0)}% vs Solar: ${(latest.solarRate * 100).toFixed(0)}%`,
      signal: "Neutral",
    },
    {
      title: "Merchant risk for solar elevated",
      text: "Greenfield merchant solar carries meaningful price risk. PPA structures or hybrid arrangements significantly improve bankability.",
      metric: `Capture rate trending ${latest.solarRate < prev.solarRate ? "down" : "up"}`,
      signal: latest.solarRate < 0.8 ? "Critical" : "Warning",
    },
    {
      title: "Importance of PPA structures",
      text: "Pay-as-produced PPAs absorb merchant exposure but reflect the capture-price discount. Fixed-volume PPAs allocate shape risk to the offtaker.",
      metric: "PPA price ≈ capture price + risk premium",
      signal: "Neutral",
    },
    {
      title: "Curtailment & grid connection risk",
      text: "Grid connection bottlenecks and curtailment instructions are an increasing concern for new RES plants in Serbia. Site selection should include grid headroom analysis.",
      metric: "Assumed curtailment 2–5%",
      signal: "Warning",
    },
    {
      title: "Realised price vs technology gap",
      text: "Tech-specific realised prices diverge meaningfully from the baseload market average. Investment cases must use capture prices, not simple averages.",
      metric: `Gap: ${(latest.baseload - latest.solarCapture).toFixed(1)} €/MWh (solar)`,
      signal: "Warning",
    },
    {
      title: "Prosumer & active customer growth",
      text: "Regulatory framework for prosumers and active customers continues to evolve. This shapes the addressable market for aggregators and behind-the-meter solar.",
      metric: "Prosumer share growing y/y",
      signal: "Positive",
    },
    {
      title: "Regulatory developments to watch",
      text: "Auctions for RES, balancing market integration with EU, and Energy Community alignment will materially affect risk-adjusted returns.",
      metric: "Multiple framework updates pending",
      signal: "Neutral",
    },
  ];

  return (
    <ChartCard
      title="Key analytical insights"
      description="Short, actionable signals automatically derived from current market data."
    >
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {insights.map((i) => (
          <article key={i.title} className="rounded-xl border border-border/70 bg-background/40 p-4">
            <div className="flex items-start justify-between gap-2">
              <h4 className="font-display text-lg leading-tight">{i.title}</h4>
              <SignalPill signal={i.signal} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{i.text}</p>
            <div className="mt-3 text-xs uppercase tracking-wider text-foreground/80">{i.metric}</div>
          </article>
        ))}
      </div>
    </ChartCard>
  );
}
