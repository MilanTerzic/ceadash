import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, BatteryCharging, Info, TrendingUp } from "lucide-react";
import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AssetEmptyState } from "@/components/dashboard/WorkspaceSelectors";
import { KpiCard, PageLoadingSkeleton } from "@/components/dashboard/atoms";
import { Button } from "@/components/ui/button";
import { useDateRange } from "@/lib/date-range";
import { fetchMarketPrices } from "@/lib/market.functions";
import { fmtNum, fmtPrice } from "@/lib/format";
import { useLang } from "@/lib/i18n";
import { useWorkspace, type DashboardRole } from "@/lib/workspace";

export const Route = createFileRoute("/dashboard/")({
  head: () => ({
    meta: [
      { title: "Today - CEA Power Dashboard" },
      {
        name: "description",
        content: "Role-specific Serbian electricity-market workspace for today's decisions.",
      },
    ],
  }),
  component: TodayPage,
});

type PricePoint = { ts: string; price: number };
type KpiConfig = {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
};

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function stdev(values: number[]) {
  const avg = mean(values);
  if (avg == null || values.length < 2) return null;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length);
}

function belgradeHour(ts: string) {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Belgrade",
      hour: "2-digit",
      hour12: false,
    }).format(new Date(ts)),
  );
}

function bestWindow(points: PricePoint[], count: number, mode: "low" | "high") {
  if (points.length < count) return null;
  const ranked = points
    .slice()
    .sort((a, b) => (mode === "low" ? a.price - b.price : b.price - a.price))
    .slice(0, count);
  const avg = mean(ranked.map((point) => point.price));
  return {
    avg,
    label: ranked
      .map((point) =>
        new Date(point.ts).toLocaleString("en-GB", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          timeZone: "Europe/Belgrade",
        }),
      )
      .join(", "),
  };
}

function batterySpread(points: PricePoint[], hours: number) {
  const charge = bestWindow(points, hours, "low");
  const discharge = bestWindow(points, hours, "high");
  if (charge?.avg == null || discharge?.avg == null) return null;
  return {
    gross: discharge.avg - charge.avg,
    net: discharge.avg * 0.85 - charge.avg,
    charge,
    discharge,
  };
}

function solarCaptureSignal(points: PricePoint[]) {
  const weighted = points
    .map((point) => {
      const hour = belgradeHour(point.ts);
      const shape = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
      return { price: point.price, weight: shape };
    })
    .filter((point) => point.weight > 0);
  const weight = weighted.reduce((sum, point) => sum + point.weight, 0);
  if (!weight) return null;
  const capture = weighted.reduce((sum, point) => sum + point.price * point.weight, 0) / weight;
  const base = mean(points.map((point) => point.price));
  return base == null ? null : { capture, rate: (capture / base) * 100 };
}

function stats(points: PricePoint[]) {
  const prices = points.map((point) => point.price);
  const peak = points.filter((point) => {
    const hour = belgradeHour(point.ts);
    return hour >= 8 && hour < 20;
  });
  const offpeak = points.filter((point) => {
    const hour = belgradeHour(point.ts);
    return hour < 8 || hour >= 20;
  });
  const bess2 = batterySpread(points, 2);
  const bess4 = batterySpread(points, 4);
  const solar = solarCaptureSignal(points);
  return {
    baseload: mean(prices),
    peakload: mean(peak.map((point) => point.price)),
    offpeak: mean(offpeak.map((point) => point.price)),
    min: prices.length ? Math.min(...prices) : null,
    max: prices.length ? Math.max(...prices) : null,
    volatility: stdev(prices),
    negativeIntervals: prices.filter((price) => price < 0).length,
    solar,
    bess2,
    bess4,
    cheapest: bestWindow(points, 3, "low"),
    highest: bestWindow(points, 3, "high"),
  };
}

function price(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "N/A" : fmtNum(value, 1);
}

