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
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {live.isLoading
            ? t("Fetching live ENTSO-E day-ahead prices…", "Učitavanje uživo ENTSO-E day-ahead cena…")
            : hasReal
              ? t(
                  `Showing ${live.data?.points.length} live ENTSO-E hours (source: ${live.data?.source}). Remaining hours use synthetic data.`,
                  `Prikazano je ${live.data?.points.length} sati uživo iz ENTSO-E (izvor: ${live.data?.source}). Preostali sati koriste sintetičke podatke.`,
                )
              : t(
                  "Live ENTSO-E data unavailable — showing synthetic demo year.",
                  "ENTSO-E podaci uživo nisu dostupni — prikazana je sintetička demo godina.",
                )}
        </p>
        {live.isError && (
          <span className="text-xs text-critical">{t("Live fetch failed:", "Preuzimanje nije uspelo:")} {String(live.error)}</span>
        )}
      </div>
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        <KpiCard
          label={t("Latest baseload", "Najnoviji baseload")}
          hint={t("Latest hourly SEEPEX day-ahead price.", "Najnovija satna SEEPEX day-ahead cena.")}
          value={fmt(latest.price)}
          unit="EUR/MWh"
          demo={!hasReal}
        />
        <KpiCard
          label={t("Latest peakload", "Najnoviji peakload")}
          hint={t("Average of weekday hours 08:00–20:00 over the last 7 days.", "Prosek radnih dana 08:00–20:00 tokom poslednjih 7 dana.")}
          value={fmt(peakloadLatest)}
          unit="EUR/MWh"
          demo={!hasReal}
        />
        <KpiCard label={t("7-day avg", "Prosek 7 dana")} value={fmt(baseload7)} unit="EUR/MWh" demo={!hasReal} />
        <KpiCard label={t("30-day avg", "Prosek 30 dana")} value={fmt(baseload30)} unit="EUR/MWh" demo={!hasReal} />
        <KpiCard
          label={t("Neg. hours (MTD)", "Neg. sati (MTD)")}
          hint={t("Hours with SEEPEX price < 0 EUR/MWh this month.", "Sati sa SEEPEX cenom < 0 EUR/MWh u ovom mesecu.")}
          value={negCount}
          unit={t("hours", "sati")}
          demo={!hasReal}
        />
        <KpiCard label={t("Neg. share (MTD)", "Udeo neg. (MTD)")} value={fmt(negShare)} unit="%" demo={!hasReal} />
        <KpiCard
          label={t("Solar capture price", "Solarna capture cena")}
          hint={t("Σ(price × solar) ÷ Σ(solar) for the current month.", "Σ(cena × solar) ÷ Σ(solar) za tekući mesec.")}
          value={fmt(solarCapture)}
          unit="EUR/MWh"
          demo
        />
        <KpiCard label={t("Wind capture price", "Vetro capture cena")} value={fmt(windCapture)} unit="EUR/MWh" demo />
        <KpiCard
          label={t("Solar capture rate", "Solarna capture stopa")}
          hint={t("Solar capture price ÷ baseload price.", "Solarna capture cena ÷ baseload cena.")}
          value={`${fmt((solarCapture / monthBaseload) * 100)}%`}
          demo
        />
        <KpiCard
          label={t("Wind capture rate", "Vetro capture stopa")}
          value={`${fmt((windCapture / monthBaseload) * 100)}%`}
          demo
        />
      </div>


      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title={t("Hourly day-ahead price", "Satna day-ahead cena")}
          description={t("Last 48 hours of SEEPEX-style hourly prices.", "Poslednja 48 sati SEEPEX-style satnih cena.")}
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
          title={t("Daily baseload & peakload", "Dnevni baseload i peakload")}
          description={t("Last 30 days. Peakload = weekday 08:00–20:00 average.", "Poslednjih 30 dana. Peakload = prosek radnim danima 08:00–20:00.")}
          demo
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

        <ChartCard title={t("Monthly average price", "Mesečna prosečna cena")} demo>
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

        <ChartCard title={t("Negative price hours per month", "Sati negativnih cena po mesecu")} demo>
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
        title={t("Solar & wind capture price vs baseload", "Solarna i vetro capture cena vs baseload")}
        description={t(
          "Monthly comparison illustrating RES cannibalisation. Capture rate below 100% means realised price is lower than the market average.",
          "Mesečno poređenje koje ilustruje kanibalizaciju OIE. Capture stopa ispod 100% znači da je realizovana cena niža od proseka tržišta.",
        )}
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
            <Line type="monotone" dataKey="baseload" stroke="var(--color-chart-5)" strokeWidth={2} name={t("Baseload", "Baseload")} />
            <Line type="monotone" dataKey="solar" stroke="var(--color-chart-3)" strokeWidth={2} name={t("Solar capture", "Solarni capture")} />
            <Line type="monotone" dataKey="wind" stroke="var(--color-chart-2)" strokeWidth={2} name={t("Wind capture", "Vetro capture")} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
