import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ChartCard, SignalPill } from "@/components/dashboard/atoms";
import { belgradeDayKey } from "@/lib/baseload";
import { fetchCaptureSeries, type CapturePoint } from "@/lib/capture.functions";
import { getEkapijaNews } from "@/lib/news.functions";
import { useLang } from "@/lib/i18n";

export const Route = createFileRoute("/dashboard/insights")({
  head: () => ({
    meta: [
      { title: "Market Insights — CEA Power Dashboard" },
      {
        name: "description",
        content:
          "Live analytical indicators for Serbian day-ahead prices, renewable capture and flexibility.",
      },
      { property: "og:title", content: "Market Insights — CEA Power Dashboard" },
      {
        property: "og:description",
        content:
          "Live analytical indicators for Serbian day-ahead prices, renewable capture and flexibility.",
      },
      { property: "og:url", content: "https://dashboard.cea.org.rs/dashboard/insights" },
    ],
    links: [{ rel: "canonical", href: "https://dashboard.cea.org.rs/dashboard/insights" }],
  }),
  component: InsightsPage,
});

type Signal = "Positive" | "Neutral" | "Warning" | "Critical";

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

function hour(ts: string) {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Belgrade",
      hour: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date(ts))
      .find((p) => p.type === "hour")?.value ?? "0",
  );
}

