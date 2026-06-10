import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
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
import { fetchMarketPrices } from "@/lib/market.functions";
import { useLang } from "@/lib/i18n";

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

type HourlyPoint = { ts: Date; price: number; solar: number; wind: number };

// Belgrade (CET/CEST) calendar-day key, e.g. "2026-06-09"
const BELGRADE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Belgrade",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function belgradeDayKey(d: Date) {
  return BELGRADE_FMT.format(d); // en-CA → YYYY-MM-DD
}
function dateFromBelgradeKey(key: string) {
  // local Date at midnight, used only for calendar/display
  const [y, m, day] = key.split("-").map(Number);
  return new Date(y, m - 1, day);
}

function monthlyAvgLocal(points: HourlyPoint[]) {
  const map = new Map<string, number[]>();
  for (const p of points) {
    const k = p.ts.toISOString().slice(0, 7);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(p.price);
  }
  return Array.from(map.entries()).map(([month, vals]) => ({
    month,
    value: vals.reduce((a, b) => a + b, 0) / vals.length,
  }));
}

function OverviewPage() {
  const { t } = useLang();
  const live = useQuery({
    queryKey: ["market-prices"],
    queryFn: () => fetchMarketPrices(),
    staleTime: 60 * 60_000,
  });
  const hasReal = (live.data?.points?.length ?? 0) > 0;
  const data = useMemo<HourlyPoint[]>(
    () =>
      (live.data?.points ?? []).map((p) => ({
        ts: new Date(p.ts),
        price: p.price,
        solar: 0,
        wind: 0,
      })),
    [live.data],
  );
  const last30 = useMemo(() => data.slice(-30 * 24), [data]);
  const last7 = useMemo(() => data.slice(-7 * 24), [data]);


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

  const latest = data[data.length - 1];
  const last24 = useMemo(() => data.slice(-24), [data]);
  const baseloadLatest = last24.length ? last24.reduce((a, b) => a + b.price, 0) / last24.length : NaN;
  const baseload7 = last7.length ? last7.reduce((a, b) => a + b.price, 0) / last7.length : NaN;
  const baseload30 = last30.length ? last30.reduce((a, b) => a + b.price, 0) / last30.length : NaN;
  const peakHours = (d: HourlyPoint[]) =>
    d.filter((p) => {
      const h = p.ts.getHours();
      const dow = p.ts.getDay();
      return dow >= 1 && dow <= 5 && h >= 8 && h < 20;
    });
  const peak7 = peakHours(last7);
  const peakloadLatest = peak7.length ? peak7.reduce((a, b) => a + b.price, 0) / peak7.length : NaN;

  // Current month
  const cm = latest.ts.toISOString().slice(0, 7);
  const monthHours = data.filter((p) => p.ts.toISOString().slice(0, 7) === cm);
  const negCount = monthHours.filter((p) => p.price < 0).length;
  const negShare = monthHours.length ? (negCount / monthHours.length) * 100 : NaN;

  const monthly = useMemo(() => monthlyAvgLocal(data), [data]);

  const negByMonth = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of data) {
      const k = p.ts.toISOString().slice(0, 7);
      m.set(k, (m.get(k) ?? 0) + (p.price < 0 ? 1 : 0));
    }
    return Array.from(m.entries()).map(([month, negHours]) => ({ month: month.slice(5), negHours }));
  }, [data]);

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

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {live.data?.source === "cache"
            ? t(
                `Showing ${live.data?.points.length} cached hours (latest ${latest.ts.toLocaleString()}). Live ENTSO-E refresh unavailable.`,
                `Prikazano ${live.data?.points.length} keširanih sati (najnoviji ${latest.ts.toLocaleString()}). Osvežavanje sa ENTSO-E nije dostupno.`,
              )
            : t(
                `Showing ${live.data?.points.length} live ENTSO-E hours (source: ${live.data?.source}).`,
                `Prikazano je ${live.data?.points.length} sati uživo iz ENTSO-E (izvor: ${live.data?.source}).`,
              )}
        </p>
      </div>
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        <KpiCard
          label={t("Latest baseload", "Najnoviji baseload")}
          hint={t("Average SEEPEX day-ahead price over the latest 24 available hours.", "Prosečna SEEPEX day-ahead cena za poslednja 24 dostupna sata.")}
          value={fmt(baseloadLatest)}
          unit="EUR/MWh"
        />
        <KpiCard
          label={t("Latest peakload", "Najnoviji peakload")}
          hint={t("Average of weekday hours 08:00–20:00 over the last 7 days.", "Prosek radnih dana 08:00–20:00 tokom poslednjih 7 dana.")}
          value={fmt(peakloadLatest)}
          unit="EUR/MWh"
        />
        <KpiCard label={t("7-day avg", "Prosek 7 dana")} value={fmt(baseload7)} unit="EUR/MWh" />
        <KpiCard label={t("30-day avg", "Prosek 30 dana")} value={fmt(baseload30)} unit="EUR/MWh" />
        <KpiCard
          label={t("Neg. hours (MTD)", "Neg. sati (MTD)")}
          hint={t("Hours with SEEPEX price < 0 EUR/MWh this month.", "Sati sa SEEPEX cenom < 0 EUR/MWh u ovom mesecu.")}
          value={negCount}
          unit={t("hours", "sati")}
        />
        <KpiCard label={t("Neg. share (MTD)", "Udeo neg. (MTD)")} value={fmt(negShare)} unit="%" />
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
              <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} unit="" />
              <RTooltip />
              <ReferenceLine y={0} stroke="var(--color-critical)" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="price" stroke="var(--color-chart-1)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title={t("Daily baseload & peakload", "Dnevni baseload i peakload")}
          description={t("Last 30 days. Peakload = weekday 08:00–20:00 average.", "Poslednjih 30 dana. Peakload = prosek radnim danima 08:00–20:00.")}
        >
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={dailyBaseloadPeakload}>
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

        <ChartCard title={t("Monthly average price", "Mesečna prosečna cena")}>
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

        <ChartCard title={t("Negative price hours per month", "Sati negativnih cena po mesecu")}>
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
    </div>
  );
}

