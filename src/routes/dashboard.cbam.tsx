import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Legend,
} from "recharts";
import { ChartCard, KpiCard } from "@/components/dashboard/atoms";
import {
  DateRangeControl,
  useDashboardRange,
  useRequestedRangeKeys,
} from "@/components/dashboard/DateRangeControl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useLang } from "@/lib/i18n";
import { belgradeDayKey } from "@/lib/baseload";
import { fetchMarketPrices } from "@/lib/market.functions";
import { fetchHupxPrices } from "@/lib/hupx.functions";

export const Route = createFileRoute("/dashboard/cbam")({
  head: () => ({
    meta: [
      { title: "CBAM Export Calculator — CEA Power Dashboard" },
      {
        name: "description",
        content:
          "Estimate CBAM cost for Serbian electricity exports to EU markets and export profitability after CBAM.",
      },
      { property: "og:title", content: "CBAM Export Calculator — CEA Power Dashboard" },
      {
        property: "og:description",
        content:
          "CBAM adder, export margin and breakeven EU price for Serbian electricity exports.",
      },
      { property: "og:url", content: "https://dashboard.cea.org.rs/dashboard/cbam" },
    ],
    links: [{ rel: "canonical", href: "https://dashboard.cea.org.rs/dashboard/cbam" }],
  }),
  component: CbamPage,
});

// --- Settings ----------------------------------------------------------------

type QuarterKey = string; // e.g. "2026-Q1"

type CbamSettings = {
  emissionFactor: number; // tCO2/MWh
  carbonPricePaid: number; // €/tCO2 already paid in Serbia
  destinationCountry: string;
  destinationPrice: number; // €/MWh flat destination price (period average)
  volumeMwh: number;
  capacityCost: number; // €/MWh
  exportFees: number; // €/MWh
  tradingCost: number; // €/MWh
  lossesPct: number; // % of exported energy lost
  quarterlyPrices: Record<QuarterKey, number>; // €/tCO2
};

const DEFAULT_SETTINGS: CbamSettings = {
  emissionFactor: 1.041,
  carbonPricePaid: 0,
  destinationCountry: "HU",
  destinationPrice: 110,
  volumeMwh: 1,
  capacityCost: 0,
  exportFees: 0,
  tradingCost: 0,
  lossesPct: 0,
  quarterlyPrices: {
    "2026-Q1": 75.36,
    "2026-Q2": 75.28,
    "2026-Q3": 75.28,
    "2026-Q4": 75.28,
  },
};

const STORAGE_KEY = "cbam-settings-v1";

function loadSettings(): CbamSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      quarterlyPrices: {
        ...DEFAULT_SETTINGS.quarterlyPrices,
        ...(parsed.quarterlyPrices ?? {}),
      },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const COUNTRIES: { code: string; label: string }[] = [
  { code: "HU", label: "Hungary" },
  { code: "RO", label: "Romania" },
  { code: "BG", label: "Bulgaria" },
  { code: "HR", label: "Croatia" },
  { code: "GR", label: "Greece" },
  { code: "IT", label: "Italy" },
  { code: "OTHER", label: "Other EU" },
];

// --- Helpers -----------------------------------------------------------------