function mean(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function compute(points: CapturePoint[]) {
  const valid = points.filter((p) => Number.isFinite(p.price));
  const baseload = mean(valid.map((p) => p.price));
  let solarValue = 0;
  let solarGen = 0;
  let windValue = 0;
  let windGen = 0;
  const midday: number[] = [];
  const evening: number[] = [];
  const byDay = new Map<string, number[]>();

  for (const p of valid) {
    const h = hour(p.ts);
    if (h >= 11 && h < 16) midday.push(p.price);
    if (h >= 18 && h < 22) evening.push(p.price);
    const solar = p.solar > 0 ? p.solar : 0;
    const wind = p.wind > 0 ? p.wind : 0;
    solarValue += p.price * solar;
    solarGen += solar;
    windValue += p.price * wind;
    windGen += wind;
    const key = belgradeDayKey(new Date(p.ts));
    const arr = byDay.get(key) ?? [];
    arr.push(p.price);
    byDay.set(key, arr);
  }

  const solarCapture = solarGen > 0 ? solarValue / solarGen : null;
  const windCapture = windGen > 0 ? windValue / windGen : null;
  const solarRate = baseload && solarCapture != null ? solarCapture / baseload : null;
  const windRate = baseload && windCapture != null ? windCapture / baseload : null;
  const middayAvg = mean(midday);
  const eveningAvg = mean(evening);
  const dailyRange: number[] = [];
  const bess: number[] = [];

  for (const prices of byDay.values()) {
    if (prices.length < 20) continue;
    const sorted = [...prices].sort((a, b) => a - b);
    dailyRange.push(sorted.at(-1)! - sorted[0]);
    const charge = (sorted[0] + sorted[1]) / 2;
    const discharge = (sorted.at(-1)! + sorted.at(-2)!) / 2;
    bess.push(discharge * 0.85 - charge);
  }

  return {
    baseload,
    solarCapture,
    windCapture,
    solarRate,
    windRate,
    negHours: valid.filter((p) => p.price < 0).length,
    middayAvg,
    middayDelta: baseload && middayAvg != null ? (middayAvg - baseload) / Math.abs(baseload) : null,
    eveningPremium: baseload != null && eveningAvg != null ? eveningAvg - baseload : null,
    avgRange: mean(dailyRange),
    bessNet2h: mean(bess),
    completeDays: dailyRange.length,
  };
}

function fmt(v: number | null, digits = 1) {
  return v == null || !Number.isFinite(v) ? "N/A" : v.toFixed(digits);
}

function pct(v: number | null) {
  return v == null || !Number.isFinite(v) ? "N/A" : `${(v * 100).toFixed(0)}%`;
}

function InsightsPage() {
  const { t } = useLang();
  const newsFn = useServerFn(getEkapijaNews);
  const newsQuery = useQuery({
    queryKey: ["signals_news_policy"],
    queryFn: () => newsFn(),
    refetchInterval: 30 * 60 * 1000,
    staleTime: 15 * 60 * 1000,
    retry: 1,
  });

  const from = dayISO(-30);
  const to = dayISO(1);
  const liveQuery = useQuery({
    queryKey: ["live-market-indicators", from, to],
    queryFn: () => fetchCaptureSeries({ data: { from, to } }),
    refetchInterval: 30 * 60 * 1000,
    staleTime: 15 * 60 * 1000,
    retry: 1,
  });
  const points = liveQuery.data?.points ?? [];
  const metrics = useMemo(() => compute(points), [points]);
  const lastTs = points.at(-1)?.ts;

  const indicators: { title: string; text: string; metric: string; signal: Signal }[] = [
    {
      title: t("Solar capture vs baseload", "Capture cena solara u odnosu na baznu cenu"),
      text: t(
        "Shows the realised solar-profile price relative to Serbian day-ahead baseload in the rolling 30-day window.",
        "Prikazuje ostvarenu cenu solarnog profila u odnosu na srpsku day-ahead baznu cenu u pokretnom periodu od 30 dana.",
      ),
      metric: t(
        `Solar ${fmt(metrics.solarCapture)} €/MWh · capture rate ${pct(metrics.solarRate)}`,
        `Solar ${fmt(metrics.solarCapture)} €/MWh · capture stopa ${pct(metrics.solarRate)}`,
      ),
      signal: metrics.solarRate == null ? "Neutral" : metrics.solarRate < 0.75 ? "Critical" : metrics.solarRate < 0.9 ? "Warning" : "Neutral",
    },
    {
      title: t("Negative-price hours", "Sati sa negativnom cenom"),
      text: t(
        "Counts observed Serbian day-ahead hours below zero in the rolling 30-day window.",
        "Broji zabeležene srpske day-ahead sate ispod nule u pokretnom periodu od 30 dana.",
      ),
      metric: t(`${metrics.negHours} hours below 0 €/MWh`, `${metrics.negHours} sati ispod 0 €/MWh`),
      signal: metrics.negHours > 20 ? "Critical" : metrics.negHours > 5 ? "Warning" : "Neutral",
    },
    {
      title: t("Midday discount", "Popodnevni popust"),
      text: t(
        "Compares the 11:00–16:00 average with baseload to quantify the midday price dip.",
        "Upoređuje prosek od 11:00–16:00 sa baznom cenom kako bi se kvantifikovao pad cene u podne.",
      ),
      metric: t(
        `${fmt(metrics.middayAvg)} €/MWh · ${pct(metrics.middayDelta)} vs baseload`,
        `${fmt(metrics.middayAvg)} €/MWh · ${pct(metrics.middayDelta)} u odnosu na baznu cenu`,
      ),
      signal: metrics.middayDelta == null ? "Neutral" : metrics.middayDelta < -0.3 ? "Critical" : metrics.middayDelta < -0.15 ? "Warning" : "Neutral",
    },
    {
      title: t("Evening premium", "Večernja premija"),
      text: t(
        "Compares 18:00–22:00 prices with baseload to quantify the evening premium.",
        "Upoređuje cene od 18:00–22:00 sa baznom cenom kako bi se kvantifikovala večernja premija.",
      ),
      metric: t(
        `${fmt(metrics.eveningPremium)} €/MWh above baseload`,
        `${fmt(metrics.eveningPremium)} €/MWh iznad bazne cene`,
      ),
      signal: metrics.eveningPremium != null && metrics.eveningPremium > 10 ? "Positive" : "Neutral",
    },
    {
      title: t("BESS 2h net spread", "BESS neto spred 2h"),
      text: t(
        "Ex-post two-hour price spread using the two cheapest and two most expensive hours of each complete day at 85% round-trip efficiency.",
        "Naknadno izračunat dvočasovni spred cene korišćenjem dva najjeftinija i dva najskuplja sata svakog kompletnog dana uz 85% efikasnost punog ciklusa.",
      ),
      metric: t(
        `${fmt(metrics.bessNet2h)} €/MWh · ${metrics.completeDays} complete days`,
        `${fmt(metrics.bessNet2h)} €/MWh · ${metrics.completeDays} kompletnih dana`,
      ),
      signal: metrics.bessNet2h != null && metrics.bessNet2h > 30 ? "Positive" : "Neutral",
    },
    {
      title: t("Wind vs solar capture", "Capture cena vetra u odnosu na solar"),
      text: t(
        "Compares technology-specific capture rates to show how production shape affects realised market prices.",
        "Upoređuje capture stope po tehnologiji kako bi se prikazalo kako oblik proizvodnje utiče na ostvarene tržišne cene.",
      ),
      metric: t(`Wind ${pct(metrics.windRate)} · Solar ${pct(metrics.solarRate)}`, `Vetar ${pct(metrics.windRate)} · Solar ${pct(metrics.solarRate)}`),
      signal: metrics.windRate != null && metrics.solarRate != null && metrics.windRate - metrics.solarRate > 0.1 ? "Positive" : "Neutral",
    },
    {
      title: t("Intraday price range", "Dnevni raspon cena"),
      text: t(
        "Average complete-day maximum minus minimum price over the rolling window.",
        "Prosečna razlika maksimalne i minimalne cene kompletnog dana u pokretnom periodu.",
      ),
      metric: t(
        `${fmt(metrics.avgRange)} €/MWh average daily range`,
        `${fmt(metrics.avgRange)} €/MWh prosečan dnevni raspon`,
      ),
      signal: metrics.avgRange != null && metrics.avgRange > 45 ? "Positive" : "Neutral",
    },
  ];

  return (
    <div className="space-y-6">
      <ChartCard
        title={t("Live analytical indicators", "Analitički indikatori uživo")}
        description={t(
          "Rules-based metrics calculated from the latest rolling 30-day Serbian day-ahead and renewable capture dataset.",
          "Pravilima definisane metrike izračunate iz najnovijeg pokretnog seta podataka srpske day-ahead cene i capture cene obnovljivih izvora za 30 dana.",
        )}
        right={
          <button
            type="button"
            onClick={() => liveQuery.refetch()}
            className="min-h-9 rounded-md border border-border/70 px-3 text-xs text-foreground hover:bg-muted"
          >
            {t("Refresh", "Osveži")}
          </button>
        }
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-background/40 p-3 text-xs text-muted-foreground">
          <span>
            {t("Source: Serbian DA prices + ENTSO-E generation where available", "Izvor: srpske DA cene + ENTSO-E proizvodnja gde je dostupno")}
            {liveQuery.data?.solarSource === "modelled" ? t(" · solar profile modelled where B16 is unavailable", " · solarni profil modelovan gde B16 nije dostupan") : ""}
          </span>
          <span>
            {liveQuery.isFetching
              ? t("Refreshing…", "Osvežavanje…")
              : lastTs
                ? t(
                    `Data through ${new Date(lastTs).toLocaleString("en-GB", { timeZone: "Europe/Belgrade" })}`,
                    `Podaci do ${new Date(lastTs).toLocaleString("en-GB", { timeZone: "Europe/Belgrade" })}`,
                  )
                : t("No live timestamp", "Nema podataka uživo")}
          </span>
        </div>

        {liveQuery.isLoading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{t("Loading live indicators...", "Učitavanje indikatora uživo...")}</p>
        ) : points.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {t("Live market data is currently unavailable. Demo values are not substituted.", "Tržišni podaci uživo trenutno nisu dostupni. Demo vrednosti se ne koriste.")}
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {indicators.map((i) => (
              <article key={i.title} className="rounded-xl border border-border/70 bg-background/40 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="font-display text-lg leading-tight">{i.title}</h4>
                  <SignalPill signal={i.signal} />
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{i.text}</p>
                <div className="mt-3 text-xs font-medium uppercase tracking-wider text-foreground/80">{i.metric}</div>
              </article>
            ))}
          </div>
        )}
      </ChartCard>

      <ChartCard
        title={t("News and policy monitor", "Praćenje vesti i regulative")}
        description={t(
          "Automatically refreshes recent Serbian energy news and policy items from the configured public source.",
          "Automatski osvežava nedavne srpske energetske vesti i regulatorne stavke iz podešenog javnog izvora.",
        )}
      >
        <div className="mb-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{t("Refreshes every 30 minutes while this page is open.", "Osvežava se na svakih 30 minuta dok je ova stranica otvorena.")}</span>
          <button
            type="button"
            onClick={() => newsQuery.refetch()}
            className="min-h-9 rounded-md border border-border/70 px-3 text-foreground hover:bg-muted"
          >
            {t("Refresh", "Osveži")}
          </button>
        </div>
        {newsQuery.isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("Loading news...", "Učitavanje vesti...")}</p>
        ) : (newsQuery.data?.items ?? []).length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("News source is currently unavailable or returned no items.", "Izvor vesti trenutno nije dostupan ili nije vratio stavke.")}
          </p>
        ) : (
          <div className="divide-y divide-border/60">
            {(newsQuery.data?.items ?? []).slice(0, 10).map((item) => (
              <a
                key={item.original_url}
                href={item.original_url}
                target="_blank"
                rel="noreferrer"
                className="block py-3 hover:bg-muted/40"
              >
                <div className="text-sm font-medium">{item.summary_en || item.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {item.date} - {item.source}
                </div>
              </a>
            ))}
          </div>
        )}
      </ChartCard>
    </div>
  );
}
