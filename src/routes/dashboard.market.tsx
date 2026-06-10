import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";
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
} from "recharts";
import { ChartCard, KpiCard } from "@/components/dashboard/atoms";
import { applyRealPrices, getDemoYear } from "@/lib/demo-data";
import { useQuery } from "@tanstack/react-query";
import { fetchMarketPrices } from "@/lib/market.functions";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/market")({
  head: () => ({
    meta: [
      { title: "Market Prices — CEA Power Dashboard" },
      { name: "description", content: "SEEPEX day-ahead prices, baseload, peakload, volatility and negative-price analytics for Serbia." },
      { property: "og:title", content: "Market Prices — CEA Power Dashboard" },
      { property: "og:description", content: "SEEPEX day-ahead prices, baseload, peakload, volatility and negative-price analytics for Serbia." },
      { property: "og:url", content: "https://ceadash.lovable.app/dashboard/market" },
    ],
    links: [{ rel: "canonical", href: "https://ceadash.lovable.app/dashboard/market" }],
  }),
  component: MarketPage,
});

function MarketPage() {
  
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
  const dataMin = useMemo(() => data[0]?.ts ?? new Date(), [data]);
  const dataMax = useMemo(() => data[data.length - 1]?.ts ?? new Date(), [data]);

  const [range, setRange] = useState<DateRange | undefined>(() => {
    const to = dataMax;
    const from = new Date(to);
    from.setDate(from.getDate() - 29);
    return { from, to };
  });
  const [view, setView] = useState<"hourly" | "baseload" | "peakload">("hourly");
  const [negOnly, setNegOnly] = useState(false);
  const [highOnly, setHighOnly] = useState(false);

  const from = range?.from ?? dataMin;
  const to = range?.to ?? range?.from ?? dataMax;
  const rangeLabel =
    range?.from && range?.to
      ? `${format(range.from, "d MMM yyyy")} – ${format(range.to, "d MMM yyyy")}`
      : range?.from
      ? format(range.from, "d MMM yyyy")
      : "Pick a date range";

  const filtered = useMemo(() => {
    const start = new Date(from);
    start.setHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    let pts = data.filter((p) => p.ts >= start && p.ts <= end);
    if (negOnly) pts = pts.filter((p) => p.price < 0);
    if (highOnly) pts = pts.filter((p) => p.price > 150);
    return pts;
  }, [data, from, to, negOnly, highOnly]);

  const setPreset = (days: number) => {
    const end = new Date(dataMax);
    const start = new Date(end);
    start.setDate(start.getDate() - (days - 1));
    setRange({ from: start, to: end });
  };

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

  // Choose hourly vs daily series based on range length
  const rangeDays = Math.max(1, Math.round((+to - +from) / 86400000) + 1);
  const useDaily = view === "baseload" || view === "peakload" || rangeDays > 14;

  const series = useMemo(() => {
    if (!useDaily) {
      return filtered.map((p) => ({
        t: format(p.ts, "dd MMM HH:00"),
        price: +p.price.toFixed(1),
      }));
    }
    const byDay = new Map<string, { sum: number; n: number }>();
    for (const p of filtered) {
      if (view === "peakload") {
        const h = p.ts.getHours();
        const dow = p.ts.getDay();
        if (!(dow >= 1 && dow <= 5 && h >= 8 && h < 20)) continue;
      }
      const key = p.ts.toISOString().slice(0, 10);
      const e = byDay.get(key) ?? { sum: 0, n: 0 };
      e.sum += p.price;
      e.n += 1;
      byDay.set(key, e);
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => ({
        t: format(new Date(k + "T00:00:00"), "dd MMM"),
        price: +(v.sum / Math.max(1, v.n)).toFixed(1),
      }));
  }, [filtered, useDaily, view]);

  // price duration curve
  const sortedDesc = [...filtered].sort((a, b) => b.price - a.price);
  const pdc = sortedDesc.map((p, i) => ({
    pct: +((i / Math.max(1, sortedDesc.length)) * 100).toFixed(1),
    price: +p.price.toFixed(1),
  }));

  // weekday vs weekend
  const wd = filtered.filter((p) => p.ts.getDay() >= 1 && p.ts.getDay() <= 5);
  const we = filtered.filter((p) => p.ts.getDay() === 0 || p.ts.getDay() === 6);
  const wdAvg = wd.length ? wd.reduce((a, b) => a + b.price, 0) / wd.length : 0;
  const weAvg = we.length ? we.reduce((a, b) => a + b.price, 0) / we.length : 0;

  // heatmap: hour x day (within range)
  const heat = useMemo(() => {
    const m: Record<number, Record<string, number[]>> = {};
    for (const p of filtered) {
      const day = format(p.ts, "dd MMM");
      const h = p.ts.getHours();
      m[h] = m[h] || {};
      m[h][day] = m[h][day] || [];
      m[h][day].push(p.price);
    }
    const dayOrder: string[] = [];
    const seen = new Set<string>();
    for (const p of filtered) {
      const day = format(p.ts, "dd MMM");
      if (!seen.has(day)) {
        seen.add(day);
        dayOrder.push(day);
      }
    }
    const cells: { h: number; day: string; v: number }[] = [];
    for (let h = 0; h < 24; h++) {
      for (const day of dayOrder) {
        if (m[h]?.[day]?.length) {
          cells.push({
            h,
            day,
            v: m[h][day].reduce((a, b) => a + b, 0) / m[h][day].length,
          });
        }
      }
    }
    return { cells, dayOrder };
  }, [filtered]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-card">
        <div className="grid gap-4 md:grid-cols-12 items-end">
          <div className="md:col-span-5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Period (day to day)
            </Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "mt-1.5 w-full justify-start text-left font-normal",
                    !range?.from && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {rangeLabel}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="range"
                  selected={range}
                  onSelect={setRange}
                  numberOfMonths={2}
                  defaultMonth={range?.from ?? dataMax}
                  disabled={{ before: dataMin, after: dataMax }}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setPreset(7)}>7d</Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setPreset(30)}>30d</Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setPreset(90)}>90d</Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => setRange({ from: dataMin, to: dataMax })}
              >
                Full year
              </Button>
            </div>
          </div>
          <div className="md:col-span-3">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">View</Label>
            <Select value={view} onValueChange={(v) => setView(v as typeof view)}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hourly">Hourly / daily auto</SelectItem>
                <SelectItem value="baseload">Baseload (daily avg)</SelectItem>
                <SelectItem value="peakload">Peakload (weekday 08–20)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2 flex items-center gap-2">
            <Switch checked={negOnly} onCheckedChange={setNegOnly} id="neg" />
            <Label htmlFor="neg" className="text-sm">Negative only</Label>
          </div>
          <div className="md:col-span-2 flex items-center gap-2">
            <Switch checked={highOnly} onCheckedChange={setHighOnly} id="high" />
            <Label htmlFor="high" className="text-sm">High (&gt;150) only</Label>
          </div>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Period average" value={stats.mean.toFixed(1)} unit="EUR/MWh" demo />
          <KpiCard label="Peakload" value={stats.peak.toFixed(1)} unit="EUR/MWh" demo />
          <KpiCard label="Volatility (σ)" value={stats.sd.toFixed(1)} unit="EUR/MWh" demo />
          <KpiCard label="Min / Max" value={`${stats.min.toFixed(0)} / ${stats.max.toFixed(0)}`} unit="EUR/MWh" demo />
          <KpiCard label="Hours < 0 EUR" value={stats.neg} demo />
          <KpiCard label="Hours < 30 EUR" value={stats.low30} demo />
          <KpiCard label="Hours > 150 EUR" value={stats.high150} demo />
          <KpiCard label="Weekday / Weekend" value={`${wdAvg.toFixed(0)} / ${weAvg.toFixed(0)}`} unit="EUR/MWh" demo />
        </div>
      )}

      <ChartCard title={`Day-ahead price — ${rangeLabel}${useDaily ? " (daily avg)" : ""}`} demo>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={series}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="t"
              tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
              interval={Math.max(0, Math.floor(series.length / 12))}
            />
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
        title="Heatmap — hour of day × day"
        description="Average hourly price per cell across the selected period."
        demo
      >
        <Heatmap cells={heat.cells} days={heat.dayOrder} />
      </ChartCard>
    </div>
  );
}

