import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, BatteryCharging, CircleDollarSign, CloudSun, TrendingUp, Zap } from "lucide-react";
import { fetchCaptureSeries, type CapturePoint } from "@/lib/capture.functions";
import { bucketByBelgradeDay, type HourlyPrice } from "@/lib/baseload";
import { useLang } from "@/lib/i18n";

function dayISO(offset = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function mean(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function captureRate(points: CapturePoint[]) {
  let captureValue = 0;
  let generation = 0;
  let matchedPriceSum = 0;
  let matchedHours = 0;

  for (const p of points) {
    if (!Number.isFinite(p.price) || !Number.isFinite(p.solar)) continue;
    const solar = Math.max(0, p.solar);
    matchedPriceSum += p.price;
    matchedHours += 1;
    captureValue += p.price * solar;
    generation += solar;
  }

  const matchedBaseload = matchedHours ? matchedPriceSum / matchedHours : null;
  const capture = generation > 0 ? captureValue / generation : null;
  return matchedBaseload != null && matchedBaseload !== 0 && capture != null
    ? capture / matchedBaseload
    : null;
}

function bessSpread(points: CapturePoint[]) {
  const priceSeries: HourlyPrice[] = points
    .filter((p) => Number.isFinite(p.price) && !Number.isNaN(Date.parse(p.ts)))
    .map((p) => ({ ts: new Date(p.ts), price: p.price }));
  const completeDays = bucketByBelgradeDay(priceSeries).filter((day) => day.complete);
  const values: number[] = [];

  for (const day of completeDays) {
    if (day.hours.length < 2) continue;
    const sorted = day.hours.map((point) => point.price).sort((a, b) => a - b);
    const charge = (sorted[0] + sorted[1]) / 2;
    const discharge = (sorted.at(-1)! + sorted.at(-2)!) / 2;
    values.push(discharge * 0.85 - charge);
  }
  return mean(values);
}

function fmt(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(1);
}

export function MorningMarketSnapshot() {
  const { t } = useLang();
  const from = dayISO(-8);
  const to = dayISO(1);
  const query = useQuery({
    queryKey: ["morning-market-snapshot", from, to],
    queryFn: () => fetchCaptureSeries({ data: { from, to } }),
    staleTime: 15 * 60_000,
    refetchInterval: 30 * 60_000,
    retry: 1,
  });

  const points = query.data?.points ?? [];
  const priceSeries = useMemo<HourlyPrice[]>(
    () => points.map((p) => ({ ts: new Date(p.ts), price: p.price })),
    [points],
  );
  const completeDays = useMemo(
    () => bucketByBelgradeDay(priceSeries).filter((d) => d.complete).slice(-7),
    [priceSeries],
  );
  const latest = completeDays.at(-1);
  const previous = completeDays.at(-2);
  const recentKeys = new Set(completeDays.map((d) => d.key));
  const recentPoints = points.filter((p) =>
    recentKeys.has(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Belgrade",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(p.ts)),
    ),
  );

  const dayDelta = latest && previous ? latest.baseload - previous.baseload : null;
  const negHours = recentPoints.filter((p) => p.price < 0).length;
  const avgRange = mean(
    completeDays
      .map((d) => {
        const prices = d.hours.map((h) => h.price).filter((p) => Number.isFinite(p));
        return prices.length ? Math.max(...prices) - Math.min(...prices) : null;
      })
      .filter((v): v is number => v != null),
  );
  const solarRate = captureRate(recentPoints);
  const bess = bessSpread(recentPoints);
  const lastTs = points.at(-1)?.ts;

  const cards = [
    [t("Latest baseload", "Poslednja bazna cena"), `${fmt(latest?.baseload)} €/MWh`, latest?.key ?? "—", CircleDollarSign],
    [t("Day-on-day", "Dan na dan"), dayDelta == null ? "—" : `${dayDelta >= 0 ? "+" : ""}${dayDelta.toFixed(1)} €/MWh`, t("Latest complete day", "Poslednji potpuni dan"), TrendingUp],
    [t("Negative hours", "Negativni sati"), String(negHours), t("Last 7 complete days", "Poslednjih 7 potpunih dana"), Zap],
    [t("Daily price range", "Dnevni raspon cena"), `${fmt(avgRange)} €/MWh`, t("Average max minus min", "Prosečan maksimum minus minimum"), Activity],
    [t("Solar capture rate", "Solarni capture rate"), solarRate == null ? "—" : `${(solarRate * 100).toFixed(0)}%`, query.data?.solarSource === "modelled" ? t("Modelled solar profile", "Modelovani solarni profil") : t("Generation weighted on matched hours", "Ponderisano proizvodnjom na uparenim satima"), CloudSun],
    [t("BESS 2h net spread", "BESS 2h neto raspon"), `${fmt(bess)} €/MWh`, t("Complete delivery days, 85% efficiency", "Potpuni isporučni dani, 85% efikasnost"), BatteryCharging],
  ] as const;

  return (
    <section className="rounded-[10px] border border-border/70 bg-card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {t("Morning market snapshot", "Jutarnji pregled tržišta")}
          </div>
          <h2 className="mt-0.5 font-display text-lg font-semibold">
            {t("What matters now", "Šta je trenutno važno")}
          </h2>
        </div>
        <div className="text-right text-[11px] text-muted-foreground">
          <div>{query.isFetching ? t("Refreshing…", "Osvežavanje…") : t("Rolling live view", "Živi pregled")}</div>
          {lastTs && <div>{t("Data through", "Podaci do")} {new Date(lastTs).toLocaleString("en-GB", { timeZone: "Europe/Belgrade" })}</div>}
        </div>
      </div>

      {query.isLoading ? (
        <div className="py-6 text-sm text-muted-foreground">{t("Loading snapshot…", "Učitavanje pregleda…")}</div>
      ) : points.length === 0 ? (
        <div className="py-6 text-sm text-muted-foreground">
          {t("Live market data is currently unavailable. No demo values are shown.", "Živi tržišni podaci trenutno nisu dostupni. Demo vrednosti se ne prikazuju.")}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {cards.map(([label, value, sub, Icon]) => (
            <div key={label} className="rounded-lg border border-border/60 bg-background/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="mt-2 num text-xl font-semibold text-foreground">{value}</div>
              <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{sub}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
