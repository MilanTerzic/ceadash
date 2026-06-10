import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  BarChart,
  Bar,
  ReferenceLine,
  Legend,
} from "recharts";
import { ChartCard, KpiCard } from "@/components/dashboard/atoms";
import { getDemoYear } from "@/lib/demo-data";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/dashboard/market")({
  head: () => ({
    meta: [
      { title: "Market Prices — Serbia RES Dashboard" },
      {
        name: "description",
        content: "SEEPEX day-ahead prices, baseload, peakload, volatility and negative price analytics for Serbia.",
      },
    ],
  }),
  component: MarketPage,
});

function MarketPage() {
  const data = useMemo(() => getDemoYear(), []);
  const months = useMemo(() => {
    const s = new Set<string>();
    for (const p of data) s.add(p.ts.toISOString().slice(0, 7));
    return Array.from(s);
  }, [data]);

  const [month, setMonth] = useState<string>(months[months.length - 1]);
  const [view, setView] = useState<"hourly" | "baseload" | "peakload">("hourly");
  const [negOnly, setNegOnly] = useState(false);
  const [highOnly, setHighOnly] = useState(false);

  const filtered = useMemo(() => {
    let pts = data.filter((p) => p.ts.toISOString().slice(0, 7) === month);
    if (negOnly) pts = pts.filter((p) => p.price < 0);
    if (highOnly) pts = pts.filter((p) => p.price > 150);
    return pts;
  }, [data, month, negOnly, highOnly]);

  const stats = useMemo(() => {
    const prices = filtered.map((p) => p.price);
    if (!prices.length) return null;
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const variance = prices.reduce((a, b) => a + (b - mean) ** 2, 0) / prices.length;
    const sd = Math.sqrt(variance);
    const peakHours = filtered.filter((p) => {
      const h = p.ts.getHours();
      const dow = p.ts.getDay();
      return dow >= 1 && dow <= 5 && h >= 8 && h < 20;
    });
    const peak = peakHours.length
      ? peakHours.reduce((a, b) => a + b.price, 0) / peakHours.length
      : 0;
    return {
      mean,
      min,
      max,
      sd,
      peak,
      neg: prices.filter((p) => p < 0).length,
      low30: prices.filter((p) => p < 30).length,
      high150: prices.filter((p) => p > 150).length,
    };
  }, [filtered]);

  const seriesHourly = filtered.map((p) => ({
    t: p.ts.toISOString().slice(5, 13),
    price: +p.price.toFixed(1),
  }));

  // price duration curve
  const sortedDesc = [...filtered].sort((a, b) => b.price - a.price);
  const pdc = sortedDesc.map((p, i) => ({
    pct: +((i / sortedDesc.length) * 100).toFixed(1),
    price: +p.price.toFixed(1),
  }));

  // weekday vs weekend
  const wd = filtered.filter((p) => p.ts.getDay() >= 1 && p.ts.getDay() <= 5);
  const we = filtered.filter((p) => p.ts.getDay() === 0 || p.ts.getDay() === 6);
  const wdAvg = wd.length ? wd.reduce((a, b) => a + b.price, 0) / wd.length : 0;
  const weAvg = we.length ? we.reduce((a, b) => a + b.price, 0) / we.length : 0;

  // hour x day-of-month heatmap → render simple grid
  const heat = useMemo(() => {
    const m: Record<number, Record<number, number[]>> = {};
    for (const p of data.filter((d) => d.ts.toISOString().slice(0, 7) === month)) {
      const day = p.ts.getDate();
      const h = p.ts.getHours();
      m[h] = m[h] || {};
      m[h][day] = m[h][day] || [];
      m[h][day].push(p.price);
    }
    const cells: { h: number; day: number; v: number }[] = [];
    for (let h = 0; h < 24; h++) {
      for (let day = 1; day <= 31; day++) {
        if (m[h]?.[day]?.length) {
          cells.push({
            h,
            day,
            v: m[h][day].reduce((a, b) => a + b, 0) / m[h][day].length,
          });
        }
      }
    }
    return cells;
  }, [data, month]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-card">
        <div className="grid gap-4 md:grid-cols-4 items-end">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Month</Label>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">View</Label>
            <Select value={view} onValueChange={(v) => setView(v as typeof view)}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hourly">Hourly</SelectItem>
                <SelectItem value="baseload">Baseload (daily)</SelectItem>
                <SelectItem value="peakload">Peakload (weekday 08–20)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={negOnly} onCheckedChange={setNegOnly} id="neg" />
            <Label htmlFor="neg" className="text-sm">Negative price hours only</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={highOnly} onCheckedChange={setHighOnly} id="high" />
            <Label htmlFor="high" className="text-sm">High-price hours only (&gt;150)</Label>
          </div>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Monthly average" value={stats.mean.toFixed(1)} unit="EUR/MWh" demo />
          <KpiCard label="Peakload" value={stats.peak.toFixed(1)} unit="EUR/MWh" demo />
          <KpiCard label="Volatility (σ)" value={stats.sd.toFixed(1)} unit="EUR/MWh" demo />
          <KpiCard label="Min / Max" value={`${stats.min.toFixed(0)} / ${stats.max.toFixed(0)}`} unit="EUR/MWh" demo />
          <KpiCard label="Hours < 0 EUR" value={stats.neg} demo />
          <KpiCard label="Hours < 30 EUR" value={stats.low30} demo />
          <KpiCard label="Hours > 150 EUR" value={stats.high150} demo />
          <KpiCard label="Weekday / Weekend" value={`${wdAvg.toFixed(0)} / ${weAvg.toFixed(0)}`} unit="EUR/MWh" demo />
        </div>
      )}

      <ChartCard title={`Hourly day-ahead — ${month}`} demo>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={seriesHourly}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="t" tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} interval={47} />
            <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
            <ReferenceLine y={0} stroke="var(--color-critical)" strokeDasharray="4 4" />
            <RTooltip />
            <Line type="monotone" dataKey="price" stroke="var(--color-chart-1)" strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Price duration curve"
          description="Hours sorted from highest to lowest price. Steep tails indicate scarcity and surplus events."
          demo
        >
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={pdc}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="pct" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} unit="%" />
              <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <ReferenceLine y={0} stroke="var(--color-critical)" strokeDasharray="4 4" />
              <RTooltip />
              <Line type="monotone" dataKey="price" stroke="var(--color-chart-4)" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Weekday vs weekend average" demo>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={[{ name: "Weekday", value: +wdAvg.toFixed(1) }, { name: "Weekend", value: +weAvg.toFixed(1) }]}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <RTooltip />
              <Bar dataKey="value" fill="var(--color-chart-2)" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <ChartCard
        title="Heatmap — hour of day × day of month"
        description="Average hourly price per cell. Darker = lower price."
        demo
      >
        <Heatmap cells={heat} />
      </ChartCard>
    </div>
  );
}