function roleKpis(
  role: DashboardRole,
  period: ReturnType<typeof stats>,
  privateMessage: string,
): KpiConfig[] {
  const common = {
    baseload: {
      label: "Serbia day-ahead baseload",
      value: price(period.baseload),
      unit: "EUR/MWh",
    },
    peakload: { label: "Serbia peakload", value: price(period.peakload), unit: "EUR/MWh" },
    neg: {
      label: "Negative-price intervals",
      value: String(period.negativeIntervals),
      unit: "intervals",
    },
    volatility: { label: "Volatility", value: price(period.volatility), unit: "EUR/MWh" },
    bess2: { label: "2h BESS net spread", value: price(period.bess2?.net), unit: "EUR/MWh" },
    bess4: { label: "4h BESS net spread", value: price(period.bess4?.net), unit: "EUR/MWh" },
  } satisfies Record<string, KpiConfig>;

  if (role === "producer") {
    return [
      common.baseload,
      {
        label: "Solar capture price",
        value: price(period.solar?.capture),
        unit: "EUR/MWh",
        hint: "Modelled public market signal using a generic daylight production shape.",
      },
      {
        label: "Solar capture rate",
        value: period.solar ? fmtNum(period.solar.rate, 1) : "N/A",
        unit: "%",
      },
      common.neg,
      common.bess2,
      { label: "Revenue metric", value: "N/A", hint: privateMessage },
    ];
  }
  if (role === "consumer") {
    return [
      { label: "Market reference price", value: price(period.baseload), unit: "EUR/MWh" },
      { label: "Peak-period price", value: price(period.peakload), unit: "EUR/MWh" },
      { label: "Off-peak price", value: price(period.offpeak), unit: "EUR/MWh" },
      { label: "Cheapest interval avg", value: price(period.cheapest?.avg), unit: "EUR/MWh" },
      { label: "Most expensive avg", value: price(period.highest?.avg), unit: "EUR/MWh" },
      common.volatility,
    ];
  }
  if (role === "vpp") {
    return [
      common.volatility,
      common.neg,
      common.bess2,
      common.bess4,
      { label: "Upward opportunity", value: price(period.highest?.avg), unit: "EUR/MWh" },
      { label: "Downward opportunity", value: price(period.cheapest?.avg), unit: "EUR/MWh" },
    ];
  }
  if (role === "battery") {
    return [
      common.bess2,
      common.bess4,
      { label: "Cheapest charge window", value: price(period.cheapest?.avg), unit: "EUR/MWh" },
      { label: "Highest discharge window", value: price(period.highest?.avg), unit: "EUR/MWh" },
      common.neg,
      common.volatility,
    ];
  }
  if (role === "investor") {
    return [
      common.baseload,
      {
        label: "Solar capture price",
        value: price(period.solar?.capture),
        unit: "EUR/MWh",
      },
      {
        label: "Capture rate",
        value: period.solar ? fmtNum(period.solar.rate, 1) : "N/A",
        unit: "%",
      },
      common.neg,
      {
        label: "Forward reference",
        value: "Open outlook",
        hint: "Uses public futures snapshot page.",
      },
      {
        label: "Project calculator",
        value: "Wizard",
        hint: "Open Project Economics for assumptions.",
      },
    ];
  }
  return [
    common.baseload,
    common.peakload,
    { label: "Minimum price", value: price(period.min), unit: "EUR/MWh" },
    { label: "Maximum price", value: price(period.max), unit: "EUR/MWh" },
    common.neg,
    common.volatility,
  ];
}

