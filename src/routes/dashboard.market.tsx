import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { format } from "date-fns";
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
import { useQuery } from "@tanstack/react-query";
import { fetchMarketPrices } from "@/lib/market.functions";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLang } from "@/lib/i18n";
import { DateRangeControl, useDashboardRange, useRequestedRangeKeys } from "@/components/dashboard/DateRangeControl";
import { DataStatusBanner } from "@/components/dashboard/DataStatusBanner";
import {
  bucketByBelgradeDay,
  aggregatePeriod,
  belgradeDayKey,
  isBelgradePeakHour,
  type HourlyPrice,
} from "@/lib/baseload";

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
  const { t } = useLang();

  const requestedRange = useRequestedRangeKeys();
  const live = useQuery({
    queryKey: ["market-prices", requestedRange.fromKey, requestedRange.toKey, requestedRange.preset],
    queryFn: () => fetchMarketPrices({ data: { from: requestedRange.fromKey, to: requestedRange.toKey } }),
    staleTime: 60 * 60_000,
  });
  const hasReal = (live.data?.points?.length ?? 0) > 0;

  const data = useMemo<HourlyPrice[]>(
    () => (live.data?.points ?? []).map((p) => ({ ts: new Date(p.ts), price: p.price })),
    [live.data],
  );

  const buckets = useMemo(() => bucketByBelgradeDay(data), [data]);
  const completeDays = useMemo(() => buckets.filter((b) => b.complete), [buckets]);
  const firstAvailable = completeDays[0]?.date;
  const latestAvailable = completeDays[completeDays.length - 1]?.date;
  const lastTs = data[data.length - 1]?.ts;

  const { fromKey, toKey, range } = useDashboardRange({ firstAvailable, latestAvailable });

  const [view, setView] = useState<"hourly" | "baseload" | "peakload">("hourly");
  const [negOnly, setNegOnly] = useState(false);
  const [highOnly, setHighOnly] = useState(false);

  const inRangePoints = useMemo(() => {
    let pts = data.filter((p) => {
      const k = belgradeDayKey(p.ts);
      return (!fromKey || k >= fromKey) && (!toKey || k <= toKey);
    });
    if (negOnly) pts = pts.filter((p) => p.price < 0);
    if (highOnly) pts = pts.filter((p) => p.price > 150);
    return pts;
  }, [data, fromKey, toKey, negOnly, highOnly]);

  const period = useMemo(() => aggregatePeriod(buckets, fromKey, toKey), [buckets, fromKey, toKey]);

  const rangeLabel = range
    ? `${format(range.from, "d MMM yyyy")} – ${format(range.to, "d MMM yyyy")}`
    : "—";

  const rangeDays = range
    ? Math.max(1, Math.round((+range.to - +range.from) / 86400000) + 1)
    : 1;
  const useDaily = view === "baseload" || view === "peakload" || rangeDays > 14;

  const series = useMemo(() => {
    if (!useDaily) {
      return inRangePoints.map((p) => ({
        t: format(p.ts, "dd MMM HH:00"),
        price: +p.price.toFixed(1),
      }));
    }
    const byDay = new Map<string, { sum: number; n: number }>();
    for (const p of inRangePoints) {
      if (view === "peakload" && !isBelgradePeakHour(p.ts)) continue;
      const key = belgradeDayKey(p.ts);
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
  }, [inRangePoints, useDaily, view]);

  const sortedDesc = [...inRangePoints].sort((a, b) => b.price - a.price);
  const pdc = sortedDesc.map((p, i) => ({
    pct: +((i / Math.max(1, sortedDesc.length)) * 100).toFixed(1),
    price: +p.price.toFixed(1),
  }));

  const wd = inRangePoints.filter((p) => {
    const d = p.ts.getUTCDay();
    return d >= 1 && d <= 5;
  });
  const we = inRangePoints.filter((p) => {
    const d = p.ts.getUTCDay();
    return d === 0 || d === 6;
  });
  const wdAvg = wd.length ? wd.reduce((a, b) => a + b.price, 0) / wd.length : 0;
  const weAvg = we.length ? we.reduce((a, b) => a + b.price, 0) / we.length : 0;

  const heat = useMemo(() => {
    const m: Record<number, Record<string, number[]>> = {};
    const dayOrder: string[] = [];
    const seen = new Set<string>();
    for (const p of inRangePoints) {
      const day = format(p.ts, "dd MMM");
      const h = p.ts.getHours();
      m[h] = m[h] || {};
      m[h][day] = m[h][day] || [];
      m[h][day].push(p.price);
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
  }, [inRangePoints]);

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

  return (
    <div className="space-y-6">
      <DataStatusBanner
        source={(live.data?.source as "entsoe" | "cache" | "none") ?? "none"}
        lastUpdate={lastTs}
        hours={data.length}
        completeDays={period.completeDaysCount}
        incompleteDays={buckets.length - completeDays.length}
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


      <DateRangeControl firstAvailable={firstAvailable} latestAvailable={latestAvailable} />

      <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-card">
        <div className="grid gap-4 md:grid-cols-12 items-end">
          <div className="md:col-span-4">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">{t("View", "Prikaz")}</Label>
            <Select value={view} onValueChange={(v) => setView(v as typeof view)}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hourly">{t("Hourly / daily auto", "Satno / dnevno auto")}</SelectItem>
                <SelectItem value="baseload">{t("Baseload (daily avg)", "Baseload (dnevni prosek)")}</SelectItem>
                <SelectItem value="peakload">{t("Peakload (weekday 08–20)", "Peakload (radni dan 08–20)")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-4 flex items-center gap-2">
            <Switch checked={negOnly} onCheckedChange={setNegOnly} id="neg" />
            <Label htmlFor="neg" className="text-sm">{t("Negative only", "Samo negativne")}</Label>
          </div>
          <div className="md:col-span-4 flex items-center gap-2">
            <Switch checked={highOnly} onCheckedChange={setHighOnly} id="high" />
            <Label htmlFor="high" className="text-sm">{t("High (>150) only", "Samo visoke (>150)")}</Label>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label={t("Baseload (period)", "Baseload (period)")} value={isFinite(period.baseload) ? period.baseload.toFixed(1) : "—"} unit="EUR/MWh" />
        <KpiCard label={t("Peakload (period)", "Peakload (period)")} value={period.peakload != null ? period.peakload.toFixed(1) : "—"} unit="EUR/MWh" />
        <KpiCard label={t("Volatility (σ)", "Volatilnost (σ)")} value={isFinite(period.sd) ? period.sd.toFixed(1) : "—"} unit="EUR/MWh" />
        <KpiCard label={t("Min / Max", "Min / Max")} value={`${isFinite(period.minHour) ? period.minHour.toFixed(0) : "—"} / ${isFinite(period.maxHour) ? period.maxHour.toFixed(0) : "—"}`} unit="EUR/MWh" />
        <KpiCard label={t("Hours < 0 EUR", "Sati < 0 EUR")} value={period.negHours} />
        <KpiCard label={t("Hours < 10 EUR", "Sati < 10 EUR")} value={period.lowHours} />
        <KpiCard label={t("Hours > 150 EUR", "Sati > 150 EUR")} value={period.highHours} />
        <KpiCard label={t("Weekday / Weekend", "Radni dan / Vikend")} value={`${wdAvg.toFixed(0)} / ${weAvg.toFixed(0)}`} unit="EUR/MWh" />
      </div>

      <ChartCard title={`${t("Day-ahead price", "Day-ahead cena")} — ${rangeLabel}${useDaily ? t(" (daily avg)", " (dnevni prosek)") : ""}`}>
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
          title={t("Price duration curve", "Kriva trajanja cene")}
          description={t(
            "Hours sorted from highest to lowest price. Steep tails indicate scarcity and surplus events.",
            "Sati sortirani od najviše do najniže cene. Strmi krajevi ukazuju na oskudicu i viškove.",
          )}
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

        <ChartCard title={t("Weekday vs weekend average", "Prosek radni dan vs vikend")}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={[{ name: t("Weekday", "Radni dan"), value: +wdAvg.toFixed(1) }, { name: t("Weekend", "Vikend"), value: +weAvg.toFixed(1) }]}>
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
        title={t("Heatmap — hour of day × day", "Mapa toplote — sat dana × dan")}
        description={t("Average hourly price per cell across the selected period.", "Prosečna satna cena po ćeliji za izabrani period.")}
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