function quarterOf(d: Date): QuarterKey {
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${d.getUTCFullYear()}-Q${q}`;
}

function monthKey(d: Date): string {
  return belgradeDayKey(d).slice(0, 7);
}

function fmt(v: number | null | undefined, digits = 2) {
  return v == null || !Number.isFinite(v) ? "N/A" : v.toFixed(digits);
}

function num(v: string, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

// --- Component ---------------------------------------------------------------

function CbamPage() {
  const { t } = useLang();
  const requestedRange = useRequestedRangeKeys();
  const [settings, setSettings] = useState<CbamSettings>(() => loadSettings());
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }, [settings]);

  const live = useQuery({
    queryKey: ["cbam-prices", requestedRange.fromKey, requestedRange.toKey],
    queryFn: () =>
      fetchMarketPrices({
        data: { from: requestedRange.fromKey, to: requestedRange.toKey },
      }),
    staleTime: 60 * 60_000,
  });

  const hupx = useQuery({
    queryKey: ["cbam-hupx", requestedRange.fromKey, requestedRange.toKey],
    queryFn: () =>
      fetchHupxPrices({
        data: { from: requestedRange.fromKey, to: requestedRange.toKey },
      }),
    staleTime: 60 * 60_000,
    enabled: settings.destinationCountry === "HU",
  });

  const hupxMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of hupx.data?.points ?? []) {
      const d = new Date(p.ts);
      d.setUTCMinutes(0, 0, 0);
      m.set(d.toISOString(), p.price);
    }
    return m;
  }, [hupx.data]);

  const useHupx =
    settings.destinationCountry === "HU" && hupxMap.size > 0;

  const rawPoints = live.data?.points ?? [];
  const lastTs = rawPoints[rawPoints.length - 1]?.ts
    ? new Date(rawPoints[rawPoints.length - 1].ts)
    : undefined;
  const firstAvailable = rawPoints[0]?.ts ? new Date(rawPoints[0].ts) : undefined;
  const { fromKey, toKey } = useDashboardRange({
    firstAvailable,
    latestAvailable: lastTs,
  });

  const inRange = useMemo(
    () =>
      rawPoints.filter((p) => {
        const key = belgradeDayKey(new Date(p.ts));
        return (!fromKey || key >= fromKey) && (!toKey || key <= toKey);
      }),
    [rawPoints, fromKey, toKey],
  );

  // Hourly analytics — treat destinationPrice as a flat EU proxy for the
  // selected period (or hourly if a future EU feed is wired in).
  const hourly = useMemo(() => {
    const rows: {
      ts: string;
      seepex: number;
      eu: number;
      quarter: QuarterKey;
      cbamCost: number; // €/MWh net
      otherCosts: number;
      lossAdj: number;
      margin: number;
    }[] = [];
    const otherPerMwh =
      settings.capacityCost + settings.exportFees + settings.tradingCost;
    for (const p of inRange) {
      if (!Number.isFinite(p.price)) continue;
      const d = new Date(p.ts);
      const q = quarterOf(d);
      const cbamPrice = settings.quarterlyPrices[q] ?? 0;
      const cbamCost =
        settings.emissionFactor * (cbamPrice - settings.carbonPricePaid);
      let eu = settings.destinationPrice;
      if (useHupx) {
        const hourKey = new Date(p.ts);
        hourKey.setUTCMinutes(0, 0, 0);
        const hv = hupxMap.get(hourKey.toISOString());
        if (hv != null && Number.isFinite(hv)) eu = hv;
        else continue; // skip hours with no HUPX match when in HUPX mode
      }
      const lossAdj = (settings.lossesPct / 100) * eu;
      const margin = eu - p.price - cbamCost - otherPerMwh - lossAdj;
      rows.push({
        ts: p.ts,
        seepex: p.price,
        eu,
        quarter: q,
        cbamCost,
        otherCosts: otherPerMwh,
        lossAdj,
        margin,
      });
    }
    return rows;
  }, [inRange, settings, useHupx, hupxMap]);

  const period = useMemo(() => {
    if (!hourly.length) return null;
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const seepexAvg = avg(hourly.map((r) => r.seepex));
    const euAvg = avg(hourly.map((r) => r.eu));
    const cbamAvg = avg(hourly.map((r) => r.cbamCost));
    const otherAvg = hourly[0].otherCosts + (settings.lossesPct / 100) * euAvg;
    const marginAvg = avg(hourly.map((r) => r.margin));
    const profitable = hourly.filter((r) => r.margin > 0);
    const nonProfitable = hourly.filter((r) => r.margin <= 0);
    const best = hourly.reduce((a, b) => (a.margin > b.margin ? a : b));
    const worst = hourly.reduce((a, b) => (a.margin < b.margin ? a : b));
    const grossCbam =
      settings.volumeMwh *
      settings.emissionFactor *
      avg(hourly.map((r) => settings.quarterlyPrices[r.quarter] ?? 0));
    const carbonDeduction =
      settings.volumeMwh * settings.emissionFactor * settings.carbonPricePaid;
    const netCbamTotal = grossCbam - carbonDeduction;
    const breakevenEu =
      seepexAvg + cbamAvg + hourly[0].otherCosts + (settings.lossesPct / 100) * euAvg;
    return {
      seepexAvg,
      euAvg,
      cbamAvg,
      otherAvg,
      marginAvg,
      profitable: profitable.length,
      nonProfitable: nonProfitable.length,
      profitableSpread: profitable.length ? avg(profitable.map((r) => r.margin)) : null,
      best,
      worst,
      grossCbam,
      carbonDeduction,
      netCbamTotal,
      totalMargin: settings.volumeMwh * marginAvg,
      breakevenEu,
    };
  }, [hourly, settings]);

  const monthly = useMemo(() => {
    const map = new Map<string, typeof hourly>();
    for (const r of hourly) {
      const k = monthKey(new Date(r.ts));
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, rows]) => {
        const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
        const seepex = avg(rows.map((r) => r.seepex));
        const eu = avg(rows.map((r) => r.eu));
        const cbam = avg(rows.map((r) => r.cbamCost));
        const other = rows[0].otherCosts + (settings.lossesPct / 100) * eu;
        const spreadBefore = eu - seepex;
        const spreadAfter = spreadBefore - cbam - other;
        const profitable = rows.filter((r) => r.margin > 0).length;
        const nonProfitable = rows.length - profitable;
        const cbamTotal =
          settings.volumeMwh * settings.emissionFactor *
          avg(rows.map((r) => settings.quarterlyPrices[r.quarter] ?? 0));
        return {
          month,
          seepex,
          eu,
          spreadBefore,
          cbam,
          other,
          spreadAfter,
          cbamTotal,
          profitable,
          nonProfitable,
        };
      });
  }, [hourly, settings]);

  // Line chart data: SEEPEX, EU, EU after CBAM
  const chartLine = useMemo(
    () =>
      hourly.map((r) => ({
        ts: r.ts.slice(0, 10),
        seepex: +r.seepex.toFixed(2),
        eu: +r.eu.toFixed(2),
        euAfterCbam: +(r.eu - r.cbamCost).toFixed(2),
      })),
    [hourly],
  );
  // Downsample for chart if huge
  const chartLineDs = useMemo(() => {
    if (chartLine.length <= 400) return chartLine;
    const step = Math.ceil(chartLine.length / 400);
    return chartLine.filter((_, i) => i % step === 0);
  }, [chartLine]);

  return (
    <div className="space-y-6">
      <DateRangeControl
        firstAvailable={firstAvailable}
        latestAvailable={lastTs}
      />

      <div className="rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm text-foreground space-y-1.5">
        <p>
          {t(
            "CBAM is formally an obligation of the EU importer/declarant, but it affects the commercial value of Serbian exports.",
            "CBAM je formalno obaveza EU uvoznika/deklaranta, ali utiče na komercijalnu vrednost srpskog izvoza.",
          )}
        </p>
        <p className="text-muted-foreground">
          {t(
            "This calculator is indicative for electricity exports only and is not legal or customs advice. Update the Serbia emission factor and CBAM certificate prices when official EU values change.",
            "Kalkulator je orijentacioni, isključivo za izvoz električne energije, i nije pravni ili carinski savet. Ažurirajte srpski emisioni faktor i CBAM cene kada se zvanične EU vrednosti promene.",
          )}
        </p>
      </div>

      <div
        className={`rounded-xl border p-3 text-sm ${
          useHupx
            ? "border-positive/40 bg-positive/10"
            : "border-border/60 bg-muted/30 text-muted-foreground"
        }`}
      >
        {settings.destinationCountry === "HU" ? (
          useHupx ? (
            <>
              {t(
                `EU price = HUPX (Hungary) day-ahead hourly prices from ENTSO-E — ${hupxMap.size} hours matched to SEEPEX.`,
                `EU cena = HUPX (Mađarska) satne day-ahead cene sa ENTSO-E — ${hupxMap.size} sati usklađeno sa SEEPEX-om.`,
              )}
            </>
          ) : (
            <>
              {t(
                `HUPX (Hungary) selected but no ENTSO-E prices returned for this period${
                  hupx.data?.reason ? ` (${hupx.data.reason})` : ""
                }. Falling back to the flat EU price from settings.`,
                `HUPX (Mađarska) izabrana ali ENTSO-E nije vratio cene za period. Koristi se ravna EU cena iz podešavanja.`,
              )}
            </>
          )
        ) : (
          <>
            {t(
              "EU price = flat destination price from settings. Switch destination to Hungary to use live HUPX hourly prices from ENTSO-E.",
              "EU cena = ravna destinaciona cena iz podešavanja. Izaberi Mađarsku da koristiš satne HUPX cene sa ENTSO-E.",
            )}
          </>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <KpiCard
          label={t("Serbia CBAM adder", "Srpski CBAM dodatak")}
          hint={t(
            "Emission factor × (CBAM certificate price − carbon price paid in Serbia), averaged over the selected period.",
            "Emisioni faktor × (cena CBAM sertifikata − ugljena taksa plaćena u Srbiji), prosek za period.",
          )}
          value={fmt(period?.cbamAvg ?? null)}
          unit="€/MWh"
        />
        <KpiCard
          label={t("Gross CBAM cost", "Bruto CBAM trošak")}
          hint={t(
            "Volume × emission factor × CBAM certificate price (period-avg).",
            "Volumen × emisioni faktor × cena CBAM sertifikata (prosek perioda).",
          )}
          value={fmt(period?.grossCbam ?? null, 2)}
          unit="€"
        />
        <KpiCard
          label={t("Net CBAM cost", "Neto CBAM trošak")}
          hint={t(
            "Gross CBAM cost minus recognised carbon price already paid in Serbia.",
            "Bruto CBAM minus priznata ugljena taksa plaćena u Srbiji.",
          )}
          value={fmt(period?.netCbamTotal ?? null, 2)}
          unit="€"
        />
        <KpiCard
          label={t("Export margin", "Izvozna marža")}
          hint={t(
            "EU destination price − SEEPEX − net CBAM − other export costs − losses.",
            "EU cena − SEEPEX − neto CBAM − ostali izvozni troškovi − gubici.",
          )}
          value={fmt(period?.marginAvg ?? null)}
          unit="€/MWh"
        />
        <KpiCard
          label={t("Breakeven EU price", "Prag rentabilnosti EU cene")}
          hint={t(
            "Minimum EU price at which export breaks even after CBAM and other costs.",
            "Minimalna EU cena pri kojoj se izvoz isplati nakon CBAM i ostalih troškova.",
          )}
          value={fmt(period?.breakevenEu ?? null)}
          unit="€/MWh"
        />
        <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-card flex flex-col justify-between">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("Result", "Rezultat")}
          </div>
          {period ? (
            <div
              className={`mt-3 inline-flex self-start rounded-full px-3 py-1.5 text-sm font-medium ${
                period.marginAvg > 0
                  ? "bg-positive/15 text-positive"
                  : "bg-critical/15 text-critical"
              }`}
            >
              {period.marginAvg > 0
                ? t("Profitable after CBAM", "Profitabilno nakon CBAM")
                : t("Not profitable after CBAM", "Nije profitabilno nakon CBAM")}
            </div>
          ) : (
            <div className="mt-3 text-sm text-muted-foreground">—</div>
          )}
        </div>
      </div>

      {/* Waterfall card */}
      {period && (
        <ChartCard
          title={t("Export margin breakdown", "Dekompozicija izvozne marže")}
          description={t(
            "How each cost component reduces the EU price to the net export margin (€/MWh, period average).",
            "Kako svaka stavka umanjuje EU cenu do neto marže (€/MWh, prosek perioda).",
          )}
        >
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
            {[
              { label: t("EU price", "EU cena"), value: period.euAvg, sign: "+" },
              { label: t("− SEEPEX", "− SEEPEX"), value: -period.seepexAvg, sign: "−" },
              { label: t("− CBAM", "− CBAM"), value: -period.cbamAvg, sign: "−" },
              { label: t("− Other costs", "− Ostali troškovi"), value: -period.otherAvg, sign: "−" },
              { label: t("= Net margin", "= Neto marža"), value: period.marginAvg, sign: "=" },
            ].map((c) => (
              <div
                key={String(c.label)}
                className={`rounded-xl border p-3 ${
                  c.sign === "="
                    ? c.value > 0
                      ? "border-positive/40 bg-positive/10"
                      : "border-critical/40 bg-critical/10"
                    : "border-border/60"
                }`}
              >
                <div className="text-xs text-muted-foreground">{c.label}</div>
                <div className="mt-1 font-display text-xl">
                  {fmt(c.value)} <span className="text-xs text-muted-foreground">€/MWh</span>
                </div>
              </div>
            ))}
          </div>
        </ChartCard>
      )}

      {/* Line chart */}
      {chartLineDs.length > 0 && (
        <ChartCard
          title={t("SEEPEX vs EU destination, before and after CBAM", "SEEPEX vs EU cena, pre i nakon CBAM")}
        >
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartLineDs}>
                <CartesianGrid strokeOpacity={0.15} />
                <XAxis dataKey="ts" tick={{ fontSize: 11 }} minTickGap={40} />
                <YAxis tick={{ fontSize: 11 }} unit=" €" />
                <RTooltip />
                <Legend />
                <Line dataKey="seepex" name="SEEPEX" stroke="#3b82f6" dot={false} />
                <Line dataKey="eu" name="EU dest." stroke="#10b981" dot={false} />
                <Line
                  dataKey="euAfterCbam"
                  name="EU after CBAM"
                  stroke="#f59e0b"
                  dot={false}
                  strokeDasharray="4 3"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      )}

      {/* Monthly bar chart */}
      {monthly.length > 0 && (
        <ChartCard
          title={t("Monthly spread — before vs after CBAM", "Mesečni spread — pre i nakon CBAM")}
        >
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly}>
                <CartesianGrid strokeOpacity={0.15} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit=" €" />
                <RTooltip />
                <Legend />
                <Bar dataKey="spreadBefore" name={t("Before CBAM", "Pre CBAM")} fill="#60a5fa" />
                <Bar dataKey="spreadAfter" name={t("After CBAM", "Nakon CBAM")} fill="#f59e0b" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      )}

      {/* Monthly table */}
      {monthly.length > 0 && (
        <ChartCard title={t("Monthly export economics", "Mesečna izvozna ekonomija")}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left py-2 pr-3">{t("Month", "Mesec")}</th>
                  <th className="text-right py-2 px-2">SEEPEX €/MWh</th>
                  <th className="text-right py-2 px-2">EU €/MWh</th>
                  <th className="text-right py-2 px-2">{t("Spread before", "Spread pre")}</th>
                  <th className="text-right py-2 px-2">CBAM €/MWh</th>
                  <th className="text-right py-2 px-2">{t("Other €/MWh", "Ostalo €/MWh")}</th>
                  <th className="text-right py-2 px-2">{t("Spread after", "Spread nakon")}</th>
                  <th className="text-right py-2 px-2">{t("Total CBAM €", "Ukupno CBAM €")}</th>
                  <th className="text-right py-2 px-2">{t("Profit hours", "Profit sati")}</th>
                  <th className="text-right py-2 pl-2">{t("Loss hours", "Gub. sati")}</th>
                </tr>
              </thead>
              <tbody>
                {monthly.map((m) => (
                  <tr key={m.month} className="border-t border-border/40">
                    <td className="py-2 pr-3 font-medium">{m.month}</td>
                    <td className="text-right px-2">{fmt(m.seepex)}</td>
                    <td className="text-right px-2">{fmt(m.eu)}</td>
                    <td className="text-right px-2">{fmt(m.spreadBefore)}</td>
                    <td className="text-right px-2">{fmt(m.cbam)}</td>
                    <td className="text-right px-2">{fmt(m.other)}</td>
                    <td
                      className={`text-right px-2 font-medium ${
                        m.spreadAfter > 0 ? "text-positive" : "text-critical"
                      }`}
                    >
                      {fmt(m.spreadAfter)}
                    </td>
                    <td className="text-right px-2">{fmt(m.cbamTotal)}</td>
                    <td className="text-right px-2">{m.profitable}</td>
                    <td className="text-right pl-2">{m.nonProfitable}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>
      )}

      {/* Hourly stats */}
      {period && (
        <ChartCard title={t("Hourly export statistics", "Hourly izvozna statistika")}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Stat label={t("Profitable hours", "Profitabilnih sati")} value={period.profitable} />
            <Stat
              label={t("Avg profitable spread", "Prosek profit. spreada")}
              value={`${fmt(period.profitableSpread)} €/MWh`}
            />
            <Stat
              label={t("Best export hour", "Najbolji sat")}
              value={`${period.best.ts.slice(0, 13)}Z · ${fmt(period.best.margin)} €/MWh`}
            />
            <Stat
              label={t("Worst export hour", "Najgori sat")}
              value={`${period.worst.ts.slice(0, 13)}Z · ${fmt(period.worst.margin)} €/MWh`}
            />
            <Stat
              label={t("Total margin for volume", "Ukupna marža za volumen")}
              value={`${fmt(period.totalMargin, 2)} €`}
            />
            <Stat
              label={t("Non-profitable hours", "Neprofitabilnih sati")}
              value={period.nonProfitable}
            />
          </div>
        </ChartCard>
      )}

      {/* Settings */}
      <ChartCard
        title={t("Inputs & assumptions", "Ulazi i pretpostavke")}
        right={
          <Button variant="outline" size="sm" onClick={() => setShowSettings((v) => !v)}>
            {showSettings
              ? t("Hide", "Sakrij")
              : t("Edit inputs", "Izmeni ulaze")}
          </Button>
        }
        description={t(
          "All CBAM parameters, destination price and export costs can be edited. Values are stored locally in this browser.",
          "Svi CBAM parametri, EU cena i izvozni troškovi su editabilni. Vrednosti se čuvaju lokalno u ovom pregledaču.",
        )}
      >
        {showSettings ? (
          <SettingsPanel settings={settings} setSettings={setSettings} />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Stat
              label={t("Emission factor", "Emisioni faktor")}
              value={`${fmt(settings.emissionFactor, 3)} tCO2/MWh`}
            />
            <Stat
              label={t("Carbon price paid (RS)", "Ugljena taksa (RS)")}
              value={`${fmt(settings.carbonPricePaid)} €/tCO2`}
            />
            <Stat
              label={t("Destination", "Destinacija")}
              value={
                COUNTRIES.find((c) => c.code === settings.destinationCountry)?.label ??
                settings.destinationCountry
              }
            />
            <Stat
              label={t("EU price", "EU cena")}
              value={`${fmt(settings.destinationPrice)} €/MWh`}
            />
            <Stat label={t("Volume", "Volumen")} value={`${settings.volumeMwh} MWh`} />
            <Stat
              label={t("Other export costs", "Ostali troškovi")}
              value={`${fmt(
                settings.capacityCost + settings.exportFees + settings.tradingCost,
              )} €/MWh`}
            />
            <Stat label={t("Losses", "Gubici")} value={`${fmt(settings.lossesPct)} %`} />
            <Stat
              label={t("CBAM Q current", "CBAM tekući Q")}
              value={`${fmt(
                settings.quarterlyPrices[quarterOf(new Date())] ?? 0,
              )} €/tCO2`}
            />
          </div>
        )}
      </ChartCard>

      <p className="text-xs text-muted-foreground">
        {t(
          "For electricity exports, use the electricity-specific CBAM calculation. Do not apply the industrial free-allocation phase-in factor unless a separate non-electricity goods module is added.",
          "Za izvoz električne energije koristi se posebna CBAM formula. Ne primenjivati fazni faktor besplatnih dozvola za industrijske proizvode osim ako se ne doda poseban modul za robe.",
        )}
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}

function SettingsPanel({
  settings,
  setSettings,
}: {
  settings: CbamSettings;
  setSettings: (updater: (prev: CbamSettings) => CbamSettings) => void;
}) {
  const { t } = useLang();
  const update = <K extends keyof CbamSettings>(key: K, value: CbamSettings[K]) =>
    setSettings((prev) => ({ ...prev, [key]: value }));

  const setQuarter = (q: QuarterKey, value: number) =>
    setSettings((prev) => ({
      ...prev,
      quarterlyPrices: { ...prev.quarterlyPrices, [q]: value },
    }));

  const quarters = Object.keys(settings.quarterlyPrices).sort();

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-3">
        <Field label={t("Serbia emission factor (tCO2/MWh)", "Emisioni faktor Srbije (tCO2/MWh)")}>
          <Input
            type="number"
            step="0.001"
            value={settings.emissionFactor}
            onChange={(e) => update("emissionFactor", num(e.target.value))}
          />
        </Field>
        <Field label={t("Carbon price paid in Serbia (€/tCO2)", "Ugljena taksa plaćena u Srbiji (€/tCO2)")}>
          <Input
            type="number"
            step="0.01"
            value={settings.carbonPricePaid}
            onChange={(e) => update("carbonPricePaid", num(e.target.value))}
          />
        </Field>
        <Field label={t("Destination EU market", "EU destinacija")}>
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm w-full"
            value={settings.destinationCountry}
            onChange={(e) => update("destinationCountry", e.target.value)}
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Destination EU price (€/MWh)", "EU cena destinacije (€/MWh)")}>
          <Input
            type="number"
            step="0.1"
            value={settings.destinationPrice}
            onChange={(e) => update("destinationPrice", num(e.target.value))}
          />
        </Field>
        <Field label={t("Volume (MWh)", "Volumen (MWh)")}>
          <Input
            type="number"
            step="1"
            value={settings.volumeMwh}
            onChange={(e) => update("volumeMwh", num(e.target.value, 1))}
          />
        </Field>
      </div>
      <div className="space-y-3">
        <Field label={t("Cross-border capacity cost (€/MWh)", "Prekogranični kapacitet (€/MWh)")}>
          <Input
            type="number"
            step="0.1"
            value={settings.capacityCost}
            onChange={(e) => update("capacityCost", num(e.target.value))}
          />
        </Field>
        <Field label={t("Transmission / export fees (€/MWh)", "Prenos / izvozne naknade (€/MWh)")}>
          <Input
            type="number"
            step="0.1"
            value={settings.exportFees}
            onChange={(e) => update("exportFees", num(e.target.value))}
          />
        </Field>
        <Field label={t("Trading / clearing cost (€/MWh)", "Trading / clearing trošak (€/MWh)")}>
          <Input
            type="number"
            step="0.1"
            value={settings.tradingCost}
            onChange={(e) => update("tradingCost", num(e.target.value))}
          />
        </Field>
        <Field label={t("Losses (%)", "Gubici (%)")}>
          <Input
            type="number"
            step="0.1"
            value={settings.lossesPct}
            onChange={(e) => update("lossesPct", num(e.target.value))}
          />
        </Field>
      </div>

      <div className="md:col-span-2">
        <div className="text-sm font-medium mb-2">
          {t("CBAM certificate prices (€/tCO2)", "CBAM cene sertifikata (€/tCO2)")}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {quarters.map((q) => (
            <Field key={q} label={q}>
              <Input
                type="number"
                step="0.01"
                value={settings.quarterlyPrices[q]}
                onChange={(e) => setQuarter(q, num(e.target.value))}
              />
            </Field>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const last = quarters[quarters.length - 1];
              const [yStr, qStr] = last.split("-Q");
              let y = parseInt(yStr, 10);
              let q = parseInt(qStr, 10) + 1;
              if (q > 4) {
                q = 1;
                y += 1;
              }
              setQuarter(`${y}-Q${q}`, settings.quarterlyPrices[last]);
            }}
          >
            {t("Add next quarter", "Dodaj sledeći kvartal")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSettings(() => DEFAULT_SETTINGS)}
          >
            {t("Reset to defaults", "Vrati podrazumevano")}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {t(
            "From 2027 the EU is expected to publish weekly CBAM prices. When available, replace quarterly values or extend this schedule.",
            "Od 2027. očekuje se nedeljna CBAM cena. Kada bude dostupna, zameni kvartalne vrednosti ili proširi raspored.",
          )}
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