function Heatmap({ cells, days }: { cells: { h: number; day: string; v: number }[]; days: string[] }) {
  if (!cells.length) return <div className="text-sm text-muted-foreground">No data in selected range</div>;
  const min = Math.min(...cells.map((c) => c.v));
  const max = Math.max(...cells.map((c) => c.v));
  const cellMap = new Map(cells.map((c) => [`${c.h}-${c.day}`, c.v]));
  const colW = days.length > 60 ? 10 : days.length > 31 ? 14 : 18;
  return (
    <div className="overflow-x-auto">
      <div className="inline-grid" style={{ gridTemplateColumns: `48px repeat(${days.length}, ${colW}px)` }}>
        <div />
        {days.map((d) => (
          <div key={d} className="text-[9px] text-center text-muted-foreground truncate">{d}</div>
        ))}
        {Array.from({ length: 24 }, (_, h) => (
          <ContiguousRow key={h} h={h} days={days} min={min} max={max} cellMap={cellMap} colW={colW} />
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
  colW,
}: {
  h: number;
  days: string[];
  min: number;
  max: number;
  cellMap: Map<string, number>;
  colW: number;
}) {
  return (
    <>
      <div className="text-[10px] pr-2 text-right text-muted-foreground">{h.toString().padStart(2, "0")}</div>
      {days.map((d) => {
        const v = cellMap.get(`${h}-${d}`);
        if (v == null) return <div key={d} style={{ width: colW, height: colW }} className="bg-muted/30" />;
        const t = (v - min) / Math.max(0.001, max - min);
        const hue = 130 - t * 130;
        return (
          <div
            key={d}
            style={{ width: colW, height: colW, backgroundColor: `oklch(0.65 0.13 ${hue + 30})` }}
            title={`${v.toFixed(1)} EUR/MWh`}
          />
        );
      })}
    </>
  );
}