function MarketSignalCard({
  title,
  severity,
  text,
  to,
}: {
  title: string;
  severity: "Positive" | "Neutral" | "Warning" | "Critical";
  text: string;
  to: string;
}) {
  const color =
    severity === "Positive"
      ? "border-success/40 bg-success/10"
      : severity === "Warning"
        ? "border-warning/40 bg-warning/10"
        : severity === "Critical"
          ? "border-destructive/40 bg-destructive/10"
          : "border-border/70 bg-card";
  return (
    <div className={`rounded-lg border p-4 ${color}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <p className="mt-1 text-sm text-muted-foreground">{text}</p>
        </div>
        {severity === "Critical" || severity === "Warning" ? (
          <AlertTriangle className="h-4 w-4 shrink-0" />
        ) : (
          <Info className="h-4 w-4 shrink-0" />
        )}
      </div>
      <Link
        to={to}
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary"
      >
        Open analysis <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

function TodayPage() {
  const { t } = useLang();
  const { range } = useDateRange();
  const { role, selectedRole, selectedPortfolio, privateDataRequiredMessage } = useWorkspace();
  const prices = useQuery({
    queryKey: ["today-prices", range.from, range.to],
    queryFn: () => fetchMarketPrices({ data: { from: range.from, to: range.to } }),
    staleTime: 5 * 60_000,
  });

  const points = useMemo<PricePoint[]>(
    () => (prices.data?.points ?? []).map((point) => ({ ts: point.ts, price: point.price })),
    [prices.data],
  );
  const period = useMemo(() => stats(points), [points]);
  const kpis = roleKpis(role, period, privateDataRequiredMessage);
  const chartData = points.map((point) => ({
    ts: new Date(point.ts).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      timeZone: "Europe/Belgrade",
    }),
    price: Number(point.price.toFixed(2)),
  }));
  const roleTitle = t(selectedRole.en, selectedRole.sr);
  const portfolioTitle = t(selectedPortfolio.en, selectedPortfolio.sr);

  if (prices.isLoading) return <PageLoadingSkeleton />;

  if (!points.length) {
    return (
      <AssetEmptyState
        title={t("Public market data unavailable", "Javni trzisni podaci nisu dostupni")}
        description={t(
          "No Serbian day-ahead prices are available for the selected period. Metrics are not replaced with zero.",
          "Za izabrani period nema dostupnih day-ahead cena za Srbiju. Metrike nisu zamenjene nulom.",
        )}
      />
    );
  }

  const summary =
    period.negativeIntervals > 0
      ? t(
          `Negative prices occurred in ${period.negativeIntervals} interval(s), so flexible consumption and storage charging windows deserve attention.`,
          `Negativne cene su zabelezene u ${period.negativeIntervals} intervala, pa treba pratiti fleksibilnu potrosnju i punjenje baterija.`,
        )
      : period.bess2?.net != null && period.bess2.net > 30
        ? t(
            `The 2-hour battery net spread is ${fmtNum(period.bess2.net, 1)} EUR/MWh, indicating a strong public arbitrage signal.`,
            `Neto 2h baterijski spread je ${fmtNum(period.bess2.net, 1)} EUR/MWh, sto ukazuje na jak javni arbitrazni signal.`,
          )
        : t(
            "Serbian prices are available for the selected period; monitor volatility and regional spreads before acting.",
            "Cene za Srbiju su dostupne za izabrani period; pratite volatilnost i regionalne spreadove pre odluke.",
          );

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border/70 bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              {t("Today workspace", "Danasnji radni prostor")}
            </div>
            <h2 className="mt-1 text-2xl font-semibold">
              {roleTitle} · {portfolioTitle}
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{summary}</p>
          </div>
          <Button asChild variant="outline" className="gap-2">
            <Link to="/dashboard/portfolio" search={{ view: selectedRole.defaultPortfolioView }}>
              {t("Open portfolio view", "Otvori portfolio prikaz")}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {kpis.map((kpi) => (
          <KpiCard
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            unit={kpi.unit}
            hint={kpi.hint}
          />
        ))}
      </section>

      <section className="rounded-lg border border-border/70 bg-card p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">
              {t("Primary market chart", "Glavni trzisni grafikon")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t(
                "Serbia day-ahead price profile for the selected delivery period.",
                "Profil day-ahead cena Srbije za izabrani period isporuke.",
              )}
            </p>
          </div>
          <div className="text-xs text-muted-foreground">{fmtPrice(period.baseload)} average</div>
        </div>
        <div className="h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ left: 4, right: 12, top: 10, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="ts" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} unit=" €/MWh" width={78} />
              <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
              <RTooltip
                formatter={(value) => [`${fmtNum(Number(value), 2)} EUR/MWh`, "Serbia DA"]}
                contentStyle={{
                  background: "var(--color-surface-2)",
                  border: "1px solid var(--color-border)",
                  fontSize: 12,
                }}
              />
              <Line dataKey="price" stroke="#1ec8c8" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <MarketSignalCard
          title={t("Negative-price exposure", "Izlozenost negativnim cenama")}
          severity={period.negativeIntervals > 0 ? "Warning" : "Neutral"}
          text={t(
            `${period.negativeIntervals} interval(s) below 0 EUR/MWh in the selected period.`,
            `${period.negativeIntervals} intervala ispod 0 EUR/MWh u izabranom periodu.`,
          )}
          to="/dashboard/markets/spot"
        />
        <MarketSignalCard
          title={t("Battery arbitrage window", "Baterijski arbitrazni prozor")}
          severity={period.bess2?.net != null && period.bess2.net > 30 ? "Positive" : "Neutral"}
          text={t(
            `Indicative 2h net spread: ${price(period.bess2?.net)} EUR/MWh. This is not guaranteed revenue.`,
            `Indikativni 2h neto spread: ${price(period.bess2?.net)} EUR/MWh. Ovo nije garantovan prihod.`,
          )}
          to="/dashboard/portfolio"
        />
        <MarketSignalCard
          title={t("Private-data readiness", "Spremnost privatnih podataka")}
          severity={selectedPortfolio.kind === "public" ? "Neutral" : "Warning"}
          text={
            selectedPortfolio.kind === "public"
              ? t(
                  "Public Serbia Market profile is active; portfolio-specific metrics are not assumed.",
                  "Aktivan je javni profil trzista Srbije; portfolio metrike se ne pretpostavljaju.",
                )
              : t(
                  "Connect or upload asset data before calculating revenue, cost, dispatch or settlement metrics.",
                  "Povezite ili ucitajte podatke asseta pre racunanja prihoda, troska, dispatch-a ili poravnanja.",
                )
          }
          to="/dashboard/portfolio"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <AssetEmptyState
          title={t("Asset data connection", "Povezivanje podataka asseta")}
          description={t(
            "Upload or connect production, consumption, schedules, contracts or meter data to calculate private financial and operational metrics.",
            "Ucitajte ili povezite proizvodnju, potrosnju, planove, ugovore ili merne podatke za privatne finansijske i operativne metrike.",
          )}
        />
        <div className="rounded-lg border border-border/70 bg-card p-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <TrendingUp className="h-4 w-4" />
            {t("What to watch next", "Sta pratiti dalje")}
          </div>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>
              {t(
                "Compare Serbia against Hungary, Romania and Bulgaria in Spot Markets.",
                "Poredite Srbiju sa Madjarskom, Rumunijom i Bugarskom u Spot trzistima.",
              )}
            </li>
            <li>
              {t(
                "Check public futures and fundamental drivers in Forwards & Outlook.",
                "Proverite futures i fundamentalne faktore u Terminskim cenama i izgledima.",
              )}
            </li>
            <li>
              {t(
                "Review border flow, capacity and utilization in System & Borders.",
                "Pregledajte tokove, kapacitet i iskoriscenost u Sistemu i granicama.",
              )}
            </li>
          </ul>
          <Button asChild variant="ghost" className="mt-4 gap-2 px-0">
            <Link to="/dashboard/markets/outlook">
              <BatteryCharging className="h-4 w-4" />
              {t("Open outlook", "Otvori izglede")}
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
