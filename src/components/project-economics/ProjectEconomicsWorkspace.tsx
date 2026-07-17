import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Database, RotateCcw, Upload } from "lucide-react";
import { toast } from "sonner";

import { ChartCard } from "@/components/dashboard/atoms";
import {
  BessFields,
  FieldGroup,
  HybridFields,
  NumberField,
  SelectField,
  SolarFields,
  WindFields,
} from "@/components/project-economics/AssumptionFields";
import { EconomicsResults } from "@/components/project-economics/EconomicsResults";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getDemoYear } from "@/lib/demo-data";
import { getFuturesDashboard } from "@/lib/eex-futures.server";
import { FUTURES_MARKET_LIST } from "@/lib/futures-markets";
import { useLang } from "@/lib/i18n";
import { fetchPvgis } from "@/lib/pvgis.functions";
import { runBessEconomics } from "@/lib/project-economics/bess";
import {
  DEFAULT_BESS_ASSUMPTIONS,
  DEFAULT_HYBRID_ASSUMPTIONS,
  DEFAULT_PRICE_ASSUMPTIONS,
  DEFAULT_SOLAR_ASSUMPTIONS,
  DEFAULT_WIND_ASSUMPTIONS,
} from "@/lib/project-economics/defaults";
import { runHybridEconomics } from "@/lib/project-economics/hybrid";
import { buildExpectedPriceCurve } from "@/lib/project-economics/price-curve";
import { runSolarEconomics } from "@/lib/project-economics/solar";
import type {
  AssetType,
  ExpectedPriceCurve,
  FuturesCurveContract,
  HourlyPricePoint,
  PriceAssumptions,
} from "@/lib/project-economics/types";
import { runWindEconomics } from "@/lib/project-economics/wind";

const LOCATIONS: Record<string, { lat: number; lon: number }> = {
  Belgrade: { lat: 44.787, lon: 20.457 },
  "Novi Sad": { lat: 45.255, lon: 19.845 },
  Nis: { lat: 43.321, lon: 21.896 },
  Kragujevac: { lat: 44.014, lon: 20.911 },
  Subotica: { lat: 46.1, lon: 19.667 },
  Zrenjanin: { lat: 45.383, lon: 20.383 },
  Bor: { lat: 44.075, lon: 22.095 },
  Kraljevo: { lat: 43.725, lon: 20.689 },
};

function parseHourlyCsv(text: string, valueNames: string[]) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((value) => value.trim().toLowerCase());
  const timestampIndex = headers.findIndex((header) =>
    ["ts", "timestamp", "datetime"].includes(header),
  );
  const valueIndex = headers.findIndex((header) => valueNames.includes(header));
  if (timestampIndex < 0 || valueIndex < 0) return [];
  return lines
    .slice(1)
    .map((line) => line.split(","))
    .map((columns) => ({
      ts: columns[timestampIndex]?.trim(),
      value: Number(columns[valueIndex]?.trim()),
    }))
    .filter((row) => row.ts && Number.isFinite(Date.parse(row.ts)) && Number.isFinite(row.value));
}

function shiftedCurve(curve: ExpectedPriceCurve, factor: number): ExpectedPriceCurve {
  return {
    ...curve,
    hourly: curve.hourly.map((point) => ({
      ...point,
      priceEurPerMWh: point.priceEurPerMWh * factor,
    })),
    monthly: curve.monthly.map((row) => ({
      ...row,
      targetAverageEurPerMWh: row.targetAverageEurPerMWh * factor,
    })),
    yearly: curve.yearly.map((row) => ({
      ...row,
      averageEurPerMWh: row.averageEurPerMWh * factor,
    })),
  };
}

