import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
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
import { ChartCard, KpiCard } from "@/components/dashboard/atoms";
import { captureMetricsByMonth, getDemoYear } from "@/lib/demo-data";

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

function CapturePage() {
  const data = useMemo(() => getDemoYear(), []);
  const monthly = useMemo(() => captureMetricsByMonth(data), [data]);
  const latest = monthly[monthly.length - 1];

  // average hourly profile vs avg price profile
  const hourly = useMemo(() => {
    const buckets: { p: number[]; s: number[]; w: number[] }[] = Array.from({ length: 24 }, () => ({
      p: [],
      s: [],
      w: [],
    }));
    for (const pt of data) {
      const h = pt.ts.getHours();
      buckets[h].p.push(pt.price);
      buckets[h].s.push(pt.solar);
      buckets[h].w.push(pt.wind);
    }
    return buckets.map((b, h) => ({
      h,
      price: +(b.p.reduce((a, x) => a + x, 0) / b.p.length).toFixed(1),
      solar: +(b.s.reduce((a, x) => a + x, 0) / b.s.length).toFixed(3),
      wind: +(b.w.reduce((a, x) => a + x, 0) / b.w.length).toFixed(3),
    }));
  }, [data]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Solar capture price (last month)"
          hint="Σ(price × solar generation) ÷ Σ(solar generation)"
          value={latest.solarCapture.toFixed(1)}
          unit="EUR/MWh"
          demo
        />
        <KpiCard
          label="Wind capture price (last month)"
          value={latest.windCapture.toFixed(1)}
          unit="EUR/MWh"
          demo
        />
        <KpiCard
          label="Solar capture rate"
          value={`${(latest.solarRate * 100).toFixed(1)}%`}
          demo
        />
        <KpiCard
          label="Wind capture rate"
          value={`${(latest.windRate * 100).toFixed(1)}%`}
          demo
        />
        <KpiCard
          label="Solar in negative hours"
          hint="Share of monthly solar generation produced during hours with price < 0."
          value={`${(latest.solarNegShare * 100).toFixed(2)}%`}
          demo
        />
        <KpiCard
          label="Wind in negative hours"
          value={`${(latest.windNegShare * 100).toFixed(2)}%`}
          demo
        />
        <KpiCard
          label="Solar vs baseload"
          value={`${(latest.solarCapture - latest.baseload).toFixed(1)}`}
          unit="EUR/MWh"
          demo
        />
        <KpiCard
          label="Wind vs baseload"
          value={`${(latest.windCapture - latest.baseload).toFixed(1)}`}
          unit="EUR/MWh"
          demo
        />
      </div>

      <ChartCard
        title="Monthly capture price vs baseload"
        description="Capture price below the baseload line indicates RES cannibalisation: the technology earns less than the simple market average."
        demo
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
        <ChartCard title="Capture rate trend" description="Capture price ÷ baseload price." demo>
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
          title="Solar share of generation in negative hours"
          description="Higher bars = more downside exposure for merchant solar."
          demo
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
          title="Average hourly solar profile vs price"
          description="Solar peaks at midday — exactly when price tends to be depressed."
          demo
        >
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={hourly}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="h" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <YAxis yAxisId="l" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <RTooltip />
              <Legend />
              <Area yAxisId="r" type="monotone" dataKey="solar" stroke="var(--color-chart-3)" fill="var(--color-chart-3)" fillOpacity={0.25} name="Solar MWh/MW" />
              <Line yAxisId="l" type="monotone" dataKey="price" stroke="var(--color-chart-1)" name="Price" />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Average hourly wind profile vs price"
          description="Wind has a flatter profile with a mild evening boost in this estimate."
          demo
        >
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={hourly}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="h" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <YAxis yAxisId="l" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <RTooltip />
              <Legend />
              <Area yAxisId="r" type="monotone" dataKey="wind" stroke="var(--color-chart-2)" fill="var(--color-chart-2)" fillOpacity={0.2} name="Wind MWh/MW" />
              <Line yAxisId="l" type="monotone" dataKey="price" stroke="var(--color-chart-1)" name="Price" />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}

// Unused but kept for tree-shake safety
const _u = AreaChart;
void _u;
