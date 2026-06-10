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
import {
  applyRealPrices,
  captureMetricsByMonth,
  getDemoYear,
  getRecentDays,
  monthlyAvg,
} from "@/lib/demo-data";
import { fetchMarketPrices } from "@/lib/market.functions";

export const Route = createFileRoute("/dashboard/")({
  head: () => ({
    meta: [
      { title: "Overview — Serbia RES Market Dashboard" },
      { name: "description", content: "Key Serbian power market and RES indicators at a glance." },
    ],
  }),
  component: OverviewPage,
});

const fmt = (n: number, d = 1) => (isFinite(n) ? n.toFixed(d) : "—");

function OverviewPage() {
  const live = useQuery({
    queryKey: ["market-prices"],
    queryFn: () => fetchMarketPrices(),
    staleTime: 60 * 60_000,
  });
  const hasReal = (live.data?.points?.length ?? 0) > 0;
  const data = useMemo(
    () => applyRealPrices(getDemoYear(), live.data?.points ?? []),
    [live.data],
  );
  const last30 = useMemo(() => getRecentDays(30, data), [data]);
  const last7 = useMemo(() => getRecentDays(7, data), [data]);

  const latest = data[data.length - 1];
  const baseload7 = last7.reduce((a, b) => a + b.price, 0) / last7.length;
  const baseload30 = last30.reduce((a, b) => a + b.price, 0) / last30.length;
  const peakHours = (d: typeof data) =>
    d.filter((p) => {
      const h = p.ts.getHours();
      const dow = p.ts.getDay();
      return dow >= 1 && dow <= 5 && h >= 8 && h < 20;
    });
  const peak7 = peakHours(last7);
  const peakloadLatest =
    peak7.length > 0 ? peak7.reduce((a, b) => a + b.price, 0) / peak7.length : 0;

  // Current month
  const cm = latest.ts.toISOString().slice(0, 7);
  const monthHours = data.filter((p) => p.ts.toISOString().slice(0, 7) === cm);
  const negCount = monthHours.filter((p) => p.price < 0).length;
  const negShare = (negCount / monthHours.length) * 100;
  const monthSumP = monthHours.reduce((a, b) => a + b.price, 0);
  const monthBaseload = monthSumP / monthHours.length;
  const solarNum = monthHours.reduce((a, b) => a + b.price * b.solar, 0);
  const solarDen = monthHours.reduce((a, b) => a + b.solar, 0);
  const windNum = monthHours.reduce((a, b) => a + b.price * b.wind, 0);
  const windDen = monthHours.reduce((a, b) => a + b.wind, 0);
  const solarCapture = solarDen > 0 ? solarNum / solarDen : 0;
  const windCapture = windDen > 0 ? windNum / windDen : 0;

  const monthly = useMemo(() => monthlyAvg(data, "price"), [data]);
  const captureMonthly = useMemo(() => captureMetricsByMonth(data), [data]);

  const last48Chart = last7.slice(-48).map((p) => ({
    t: p.ts.toISOString().slice(5, 16).replace("T", " "),
    price: +p.price.toFixed(1),
  }));

  const dailyBaseloadPeakload = useMemo(() => {
    const m = new Map<string, { base: number[]; peak: number[] }>();
    for (const p of last30) {
      const k = p.ts.toISOString().slice(0, 10);
      if (!m.has(k)) m.set(k, { base: [], peak: [] });
      m.get(k)!.base.push(p.price);
      const h = p.ts.getHours();
      const dow = p.ts.getDay();
      if (dow >= 1 && dow <= 5 && h >= 8 && h < 20) m.get(k)!.peak.push(p.price);
    }
    return Array.from(m.entries()).map(([day, v]) => ({
      day: day.slice(5),
      baseload: +(v.base.reduce((a, b) => a + b, 0) / v.base.length).toFixed(1),
      peakload: v.peak.length
        ? +(v.peak.reduce((a, b) => a + b, 0) / v.peak.length).toFixed(1)
        : null,
    }));
  }, [last30]);

  const negByMonth = useMemo(
    () =>
      captureMonthly.map((c) => ({
        month: c.month.slice(5),
        negHours: c.negHours,
      })),
    [captureMonthly],
  );

  return (
    <div className="space-y-8">
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        <KpiCard
          label="Latest baseload"
          hint="Latest hourly SEEPEX day-ahead price (demo)."
          value={fmt(latest.price)}
          unit="EUR/MWh"
          demo
        />
        <KpiCard
          label="Latest peakload"
          hint="Average of weekday hours 08:00–20:00 over the last 7 days."
          value={fmt(peakloadLatest)}
          unit="EUR/MWh"
          demo
        />
        <KpiCard label="7-day avg" value={fmt(baseload7)} unit="EUR/MWh" demo />
        <KpiCard label="30-day avg" value={fmt(baseload30)} unit="EUR/MWh" demo />
        <KpiCard
          label="Neg. hours (MTD)"
          hint="Hours with SEEPEX price < 0 EUR/MWh this month."
          value={negCount}
          unit="hours"
          demo
        />
        <KpiCard
          label="Neg. share (MTD)"
          value={fmt(negShare)}
          unit="%"
          demo
        />
        <KpiCard
          label="Solar capture price"
          hint="Σ(price × solar) ÷ Σ(solar) for the current month."
          value={fmt(solarCapture)}
          unit="EUR/MWh"
          demo
        />
        <KpiCard
          label="Wind capture price"
          value={fmt(windCapture)}
          unit="EUR/MWh"
          demo
        />
        <KpiCard
          label="Solar capture rate"
          hint="Solar capture price ÷ baseload price."
          value={`${fmt((solarCapture / monthBaseload) * 100)}%`}
          demo
        />
        <KpiCard
          label="Wind capture rate"
          value={`${fmt((windCapture / monthBaseload) * 100)}%`}
          demo
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Hourly day-ahead price"
          description="Last 48 hours of SEEPEX-style hourly prices."
          demo
        >
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={last48Chart} margin={{ left: 0, right: 12, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="t" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} unit="" />
              <RTooltip />
              <ReferenceLine y={0} stroke="var(--color-critical)" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="price" stroke="var(--color-chart-1)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Daily baseload & peakload"
          description="Last 30 days. Peakload = weekday 08:00–20:00 average."
          demo
        >
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={dailyBaseloadPeakload}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <RTooltip />
              <Legend />
              <Bar dataKey="baseload" fill="var(--color-chart-1)" name="Baseload" />
              <Bar dataKey="peakload" fill="var(--color-chart-3)" name="Peakload" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Monthly average price" demo>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={monthly.map((m) => ({ month: m.month.slice(5), value: +m.value.toFixed(1) }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <RTooltip />
              <Line type="monotone" dataKey="value" stroke="var(--color-chart-2)" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Negative price hours per month" demo>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={negByMonth}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <RTooltip />
              <Bar dataKey="negHours" fill="var(--color-critical)" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <ChartCard
        title="Solar & wind capture price vs baseload"
        description="Monthly comparison illustrating RES cannibalisation. Capture rate below 100% means realised price is lower than the market average."
        demo
      >
        <ResponsiveContainer width="100%" height={320}>
          <LineChart
            data={captureMonthly.map((c) => ({
              month: c.month.slice(5),
              baseload: +c.baseload.toFixed(1),
              solar: +c.solarCapture.toFixed(1),
              wind: +c.windCapture.toFixed(1),
            }))}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
            <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
            <RTooltip />
            <Legend />
            <Line type="monotone" dataKey="baseload" stroke="var(--color-chart-5)" strokeWidth={2} name="Baseload" />
            <Line type="monotone" dataKey="solar" stroke="var(--color-chart-3)" strokeWidth={2} name="Solar capture" />
            <Line type="monotone" dataKey="wind" stroke="var(--color-chart-2)" strokeWidth={2} name="Wind capture" />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