function PricePanel({
  assumptions,
  onChange,
  futuresData,
  priceCurve,
  profileSource,
  calculationTimestamp,
  onPriceCsv,
}: {
  assumptions: PriceAssumptions;
  onChange: (value: PriceAssumptions) => void;
  futuresData: ReturnType<
    typeof useQuery<Awaited<ReturnType<ReturnType<typeof useServerFn<typeof getFuturesDashboard>>>>>
  >["data"];
  priceCurve: ExpectedPriceCurve;
  profileSource: string;
  calculationTimestamp: string | null;
  onPriceCsv: (file: File) => void;
}) {
  const { t } = useLang();
  const selectedCurve = futuresData?.curves.find((curve) => curve.market === assumptions.market);
  const stale =
    futuresData?.latestTradingDate != null &&
    Date.now() - Date.parse(futuresData.latestTradingDate) > 7 * 86_400_000;
  const status =
    assumptions.mode === "manual"
      ? "manual"
      : assumptions.mode === "historical"
        ? "demo / uploaded"
        : (selectedCurve?.status ?? "unavailable");
  return (
    <ChartCard
      title={t("Revenue and price assumptions", "Pretpostavke prihoda i cena")}
      description={t(
        "Futures settlements anchor monthly averages while preserving the historical hourly shape. This is a scenario, not a live hourly forecast.",
        "Futures poravnanja sidre mesecne proseke uz ocuvanje istorijskog satnog profila. Ovo je scenario, a ne ziva satna prognoza.",
      )}
      right={
        <span className="rounded border border-border/60 bg-muted px-2 py-1 text-xs uppercase text-muted-foreground">
          {status}
        </span>
      }
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SelectField
          label={t("Price source", "Izvor cene")}
          value={assumptions.mode}
          options={[
            {
              value: "futures",
              label: t("Futures-anchored forecast", "Futures-usidreni scenario"),
            },
            {
              value: "historical",
              label: t("Historical/demo hourly prices", "Istorijske/demo satne cene"),
            },
            { value: "manual", label: t("Manual flat price", "Rucna fiksna cena") },
          ]}
          onChange={(mode) => onChange({ ...assumptions, mode: mode as PriceAssumptions["mode"] })}
        />
        <SelectField
          label={t("Futures market", "Futures trziste")}
          value={assumptions.market}
          options={FUTURES_MARKET_LIST.filter((market) => market.available).map((market) => ({
            value: market.code,
            label: `${market.code} - ${market.country}`,
          }))}
          onChange={(market) => onChange({ ...assumptions, market })}
        />
        <SelectField
          label={t("Load product", "Proizvod opterecenja")}
          value={assumptions.loadType}
          options={[
            { value: "base", label: t("Baseload", "Baseload") },
            { value: "peak", label: t("Peakload", "Peakload") },
          ]}
          onChange={(loadType) =>
            onChange({ ...assumptions, loadType: loadType as PriceAssumptions["loadType"] })
          }
        />
        <NumberField
          label={t("Manual fallback / flat price", "Rucna rezervna / fiksna cena")}
          value={assumptions.manualPriceEurPerMWh}
          unit="EUR/MWh"
          onChange={(manualPriceEurPerMWh) => onChange({ ...assumptions, manualPriceEurPerMWh })}
        />
        <NumberField
          label={t("Terminal annual escalation", "Godisnja terminalna eskalacija")}
          value={assumptions.terminalEscalationPct}
          unit="%/yr"
          onChange={(terminalEscalationPct) => onChange({ ...assumptions, terminalEscalationPct })}
        />
        <div className="space-y-1.5">
          <Label className="text-xs">
            {t("Optional hourly price CSV", "Opcioni CSV satnih cena")}
          </Label>
          <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-xs hover:bg-muted">
            <Upload className="h-4 w-4" />
            ts, price_eur_mwh
            <Input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onPriceCsv(file);
              }}
            />
          </label>
        </div>
      </div>

      {(assumptions.mode === "futures" &&
        (!selectedCurve ||
          selectedCurve.status === "unavailable" ||
          selectedCurve.status === "partial" ||
          selectedCurve.providerType === "eex-public-snapshot" ||
          stale)) ||
      priceCurve.warnings.length ? (
        <div className="mt-4 flex gap-2 rounded-md border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div>
              {t(
                "Futures data may be unavailable, partial, stale or sourced from a public snapshot. The displayed fallback is explicit and no futures price is fabricated.",
                "Futures podaci mogu biti nedostupni, delimicni, zastareli ili iz javnog snimka. Prikazana rezerva je eksplicitna i futures cena se ne izmisljava.",
              )}
            </div>
            {priceCurve.warnings.slice(0, 3).map((warning) => (
              <div key={warning} className="mt-1">
                {warning}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">{t("Provider / source", "Provajder / izvor")}</dt>
          <dd className="mt-1 font-medium">{futuresData?.provider ?? status}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            {t("Latest trading date", "Poslednji datum trgovanja")}
          </dt>
          <dd className="mt-1 font-medium">{futuresData?.latestTradingDate ?? "-"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("Profile source", "Izvor profila")}</dt>
          <dd className="mt-1 font-medium">{profileSource}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("Calculated", "Izracunato")}</dt>
          <dd className="mt-1 font-medium">{calculationTimestamp ?? "-"}</dd>
        </div>
        <div className="sm:col-span-2 xl:col-span-4">
          <dt className="text-muted-foreground">{t("Contracts used", "Korisceni ugovori")}</dt>
          <dd className="mt-1 font-medium">
            {priceCurve.contractsUsed.length
              ? priceCurve.contractsUsed.join(", ")
              : t("None", "Nijedan")}
          </dd>
        </div>
      </dl>
    </ChartCard>
  );
}

export function ProjectEconomicsWorkspace({
  asset,
  onAssetChange,
}: {
  asset: AssetType;
  onAssetChange: (asset: AssetType) => void;
}) {
  const { t } = useLang();
  const [solar, setSolar] = useState(DEFAULT_SOLAR_ASSUMPTIONS);
  const [wind, setWind] = useState(DEFAULT_WIND_ASSUMPTIONS);
  const [bess, setBess] = useState(DEFAULT_BESS_ASSUMPTIONS);
  const [hybrid, setHybrid] = useState(DEFAULT_HYBRID_ASSUMPTIONS);
  const [priceAssumptions, setPriceAssumptions] = useState(DEFAULT_PRICE_ASSUMPTIONS);
  const [location, setLocation] = useState("Belgrade");
  const [customLat, setCustomLat] = useState("");
  const [customLon, setCustomLon] = useState("");
  const [solarProfile, setSolarProfile] = useState<number[] | null>(null);
  const [windProfile, setWindProfile] = useState<number[] | null>(null);
  const [uploadedPrices, setUploadedPrices] = useState<HourlyPricePoint[] | null>(null);
  const [profileSource, setProfileSource] = useState("Indicative deterministic demo profile");
  const [calculationTimestamp, setCalculationTimestamp] = useState<string | null>(null);

  const futuresFn = useServerFn(getFuturesDashboard);
  const futuresQuery = useQuery({
    queryKey: ["project-economics-futures"],
    queryFn: () => futuresFn(),
    staleTime: 15 * 60_000,
  });
  const pvgisFn = useServerFn(fetchPvgis);
  const demo = useMemo(() => getDemoYear(), []);
  const historicalShape = useMemo(
    () =>
      uploadedPrices ??
      demo.map((point) => ({
        ts: point.ts.toISOString(),
        priceEurPerMWh: point.price,
      })),
    [demo, uploadedPrices],
  );
  const selectedCurve = futuresQuery.data?.curves.find(
    (curve) => curve.market === priceAssumptions.market,
  );
  const futuresContracts = useMemo<FuturesCurveContract[]>(
    () =>
      (selectedCurve?.contracts ?? []).map((price) => ({
        contractName: price.contract.contractName,
        loadType: price.contract.loadType,
        maturityType: price.contract.maturityType,
        deliveryStart: price.contract.deliveryStart,
        deliveryEnd: price.contract.deliveryEnd,
        settlementPrice: price.settlementPrice,
        tradingDate: price.tradingDate,
        status: price.status,
      })),
    [selectedCurve],
  );
  const lifetime =
    asset === "solar"
      ? solar.lifetimeYears
      : asset === "wind"
        ? wind.lifetimeYears
        : asset === "bess"
          ? bess.lifetimeYears
          : hybrid.lifetimeYears;
  const priceCurve = useMemo(
    () =>
      buildExpectedPriceCurve({
        historicalShape,
        contracts: futuresContracts,
        mode: priceAssumptions.mode,
        loadType: priceAssumptions.loadType,
        manualFallbackEurPerMWh: priceAssumptions.manualPriceEurPerMWh,
        lifetimeYears: lifetime,
        terminalEscalationPct: priceAssumptions.terminalEscalationPct,
      }),
    [historicalShape, futuresContracts, priceAssumptions, lifetime],
  );
  const effectiveSolarProfile = solarProfile ?? demo.map((point) => point.solar);
  const effectiveWindProfile = windProfile ?? demo.map((point) => point.wind);

  const solarResult = useMemo(
    () =>
      runSolarEconomics({
        assumptions: solar,
        hourlyProfilePerMW: effectiveSolarProfile,
        priceCurve,
      }),
    [solar, effectiveSolarProfile, priceCurve],
  );
  const windResult = useMemo(
    () =>
      runWindEconomics({
        assumptions: wind,
        indicativeProfile: effectiveWindProfile,
        priceCurve,
      }),
    [wind, effectiveWindProfile, priceCurve],
  );
  const bessResult = useMemo(
    () => runBessEconomics({ assumptions: bess, priceCurve }),
    [bess, priceCurve],
  );
  const hybridResult = useMemo(
    () =>
      runHybridEconomics({
        assumptions: hybrid,
        solarProfilePerMW: effectiveSolarProfile,
        windProfile: effectiveWindProfile,
        priceCurve,
      }),
    [hybrid, effectiveSolarProfile, effectiveWindProfile, priceCurve],
  );

  const sensitivity = useMemo(
    () =>
      [
        { label: "-10%", factor: 0.9 },
        { label: t("Base", "Osnovni"), factor: 1 },
        { label: "+10%", factor: 1.1 },
      ].map((scenario) => {
        const scenarioCurve = shiftedCurve(priceCurve, scenario.factor);
        const npvEur =
          asset === "solar"
            ? runSolarEconomics({
                assumptions: solar,
                hourlyProfilePerMW: effectiveSolarProfile,
                priceCurve: scenarioCurve,
              }).npvEur
            : asset === "wind"
              ? runWindEconomics({
                  assumptions: wind,
                  indicativeProfile: effectiveWindProfile,
                  priceCurve: scenarioCurve,
                }).npvEur
              : asset === "bess"
                ? runBessEconomics({ assumptions: bess, priceCurve: scenarioCurve }).npvEur
                : runHybridEconomics({
                    assumptions: hybrid,
                    solarProfilePerMW: effectiveSolarProfile,
                    windProfile: effectiveWindProfile,
                    priceCurve: scenarioCurve,
                  }).npvEur;
        return { label: scenario.label, npvEur };
      }),
    [asset, bess, effectiveSolarProfile, effectiveWindProfile, hybrid, priceCurve, solar, t, wind],
  );

  useEffect(() => {
    setCalculationTimestamp(new Date().toLocaleString("en-GB", { timeZone: "Europe/Belgrade" }));
  }, [solarResult, windResult, bessResult, hybridResult]);

  const loadPvgis = async () => {
    try {
      const fallback = LOCATIONS[location];
      const lat = customLat ? Number(customLat) : fallback.lat;
      const lon = customLon ? Number(customLon) : fallback.lon;
      const result = await pvgisFn({ data: { lat, lon, peakpower: 1 } });
      setSolarProfile(result.hourly);
      setProfileSource(`PVGIS - ${result.yearlyKwhPerKwp.toFixed(0)} kWh/kWp/year`);
      toast.success(t("PVGIS hourly profile loaded", "PVGIS satni profil ucitan"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "PVGIS request failed");
    }
  };

  const reset = () => {
    if (asset === "solar") setSolar({ ...DEFAULT_SOLAR_ASSUMPTIONS });
    if (asset === "wind") setWind({ ...DEFAULT_WIND_ASSUMPTIONS });
    if (asset === "bess") setBess({ ...DEFAULT_BESS_ASSUMPTIONS });
    if (asset === "hybrid") setHybrid({ ...DEFAULT_HYBRID_ASSUMPTIONS });
  };

  const validationWarning =
    (asset === "bess" && bess.minSocPct >= bess.maxSocPct) ||
    (asset === "hybrid" && hybrid.bess.minSocPct >= hybrid.bess.maxSocPct)
      ? t(
          "Minimum SOC must be below maximum SOC.",
          "Minimalni SOC mora biti ispod maksimalnog SOC.",
        )
      : null;

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-3xl">{t("Project Economics", "Ekonomika projekata")}</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {t(
              "Editable solar, wind, BESS and hybrid project scenarios with transparent hourly energy and price assumptions.",
              "Izmenjivi solarni, vetro, BESS i hibridni projektni scenariji sa transparentnim satnim energetskim i cenovnim pretpostavkama.",
            )}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={reset}>
          <RotateCcw className="h-4 w-4" />
          {t("Reset current preset", "Resetuj trenutni preset")}
        </Button>
      </section>

      <Tabs value={asset} onValueChange={(value) => onAssetChange(value as AssetType)}>
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4">
          {(["solar", "wind", "bess", "hybrid"] as const).map((value) => (
            <TabsTrigger key={value} value={value} className="min-h-10 capitalize">
              {value === "solar"
                ? t("Solar", "Solar")
                : value === "wind"
                  ? t("Wind", "Vetar")
                  : value === "bess"
                    ? "BESS"
                    : t("Hybrid", "Hibrid")}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <PricePanel
        assumptions={priceAssumptions}
        onChange={setPriceAssumptions}
        futuresData={futuresQuery.data}
        priceCurve={priceCurve}
        profileSource={profileSource}
        calculationTimestamp={calculationTimestamp}
        onPriceCsv={async (file) => {
          const rows = parseHourlyCsv(await file.text(), ["price", "price_eur_mwh"]);
          if (!rows.length)
            return toast.error(t("Invalid hourly price CSV", "Neispravan CSV satnih cena"));
          setUploadedPrices(rows.map((row) => ({ ts: row.ts, priceEurPerMWh: row.value })));
          setPriceAssumptions((current) => ({ ...current, mode: "historical" }));
          toast.success(t("Hourly price CSV loaded", "CSV satnih cena ucitan"));
        }}
      />

      {validationWarning ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {validationWarning}
        </div>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[390px_minmax(0,1fr)]">
        <aside className="space-y-4 rounded-lg border border-border/70 bg-card p-5 shadow-card">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-xl">
              {t("Project assumptions", "Pretpostavke projekta")}
            </h3>
            <span className="rounded bg-muted px-2 py-1 text-[10px] uppercase text-muted-foreground">
              {t("Editable demo preset", "Izmenjivi demo preset")}
            </span>
          </div>

          {asset === "solar" ? (
            <>
              <FieldGroup title={t("Solar profile", "Solarni profil")}>
                <SelectField
                  label={t("Serbian location", "Lokacija u Srbiji")}
                  value={location}
                  options={Object.keys(LOCATIONS).map((value) => ({ value, label: value }))}
                  onChange={setLocation}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder={t("Custom latitude", "Rucna sirina")}
                    value={customLat}
                    onChange={(event) => setCustomLat(event.target.value)}
                  />
                  <Input
                    placeholder={t("Custom longitude", "Rucna duzina")}
                    value={customLon}
                    onChange={(event) => setCustomLon(event.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="w-full gap-2"
                  onClick={loadPvgis}
                >
                  <Database className="h-4 w-4" />
                  {t("Load PVGIS hourly profile", "Ucitaj PVGIS satni profil")}
                </Button>
              </FieldGroup>
              <SolarFields value={solar} onChange={setSolar} />
            </>
          ) : null}
          {asset === "wind" ? (
            <>
              <FieldGroup title={t("Wind profile", "Profil vetra")}>
                <p className="text-xs text-muted-foreground">
                  {t(
                    "The default hourly wind shape is indicative and not site-specific. It is scaled to the selected net capacity factor.",
                    "Podrazumevani satni profil vetra je indikativan i nije lokacijski specifican. Skalira se na izabrani neto faktor kapaciteta.",
                  )}
                </p>
                <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-input px-3 text-xs hover:bg-muted">
                  <Upload className="h-4 w-4" />
                  {t("Upload hourly wind CSV", "Ucitaj CSV satnog vetra")}
                  <Input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      const rows = parseHourlyCsv(await file.text(), [
                        "wind",
                        "wind_profile",
                        "value",
                      ]);
                      if (!rows.length)
                        return toast.error(t("Invalid wind CSV", "Neispravan CSV vetra"));
                      setWindProfile(rows.map((row) => row.value));
                      setProfileSource("Uploaded hourly wind CSV");
                    }}
                  />
                </label>
              </FieldGroup>
              <WindFields value={wind} onChange={setWind} />
            </>
          ) : null}
          {asset === "bess" ? <BessFields value={bess} onChange={setBess} /> : null}
          {asset === "hybrid" ? <HybridFields value={hybrid} onChange={setHybrid} /> : null}

          <p className="border-t border-border/60 pt-4 text-xs text-muted-foreground">
            {t(
              "Indicative calculations only. This tool is not financial or investment advice.",
              "Samo indikativni proracuni. Alat ne predstavlja finansijski niti investicioni savet.",
            )}
          </p>
        </aside>

        <main className="min-w-0 space-y-6">
          <EconomicsResults
            asset={asset}
            renewable={asset === "solar" ? solarResult : asset === "wind" ? windResult : undefined}
            bess={asset === "bess" ? bessResult : undefined}
            hybrid={asset === "hybrid" ? hybridResult : undefined}
            sensitivity={sensitivity}
          />
          <ChartCard title={t("Methodology and limitations", "Metodologija i ogranicenja")}>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
              <li>
                {t(
                  "Futures anchoring shifts each month of the hourly shape to the most granular available month, quarter or year settlement.",
                  "Futures sidrenje pomera svaki mesec satnog profila na najgranularnije dostupno mesecno, kvartalno ili godisnje poravnanje.",
                )}
              </li>
              <li>
                {t(
                  "Years beyond futures coverage use the last covered annual price and the editable terminal escalation.",
                  "Godine izvan futures pokrivenosti koriste poslednju pokrivenu godisnju cenu i izmenjivu terminalnu eskalaciju.",
                )}
              </li>
              <li>
                {t(
                  "BESS dispatch is a chronological daily heuristic, not a claim of mathematical optimality.",
                  "BESS dispeciranje je hronoloska dnevna heuristika, bez tvrdnje o matematickoj optimalnosti.",
                )}
              </li>
              <li>
                {t(
                  "Ancillary-services revenue is a manual assumption and is not presented as ENTSO-E data.",
                  "Prihod od pomocnih usluga je rucna pretpostavka i ne prikazuje se kao ENTSO-E podatak.",
                )}
              </li>
              <li>
                {t(
                  "Taxes, inflation, detailed debt sculpting, imbalance costs and site-specific engineering losses are outside this indicative model.",
                  "Porezi, inflacija, detaljno oblikovanje duga, troskovi debalansa i lokacijski inzenjerski gubici nisu deo ovog indikativnog modela.",
                )}
              </li>
            </ul>
          </ChartCard>
        </main>
      </div>
    </div>
  );
}