function Heatmap({ cells }: { cells: { h: number; day: number; v: number }[] }) {
  if (!cells.length) return <div className="text-sm text-muted-foreground">No data</div>;
  const min = Math.min(...cells.map((c) => c.v));
  const max = Math.max(...cells.map((c) => c.v));
  const days = Array.from(new Set(cells.map((c) => c.day))).sort((a, b) => a - b);
  const cellMap = new Map(cells.map((c) => [`${c.h}-${c.day}`, c.v]));
  return (
    <div className="overflow-x-auto">
      <div className="inline-grid" style={{ gridTemplateColumns: `48px repeat(${days.length}, 18px)` }}>
        <div />
        {days.map((d) => (
          <div key={d} className="text-[9px] text-center text-muted-foreground">{d}</div>
        ))}
        {Array.from({ length: 24 }, (_, h) => (
          <ContiguousRow key={h} h={h} days={days} min={min} max={max} cellMap={cellMap} />
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
        <span>{min.toFixed(0)}</span>
        <div className="h-2 w-40 rounded" style={{ background: "linear-gradient(90deg, var(--color-chart-1), var(--color-chart-3), var(--color-critical))" }} />
        <span>{max.toFixed(0)} EUR/MWh</span>
      </div>
    </div>
  );
}

function ContiguousRow({
  h,
  days,
  min,
  max,
  cellMap,
}: {
  h: number;
  days: number[];
  min: number;
  max: number;
  cellMap: Map<string, number>;
}) {
  return (
    <>
      <div className="text-[10px] pr-2 text-right text-muted-foreground">{h.toString().padStart(2, "0")}</div>
      {days.map((d) => {
        const v = cellMap.get(`${h}-${d}`);
        if (v == null) return <div key={d} className="h-4 w-4 bg-muted/30" />;
        const t = (v - min) / Math.max(0.001, max - min);
        // green -> amber -> red
        const hue = 130 - t * 130;
        return (
          <div
            key={d}
            className="h-4 w-4"
            title={`${v.toFixed(1)} EUR/MWh`}
            style={{ backgroundColor: `oklch(0.65 0.13 ${hue + 30})` }}
          />
        );
      })}
    </>
  );
}
