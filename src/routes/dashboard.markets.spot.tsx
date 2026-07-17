import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { KpiCard, PageLoadingSkeleton } from "@/components/dashboard/atoms";
import { AssetEmptyState } from "@/components/dashboard/WorkspaceSelectors";
import { useDateRange } from "@/lib/date-range";
import { fmtNum } from "@/lib/format";
import { useLang } from "@/lib/i18n";
import { fetchMarketPrices } from "@/lib/market.functions";

export const Route = createFileRoute("/dashboard/markets/spot")({
  head: () => ({ meta: [{ title: "Spot Markets - CEA Power Dashboard" }] }),
  component: SpotMarketsPage,
});

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function stdev(values: number[]) {
  const avg = mean(values);
  if (avg == null || values.length < 2) return null;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length);
}

function price(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "N/A" : fmtNum(value, 1);
}

function SpotMarketsPage() {
  const { t } = useLang();
  const { range } = useDateRange();
  const q = useQuery({
    queryKey: ["spot-markets", range.from, range.to],
    queryFn: () => fetchMarketPrices({ data: { from: range.from, to: range.to } }),
    staleTime: 5 * 60_000,
  });
  const points = q.data?.points ?? [];
  const prices = points.map((point) => point.price);
  const stats = {
    baseload: mean(prices),
    peakload: mean(
      points.filter((_, index) => index % 24 >= 8 && index % 24 < 20).map((point) => point.price),
    ),
    min: prices.length ? Math.min(...prices) : null,
    max: prices.length ? Math.max(...prices) : null,
    volatility: stdev(prices),
    negative: prices.filter((price) => price < 0).length,
  };
  const chart = points.map((point) => ({
    ts: new Date(point.ts).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      timeZone: "Europe/Belgrade",
    }),
    price: Number(point.price.toFixed(2)),
  }));
  const distribution = useMemo(() => {
    const bins = new Map<string, number>();
    for (const value of prices) {
      const bucket = Math.floor(value / 25) * 25;
      const label = `${bucket} to ${bucket + 25}`;
      bins.set(label, (bins.get(label) ?? 0) + 1);
    }
    return Array.from(bins.entries()).map(([bucket, count]) => ({ bucket, count }));
  }, [prices]);

  if (q.isLoading) return <PageLoadingSkeleton />;
  if (!points.length) {
    return (
      <AssetEmptyState
        title={t("Spot market data unavailable", "Spot trzisni podaci nisu dostupni")}
        description={t(
          "No Serbian day-ahead price observations are available for the selected period.",
          "Nema dostupnih day-ahead cena za Srbiju u izabranom periodu.",
        )}
      />
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-2xl font-semibold">{t("Spot Markets", "Spot trzista")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "Consolidated day-ahead price workspace. Regional comparison controls are prepared; current public summary uses the Serbia SEEPEX feed.",
            "Konsolidovani radni prostor za day-ahead cene. Kontrole za regionalno poredjenje su pripremljene; trenutni javni pregled koristi Serbia SEEPEX feed.",
          )}
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard label="Serbia baseload" value={price(stats.baseload)} unit="EUR/MWh" />
        <KpiCard label="Serbia peakload" value={price(stats.peakload)} unit="EUR/MWh" />
        <KpiCard label="Minimum price" value={price(stats.min)} unit="EUR/MWh" />
        <KpiCard label="Maximum price" value={price(stats.max)} unit="EUR/MWh" />
        <KpiCard label="Volatility" value={price(stats.volatility)} unit="EUR/MWh" />
        <KpiCard label="Negative intervals" value={String(stats.negative)} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
        <div className="rounded-lg border border-border/70 bg-card p-5">
          <h3 className="text-lg font-semibold">
            {t("Hourly price profile", "Satni profil cena")}
          </h3>
          <div className="mt-4 h-[380px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="ts" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} unit=" €/MWh" width={78} />
                <Tooltip formatter={(value) => [`${fmtNum(Number(value), 2)} EUR/MWh`, "RS"]} />
                <Line dataKey="price" stroke="#1ec8c8" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-lg border border-border/70 bg-card p-5">
          <h3 className="text-lg font-semibold">{t("Price distribution", "Distribucija cena")}</h3>
          <div className="mt-4 h-[380px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={distribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#60a5fa" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border/70 bg-card p-5">
        <h3 className="text-lg font-semibold">{t("Interpretation", "Tumacenje")}</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {stats.negative > 0
            ? t(
                "Negative intervals indicate potential value for flexible consumption and storage charging, but portfolio availability is not assumed.",
                "Negativni intervali ukazuju na potencijalnu vrednost fleksibilne potrosnje i punjenja baterije, ali dostupnost portfolija se ne pretpostavlja.",
              )
            : t(
                "No negative-price interval is present in the selected Serbia series. Use regional comparison once additional markets are selected.",
                "U izabranoj seriji za Srbiju nema negativnih intervala. Koristite regionalno poredjenje kada se izaberu dodatna trzista.",
              )}
        </p>
      </section>
    </div>
  );
}
