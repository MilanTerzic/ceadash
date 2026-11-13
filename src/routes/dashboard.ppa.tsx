import { useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Download, Save, Trash2, Upload } from "lucide-react";

import { CategoryBars } from "@/components/cea/charts";
import {
  DataState,
  DataTable,
  NumField,
  Panel,
  ProvenanceBadge,
  Segmented,
  Stat,
} from "@/components/cea/primitives";
import { useDateRange } from "@/lib/date-range";
import { useLang } from "@/lib/i18n";
import { hourProfile, toHourlySeries, type Series, EMPTY_SERIES } from "@/lib/see/analytics";
import { genGroup } from "@/lib/see/colors";
import { fmt, fmtCompact, fmtDay, fmtPrice, fmtShare, fmtSigned } from "@/lib/see/format";
import {
  captureStats,
  matchHours,
  monthlyCapture,
  parseProfileCsv,
  scaleToCapacityFactor,
  settle,
  valuePpa,
  type CsvProfile,
  type PpaContract,
  type PpaTerm,
  type Pricing,
  type VolumeBasis,
} from "@/lib/see/ppa";
import { PRICED_CODES, SEE_MARKETS, isSeeCode, type SeeCode } from "@/lib/see/registry";
import { useSelection } from "@/lib/see/selection";
import { hasData, type SeriesStatus } from "@/lib/see/status";
import { usePersistent } from "@/lib/see/store";
import { useSeeFundamentals, useSeePrices } from "@/lib/see/use-see-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/ppa")({
  component: PpaStudio,
});

type Technology = "solar" | "wind" | "baseload";
type ProfileSource = "fleet" | "csv";

interface Inputs {
  name: string;
  market: SeeCode;
  technology: Technology;
  source: ProfileSource;
  capacityMW: number;
  capacityFactorPct: number;
  settlement: "physical" | "financial";
  volumeBasis: VolumeBasis;
  pricing: Pricing;
  strike: number;
  baseloadMW: number;
  indexDiscountPct: number;
  indexFee: number;
  indexFloor: number | null;
  indexCap: number | null;
  skipNegativeHours: boolean;
  balancingCost: number;
  balancingBy: "seller" | "buyer";
  nominationErrorPct: number;
  imbalanceCost: number;
  years: number;
  /** null: use the observed baseload of the period. */
  forwardBaseload: number | null;
  escalationPct: number;
  stressStartPct: number;
  stressPerYearPct: number;
  degradationPct: number;
  discountPct: number;
}
interface SavedProject {
  name: string;
  inputs: Inputs;
  period: string;
  profile: string;
  capturePrice: number | null;
  captureRate: number | null;
  fairStrike: number | null;
  npvSeller: number;
}

// Editable starting points, not market quotes.
const DEFAULTS: Inputs = {
  name: "",
  market: "RS",
  technology: "solar",
  source: "fleet",
  capacityMW: 50,
  capacityFactorPct: 16,
  settlement: "physical",
  volumeBasis: "produced",
  pricing: "fixed",
  strike: 65,
  baseloadMW: 5,
  indexDiscountPct: 8,
  indexFee: 0,
  indexFloor: 0,
  indexCap: null,
  skipNegativeHours: false,
  balancingCost: 3,
  balancingBy: "seller",
  nominationErrorPct: 12,
  imbalanceCost: 25,
  years: 10,
  forwardBaseload: null,
  escalationPct: 0,
  stressStartPct: 0,
  stressPerYearPct: 1,
  degradationPct: 0.4,
  discountPct: 7,
};
const TECH_CF: Record<Technology, number> = { solar: 16, wind: 30, baseload: 100 };
const NO_PROJECTS: SavedProject[] = [];
const SAMPLE_CSV =
  "timestamp_utc,mw\n2026-06-01T03:00:00Z,0\n2026-06-01T04:00:00Z,2.4\n2026-06-01T05:00:00Z,9.8\n2026-06-01T06:00:00Z,19.5\n2026-06-01T07:00:00Z,28.1\n2026-06-01T08:00:00Z,34.6\n2026-06-01T09:00:00Z,38.2\n2026-06-01T10:00:00Z,39.0\n";

function sumSeries(list: Series[]): Series {
  const acc = new Map<number, number>();
  for (const series of list) {
    for (let i = 0; i < series.t.length; i++)
      acc.set(series.t[i], (acc.get(series.t[i]) ?? 0) + series.v[i]);
  }
  const t = [...acc.keys()].sort((a, b) => a - b);
  return { t, v: t.map((hour) => acc.get(hour)!) };
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs font-normal text-ink-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-3.5 w-3.5 accent-[var(--brand)]"
      />
      {label}
    </label>
  );
}

function PpaStudio() {
  const { t, lang } = useLang();
  const { range } = useDateRange();
  const { market: selectedMarket } = useSelection();
  const [inputs, setInputs] = useState<Inputs>(() => ({
    ...DEFAULTS,
    market:
      selectedMarket && SEE_MARKETS[selectedMarket].price !== null
        ? selectedMarket
        : DEFAULTS.market,
  }));
  const set = <K extends keyof Inputs>(key: K, value: Inputs[K]) =>
    setInputs((prev) => ({ ...prev, [key]: value }));
  const [csv, setCsv] = useState<(CsvProfile & { fileName: string }) | null>(null);
  const [csvZone, setCsvZone] = useState<"utc" | "market">("utc");
  const [csvText, setCsvText] = useState<string | null>(null);
  const [sensitivityMode, setSensitivityMode] = useState<"fair" | "npv">("fair");
  const [projects, setProjects] = usePersistent<SavedProject[]>("ppa.projects", NO_PROJECTS);
  const fileRef = useRef<HTMLInputElement>(null);

  const prices = useSeePrices();
  const fundamentals = useSeeFundamentals(
    inputs.technology !== "baseload" && inputs.source === "fleet" ? inputs.market : null,
  );
  const priceEntry = prices.data[inputs.market];
  const priceSeries = priceEntry?.series ?? EMPTY_SERIES;

  // The generation profile, with where it came from.
  const profile = useMemo((): {
    series: Series;
    label: string;
    status?: SeriesStatus;
    clipped: boolean;
  } => {
    if (inputs.technology === "baseload") {
      return {
        series: { t: priceSeries.t, v: priceSeries.t.map(() => inputs.capacityMW) },
        label: t("Flat output at capacity", "Ravna proizvodnja na kapacitetu"),
        clipped: false,
      };
    }
    if (inputs.source === "csv") {
      return {
        series: csv ? toHourlySeries(csv.points) : { t: [], v: [] },
        label: csv ? `CSV · ${csv.fileName}` : "CSV",
        clipped: false,
      };
    }
    const generation = fundamentals.data?.fundamentals.generation ?? {};
    const shape = sumSeries(
      Object.entries(generation)
        .filter(([type]) => genGroup(type) === inputs.technology)
        .map(([, series]) => series),
    );
    const scaled = scaleToCapacityFactor(shape, inputs.capacityMW, inputs.capacityFactorPct / 100);
    return {
      series: scaled,
      label: `${SEE_MARKETS[inputs.market].short} ${inputs.technology === "solar" ? t("solar fleet", "solarna flota") : t("wind fleet", "vetro flota")} · ENTSO-E`,
      status: fundamentals.data?.fundamentals.status.generation,
      clipped: scaled.v.some((value) => value >= inputs.capacityMW - 1e-9) && scaled.v.length > 0,
    };
  }, [
    inputs.technology,
    inputs.source,
    inputs.capacityMW,
    inputs.capacityFactorPct,
    inputs.market,
    csv,
    fundamentals.data,
    priceSeries,
    t,
  ]);

  const matched = useMemo(
    () => matchHours(priceSeries, profile.series),
    [priceSeries, profile.series],
  );
  const stats = useMemo(
    () => captureStats(matched, inputs.capacityMW),
    [matched, inputs.capacityMW],
  );
  const months = useMemo(() => monthlyCapture(matched), [matched]);

  const contract: PpaContract = useMemo(
    () => ({
      volumeBasis: inputs.volumeBasis,
      pricing: inputs.pricing,
      strike: inputs.strike,
      baseloadMW: inputs.baseloadMW,
      indexDiscount: inputs.indexDiscountPct / 100,
      indexFee: inputs.indexFee,
      indexFloor: inputs.indexFloor,
      indexCap: inputs.indexCap,
      skipNegativeHours: inputs.skipNegativeHours,
      balancingCost: inputs.balancingCost,
      balancingBy: inputs.balancingBy,
      nominationError: inputs.nominationErrorPct / 100,
      imbalanceCost: inputs.imbalanceCost,
    }),
    [inputs],
  );
  const forwardBase =
    inputs.forwardBaseload ?? (stats.baseload !== null ? Number(stats.baseload.toFixed(1)) : 0);
  const term: PpaTerm = useMemo(
    () => ({
      years: inputs.years,
      forwardBaseload: forwardBase,
      baseloadEscalation: inputs.escalationPct / 100,
      shapeStressStart: inputs.stressStartPct / 100,
      shapeStressPerYear: inputs.stressPerYearPct / 100,
      degradation: inputs.degradationPct / 100,
      discountRate: inputs.discountPct / 100,
    }),
    [inputs, forwardBase],
  );
  const ready = matched.t.length >= 24 && forwardBase > 0;
  const valuation = useMemo(
    () => (ready ? valuePpa(matched, contract, term) : null),
    [ready, matched, contract, term],
  );
  const observed = useMemo(
    () => (ready ? settle(matched, matched.price, contract) : null),
    [ready, matched, contract],
  );

  const sensitivity = useMemo(() => {
    if (!ready) return null;
    const baseSteps = [-0.2, -0.1, 0, 0.1, 0.2];
    const stressSteps = [0, 0.1, 0.2, 0.3];
    return {
      baseSteps,
      stressSteps,
      cells: baseSteps.map((db) =>
        stressSteps.map((stress) =>
          valuePpa(matched, contract, {
            ...term,
            forwardBaseload: forwardBase * (1 + db),
            shapeStressStart: stress,
          }),
        ),
      ),
    };
  }, [ready, matched, contract, term, forwardBase]);

  const stresses = useMemo(() => {
    if (!ready || !valuation) return [];
    const run = (label: string, c: PpaContract, tm: PpaTerm, gen = 1) => ({
      label,
      result: valuePpa(
        gen === 1 ? matched : { ...matched, gen: matched.gen.map((g) => g * gen) },
        c,
        tm,
      ),
    });
    return [
      run(t("Forward prices −20%", "Terminske cene −20%"), contract, {
        ...term,
        forwardBaseload: forwardBase * 0.8,
      }),
      run(t("Forward prices +20%", "Terminske cene +20%"), contract, {
        ...term,
        forwardBaseload: forwardBase * 1.2,
      }),
      run(t("Output −10%", "Proizvodnja −10%"), contract, term, 0.9),
      run(
        t(
          "Cannibalisation stress +20 pts from year 1",
          "Stres kanibalizacije +20 p.p. od prve godine",
        ),
        contract,
        {
          ...term,
          shapeStressStart: term.shapeStressStart + 0.2,
        },
      ),
      run(
        contract.skipNegativeHours
          ? t("Without the negative-price clause", "Bez klauzule o negativnim cenama")
          : t("With a negative-price clause", "Sa klauzulom o negativnim cenama"),
        { ...contract, skipNegativeHours: !contract.skipNegativeHours },
        term,
      ),
      run(t("Discount rate +2 pts", "Diskontna stopa +2 p.p."), contract, {
        ...term,
        discountRate: term.discountRate + 0.02,
      }),
    ];
  }, [ready, valuation, matched, contract, term, forwardBase, t]);

  const genByHour = useMemo(() => hourProfile({ t: matched.t, v: matched.gen }), [matched]);
  const priceByHour = useMemo(() => hourProfile({ t: matched.t, v: matched.price }), [matched]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    setCsv({ ...parseProfileCsv(text, csvZone), fileName: file.name });
    set("source", "csv");
  };
  const changeZone = (zone: "utc" | "market") => {
    setCsvZone(zone);
    if (csvText && csv) setCsv({ ...parseProfileCsv(csvText, zone), fileName: csv.fileName });
  };
  const downloadSample = () => {
    const url = URL.createObjectURL(new Blob([SAMPLE_CSV], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "cea-generation-profile-sample.csv";
    link.click();
    URL.revokeObjectURL(url);
  };
  const save = () => {
    if (!valuation) return;
    const name = (
      inputs.name ||
      window.prompt(t("Name this project", "Naziv projekta")) ||
      ""
    ).trim();
    if (!name) return;
    setProjects((prev) => [
      ...prev.filter((item) => item.name !== name),
      {
        name,
        inputs: { ...inputs, name },
        period: `${range.from} – ${range.to}`,
        profile: profile.label,
        capturePrice: stats.capturePrice,
        captureRate: stats.captureRate,
        fairStrike: valuation.fairStrike,
        npvSeller: valuation.npvSeller,
      },
    ]);
    set("name", name);
  };

  const loading =
    prices.isLoading ||
    (inputs.source === "fleet" && inputs.technology !== "baseload" && fundamentals.isLoading);
  const isBaseload = inputs.volumeBasis === "baseload";

  return (
    <div className="grid gap-2 p-2 xl:grid-cols-[340px_minmax(0,1fr)]">
      <div className="grid content-start gap-2">
        <Panel title={t("Project", "Projekat")}>
          <div className="grid gap-2.5">
            <label className="grid gap-0.5">
              <span className="text-[11px] font-normal text-muted-foreground">
                {t("Project name", "Naziv projekta")}
              </span>
              <input
                value={inputs.name}
                onChange={(event) => set("name", event.target.value)}
                placeholder={t("e.g. Banat Solar 50", "npr. Banat Solar 50")}
                className="h-7 rounded-sm border border-input bg-background px-2 text-xs text-foreground"
              />
            </label>
            <label className="grid gap-0.5">
              <span className="text-[11px] font-normal text-muted-foreground">
                {t("Delivery market", "Tržište isporuke")}
              </span>
              <select
                value={inputs.market}
                onChange={(event) =>
                  isSeeCode(event.target.value) && set("market", event.target.value)
                }
                className="h-7 rounded-sm border border-input bg-background px-2 text-xs text-foreground"
              >
                {PRICED_CODES.map((code) => (
                  <option key={code} value={code}>
                    {SEE_MARKETS[code].short} ·{" "}
                    {lang === "sr" ? SEE_MARKETS[code].nameSr : SEE_MARKETS[code].name}
                  </option>
                ))}
              </select>
            </label>
            <Segmented
              value={inputs.technology}
              onChange={(value) =>
                setInputs((prev) => ({
                  ...prev,
                  technology: value,
                  capacityFactorPct: TECH_CF[value],
                }))
              }
              options={[
                { value: "solar", label: t("Solar", "Solar") },
                { value: "wind", label: t("Wind", "Vetar") },
                { value: "baseload", label: "Baseload" },
              ]}
            />
            <div className="grid grid-cols-2 gap-2">
              <NumField
                label={t("Capacity", "Kapacitet")}
                value={inputs.capacityMW}
                onChange={(v) => set("capacityMW", v)}
                unit="MW"
                min={0.1}
              />
              {inputs.technology !== "baseload" && inputs.source === "fleet" && (
                <NumField
                  label={t("Capacity factor", "Faktor kapaciteta")}
                  title={t(
                    "The fleet shape is scaled so its mean equals capacity × this factor",
                    "Oblik flote se skalira tako da prosek bude kapacitet × ovaj faktor",
                  )}
                  value={inputs.capacityFactorPct}
                  onChange={(v) => set("capacityFactorPct", v)}
                  unit="%"
                  min={1}
                  max={100}
                  step={0.5}
                />
              )}
            </div>
            {inputs.technology !== "baseload" && (
              <div className="grid gap-1.5">
                <span className="text-[11px] text-muted-foreground">
                  {t("Hourly generation profile", "Satni profil proizvodnje")}
                </span>
                <Segmented
                  value={inputs.source}
                  onChange={(value) => set("source", value)}
                  options={[
                    {
                      value: "fleet",
                      label: t("Market fleet", "Flota tržišta"),
                      title: t(
                        "Observed national solar or wind output from ENTSO-E, scaled to your capacity",
                        "Izmerena nacionalna proizvodnja iz ENTSO-E, skalirana na vaš kapacitet",
                      ),
                    },
                    { value: "csv", label: t("CSV upload", "CSV fajl") },
                  ]}
                />
                {inputs.source === "csv" && (
                  <div className="grid gap-1.5 rounded-sm border border-border p-2">
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".csv,text/csv,text/plain"
                      className="hidden"
                      onChange={(event) => void onFile(event.target.files?.[0])}
                    />
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-border-strong px-2 text-xs text-foreground hover:bg-surface-2"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        {t("Choose file", "Izaberi fajl")}
                      </button>
                      <button
                        type="button"
                        onClick={downloadSample}
                        className="inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {t("Sample", "Primer")}
                      </button>
                    </div>
                    <label className="flex items-center gap-1.5 text-[11px] font-normal text-muted-foreground">
                      {t("Timestamps without a zone are", "Vremena bez zone su")}
                      <select
                        value={csvZone}
                        onChange={(event) => changeZone(event.target.value as "utc" | "market")}
                        className="h-6 rounded-sm border border-input bg-background px-1 text-xs text-foreground"
                      >
                        <option value="utc">UTC</option>
                        <option value="market">CET/CEST</option>
                      </select>
                    </label>
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      {csv
                        ? `${csv.fileName}: ${csv.points.length} ${t("rows read", "redova učitano")}${csv.badLines.length ? `, ${t("unreadable lines", "nečitljive linije")}: ${csv.badLines.join(", ")}` : ""}. ${matched.t.length} ${t("hours overlap the price period.", "sati se poklapa sa periodom cena.")}`
                        : t(
                            "Two columns: timestamp, MW. Hourly or 15-minute. The file stays in your browser.",
                            "Dve kolone: vreme, MW. Satno ili 15-minutno. Fajl ostaje u vašem pregledaču.",
                          )}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </Panel>

        <Panel title={t("Contract", "Ugovor")}>
          <div className="grid gap-2.5">
            <div className="grid gap-1">
              <span className="text-[11px] text-muted-foreground">{t("Volume", "Količina")}</span>
              <Segmented
                value={inputs.volumeBasis}
                onChange={(value) => set("volumeBasis", value)}
                options={[
                  { value: "produced", label: t("As produced", "Po proizvodnji") },
                  { value: "nominated", label: t("As nominated", "Po nominaciji") },
                  { value: "baseload", label: "Baseload" },
                ]}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <span className="text-[11px] text-muted-foreground">{t("Price", "Cena")}</span>
                <Segmented
                  value={inputs.pricing}
                  onChange={(value) => set("pricing", value)}
                  options={[
                    { value: "fixed", label: t("Fixed", "Fiksna") },
                    { value: "indexed", label: t("Indexed", "Indeksirana") },
                  ]}
                />
              </div>
              <div className="grid gap-1">
                <span className="text-[11px] text-muted-foreground">
                  {t("Settlement", "Poravnanje")}
                </span>
                <Segmented
                  value={inputs.settlement}
                  onChange={(value) => set("settlement", value)}
                  options={[
                    { value: "physical", label: t("Physical", "Fizičko") },
                    { value: "financial", label: t("Virtual", "Virtuelno") },
                  ]}
                />
              </div>
            </div>
            {inputs.settlement === "financial" && (
              <p className="text-[11px] leading-snug text-muted-foreground">
                {t(
                  "A virtual PPA settles the difference to spot in cash while the plant sells at spot. The seller's cash flow equals the physical case, so the valuation is the same; credit, accounting and basis effects are not modelled.",
                  "Virtuelni PPA poravnava razliku prema spotu u novcu dok elektrana prodaje na spotu. Novčani tok prodavca je isti kao u fizičkom slučaju; kreditni, računovodstveni i bazni efekti nisu modelovani.",
                )}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              {inputs.pricing === "fixed" ? (
                <NumField
                  label={t("Strike", "Cena ugovora")}
                  value={inputs.strike}
                  onChange={(v) => set("strike", v)}
                  unit="€/MWh"
                  step={0.5}
                />
              ) : (
                <>
                  <NumField
                    label={t("Discount to spot", "Popust na spot")}
                    value={inputs.indexDiscountPct}
                    onChange={(v) => set("indexDiscountPct", v)}
                    unit="%"
                    min={0}
                    max={99}
                    step={0.5}
                  />
                  <NumField
                    label={t("Fee", "Naknada")}
                    value={inputs.indexFee}
                    onChange={(v) => set("indexFee", v)}
                    unit="€/MWh"
                    min={0}
                    step={0.5}
                  />
                  <NumField
                    label={t("Floor (blank = none)", "Donja granica")}
                    value={inputs.indexFloor ?? NaN}
                    onChange={(v) => set("indexFloor", v)}
                    unit="€/MWh"
                    step={1}
                  />
                  <NumField
                    label={t("Cap (blank = none)", "Gornja granica")}
                    value={inputs.indexCap ?? NaN}
                    onChange={(v) => set("indexCap", v)}
                    unit="€/MWh"
                    step={1}
                  />
                </>
              )}
              {isBaseload && (
                <NumField
                  label={t("Contracted volume", "Ugovorena količina")}
                  value={inputs.baseloadMW}
                  onChange={(v) => set("baseloadMW", v)}
                  unit="MW"
                  min={0.1}
                  step={0.5}
                />
              )}
            </div>
            {inputs.pricing === "indexed" && (
              <div className="flex gap-3 text-[11px]">
                <button
                  type="button"
                  onClick={() => set("indexFloor", null)}
                  className="text-muted-foreground underline-offset-2 hover:underline"
                >
                  {t("Remove floor", "Ukloni donju granicu")}
                </button>
                <button
                  type="button"
                  onClick={() => set("indexCap", null)}
                  className="text-muted-foreground underline-offset-2 hover:underline"
                >
                  {t("Remove cap", "Ukloni gornju granicu")}
                </button>
              </div>
            )}
            <Toggle
              checked={inputs.skipNegativeHours}
              onChange={(next) => set("skipNegativeHours", next)}
              label={t(
                "No delivery or payment in negative-price hours",
                "Bez isporuke i plaćanja u satima negativnih cena",
              )}
            />
            <div className="grid grid-cols-2 gap-2">
              <NumField
                label={t("Balancing cost", "Trošak balansiranja")}
                value={inputs.balancingCost}
                onChange={(v) => set("balancingCost", v)}
                unit="€/MWh"
                min={0}
                step={0.5}
              />
              {!isBaseload && (
                <div className="grid gap-0.5">
                  <span className="text-[11px] text-muted-foreground">
                    {t("Borne by", "Snosi")}
                  </span>
                  <Segmented
                    value={inputs.balancingBy}
                    onChange={(value) => set("balancingBy", value)}
                    options={[
                      { value: "seller", label: t("Seller", "Prodavac") },
                      { value: "buyer", label: t("Buyer", "Kupac") },
                    ]}
                  />
                </div>
              )}
              {inputs.volumeBasis === "nominated" && (
                <>
                  <NumField
                    label={t("Nomination error", "Greška nominacije")}
                    title={t(
                      "Mean absolute deviation from the day-ahead nomination, share of output",
                      "Prosečno apsolutno odstupanje od nominacije, udeo proizvodnje",
                    )}
                    value={inputs.nominationErrorPct}
                    onChange={(v) => set("nominationErrorPct", v)}
                    unit="%"
                    min={0}
                    max={100}
                  />
                  <NumField
                    label={t("Imbalance cost", "Trošak debalansa")}
                    value={inputs.imbalanceCost}
                    onChange={(v) => set("imbalanceCost", v)}
                    unit="€/MWh"
                    min={0}
                  />
                </>
              )}
            </div>
          </div>
        </Panel>

        <Panel
          title={t("Term and forward assumptions", "Rok i terminske pretpostavke")}
          subtitle={t(
            "Model inputs, not observed forward prices",
            "Ulazi modela, ne izmerene terminske cene",
          )}
        >
          <div className="grid grid-cols-2 gap-2">
            <NumField
              label={t("Contract length", "Trajanje ugovora")}
              value={inputs.years}
              onChange={(v) => set("years", v)}
              unit={t("years", "god.")}
              min={1}
              max={30}
            />
            <NumField
              label={t("Forward baseload, year 1", "Terminski baseload, god. 1")}
              title={t(
                "Starts at the observed baseload of the period",
                "Počinje od izmerenog baseload-a perioda",
              )}
              value={forwardBase}
              onChange={(v) => set("forwardBaseload", v)}
              unit="€/MWh"
              min={1}
              step={0.5}
            />
            <NumField
              label={t("Baseload change", "Promena baseload-a")}
              value={inputs.escalationPct}
              onChange={(v) => set("escalationPct", v)}
              unit="%/y"
              min={-20}
              max={20}
              step={0.5}
            />
            <NumField
              label={t("Output degradation", "Degradacija proizvodnje")}
              value={inputs.degradationPct}
              onChange={(v) => set("degradationPct", v)}
              unit="%/y"
              min={0}
              max={5}
              step={0.1}
            />
            <NumField
              label={t("Shape stress, year 1", "Stres oblika, god. 1")}
              title={t(
                "Cuts prices in the plant's high-output hours, then rescales to the same baseload",
                "Smanjuje cene u satima visoke proizvodnje, zatim skalira na isti baseload",
              )}
              value={inputs.stressStartPct}
              onChange={(v) => set("stressStartPct", v)}
              unit="%"
              min={0}
              max={90}
            />
            <NumField
              label={t("Added per year", "Dodatno godišnje")}
              value={inputs.stressPerYearPct}
              onChange={(v) => set("stressPerYearPct", v)}
              unit={t("pts", "p.p.")}
              min={0}
              max={10}
              step={0.5}
            />
            <NumField
              label={t("Discount rate", "Diskontna stopa")}
              value={inputs.discountPct}
              onChange={(v) => set("discountPct", v)}
              unit="%"
              min={0}
              max={30}
              step={0.5}
            />
          </div>
          {inputs.forwardBaseload !== null && (
            <button
              type="button"
              onClick={() => set("forwardBaseload", null)}
              className="mt-1.5 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            >
              {t(
                "Reset forward baseload to the observed period baseload",
                "Vrati terminski baseload na izmereni baseload perioda",
              )}
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={!valuation}
            className="mt-2 inline-flex h-7 w-full items-center justify-center gap-1.5 rounded-sm bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-40"
          >
            <Save className="h-3.5 w-3.5" />
            {t("Save project", "Sačuvaj projekat")}
          </button>
        </Panel>
      </div>

      <div className="grid content-start gap-2">
        <Panel
          title={t("Observed capture analysis", "Analiza ostvarene capture cene")}
          subtitle={`${SEE_MARKETS[inputs.market].short} · ${fmtDay(range.from)} – ${fmtDay(range.to)} · ${t("profile", "profil")}: ${profile.label}`}
          status={
            <span className="flex gap-1">
              {priceEntry && <ProvenanceBadge status={priceEntry.status} />}
              {profile.status && !hasData(profile.status.state) && (
                <ProvenanceBadge status={profile.status} />
              )}
            </span>
          }
        >
          {matched.t.length < 24 ? (
            <DataState
              loading={loading}
              status={priceSeries.t.length === 0 ? priceEntry?.status : profile.status}
              height={180}
            >
              {priceSeries.t.length > 0 && profile.series.t.length === 0
                ? inputs.source === "csv"
                  ? t(
                      "Upload a generation profile that overlaps the selected period.",
                      "Učitajte profil proizvodnje koji se poklapa sa izabranim periodom.",
                    )
                  : t(
                      "No fleet generation was published for this market and technology. Upload a CSV profile instead.",
                      "Proizvodnja flote nije objavljena za ovo tržište i tehnologiju. Učitajte CSV profil.",
                    )
                : priceSeries.t.length > 0
                  ? t(
                      "Fewer than 24 hours have both a price and a generation value.",
                      "Manje od 24 sata ima i cenu i vrednost proizvodnje.",
                    )
                  : undefined}
            </DataState>
          ) : (
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4 2xl:grid-cols-7">
                <Stat
                  label="Baseload"
                  value={fmtPrice(stats.baseload)}
                  unit="€/MWh"
                  hint={`${stats.hours} ${t("matched hours", "uparenih sati")}`}
                />
                <Stat
                  label={t("Capture price", "Capture cena")}
                  value={fmtPrice(stats.capturePrice)}
                  unit="€/MWh"
                  hint={t("generation weighted", "ponderisano proizvodnjom")}
                />
                <Stat
                  label={t("Capture rate", "Capture stopa")}
                  value={fmtShare(stats.captureRate, 1)}
                />
                <Stat
                  label={t("Profile cost", "Trošak profila")}
                  value={fmt(stats.profileCost, 1)}
                  unit="€/MWh"
                  hint={t("baseload − capture", "baseload − capture")}
                />
                <Stat
                  label={t("Output in <0 hours", "Proizvodnja u <0 satima")}
                  value={fmtShare(stats.negativeVolumeShare, 1)}
                  hint={`${stats.negativeHours} h`}
                />
                <Stat
                  label={t("Capacity factor", "Faktor kapaciteta")}
                  value={fmtShare(stats.capacityFactor, 1)}
                  hint={
                    profile.clipped ? t("clipped at capacity", "ograničeno kapacitetom") : undefined
                  }
                />
                <Stat
                  label={t("Output, period", "Proizvodnja, period")}
                  value={fmtCompact(stats.volumeMWh)}
                  unit="MWh"
                />
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <div>
                  <div className="eyebrow mb-1">
                    {t("Mean output by hour of day", "Prosečna proizvodnja po satu dana")} · MW
                  </div>
                  <CategoryBars
                    height={150}
                    unit="MW"
                    color="var(--series-4)"
                    data={genByHour.map((value, hour) => ({
                      label: String(hour).padStart(2, "0"),
                      value,
                    }))}
                    describe={(label) => `${label}:00`}
                  />
                </div>
                <div>
                  <div className="eyebrow mb-1">
                    {t("Mean price by hour of day", "Prosečna cena po satu dana")} · €/MWh
                  </div>
                  <CategoryBars
                    height={150}
                    unit="€/MWh"
                    color="var(--series-1)"
                    data={priceByHour.map((value, hour) => ({
                      label: String(hour).padStart(2, "0"),
                      value,
                    }))}
                    describe={(label) => `${label}:00`}
                  />
                </div>
              </div>
              {months.length > 1 && (
                <DataTable>
                  <thead>
                    <tr>
                      <th>{t("Month", "Mesec")}</th>
                      <th className="!text-right">Baseload</th>
                      <th className="!text-right">{t("Capture", "Capture")}</th>
                      <th className="!text-right">{t("Rate", "Stopa")}</th>
                      <th className="!text-right">MWh</th>
                      <th className="!text-right">&lt;0 h</th>
                    </tr>
                  </thead>
                  <tbody>
                    {months.map((month) => (
                      <tr key={month.month}>
                        <td className="num">{month.month}</td>
                        <td className="num text-right">{fmtPrice(month.baseload)}</td>
                        <td className="num text-right">{fmtPrice(month.capturePrice)}</td>
                        <td className="num text-right">{fmtShare(month.captureRate, 1)}</td>
                        <td className="num text-right">{fmt(month.volumeMWh, 0)}</td>
                        <td className="num text-right">{month.negativeHours}</td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              )}
              {inputs.source === "fleet" && inputs.technology !== "baseload" && (
                <p className="text-[11px] leading-snug text-muted-foreground">
                  {t(
                    "The profile is the national fleet's measured output scaled to your capacity factor. A single site is more variable and may be correlated differently with price; upload the project's own profile for a contract-grade result.",
                    "Profil je izmerena proizvodnja nacionalne flote skalirana na vaš faktor kapaciteta. Jedna lokacija je promenljivija i može drugačije korelisati sa cenom; učitajte profil projekta za rezultat ugovornog kvaliteta.",
                  )}
                </p>
              )}
            </div>
          )}
        </Panel>

        {valuation && observed && (
          <>
            <Panel
              title={t("Contract valuation", "Vrednovanje ugovora")}
              subtitle={t(
                "Contract versus selling the same output at spot, seller's view. The buyer's value is the opposite sign.",
                "Ugovor u odnosu na prodaju iste proizvodnje na spotu, iz ugla prodavca. Vrednost za kupca je suprotnog znaka.",
              )}
            >
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-5">
                <Stat
                  label={t("Fair strike", "Fer cena")}
                  value={valuation.fairStrike === null ? "—" : fmtPrice(valuation.fairStrike)}
                  unit="€/MWh"
                  hint={
                    inputs.pricing === "indexed"
                      ? t("not defined for indexed pricing", "nije definisano za indeksiranu cenu")
                      : t("strike with zero NPV", "cena sa NPV nula")
                  }
                />
                <Stat
                  label={t("NPV to seller", "NPV za prodavca")}
                  value={fmtCompact(valuation.npvSeller)}
                  unit="€"
                  hint={`@ ${inputs.discountPct}% · ${inputs.years} ${t("years", "god.")}`}
                />
                <Stat
                  label={t("NPV to buyer", "NPV za kupca")}
                  value={fmtCompact(-valuation.npvSeller)}
                  unit="€"
                />
                <Stat
                  label={t("NPV per MWh", "NPV po MWh")}
                  value={fmtSigned(valuation.npvPerMWh, 2)}
                  unit="€/MWh"
                  hint={t("per discounted contracted MWh", "po diskontovanom ugovorenom MWh")}
                />
                <Stat
                  label={t("Realised price, observed", "Ostvarena cena, period")}
                  value={fmtPrice(observed.realisedPrice)}
                  unit="€/MWh"
                  hint={t("on the period's actual prices", "na stvarnim cenama perioda")}
                />
              </div>
              {isBaseload && (
                <p className="mt-3 text-[11.5px] text-ink-2">
                  {t(
                    "On the observed period the seller bought",
                    "U posmatranom periodu prodavac je kupio",
                  )}{" "}
                  <span className="num text-foreground">
                    {fmt(observed.residualBoughtMWh, 0)} MWh
                  </span>{" "}
                  {t(
                    "at spot to cover shortfalls and sold",
                    "na spotu za pokrivanje manjka i prodao",
                  )}{" "}
                  <span className="num text-foreground">
                    {fmt(observed.residualSoldMWh, 0)} MWh
                  </span>{" "}
                  {t("of surplus.", "viška.")}
                </p>
              )}
              <div className="mt-3 max-h-72 overflow-y-auto">
                <DataTable>
                  <thead className="sticky top-0 bg-surface">
                    <tr>
                      <th>{t("Year", "Godina")}</th>
                      <th className="!text-right">Baseload</th>
                      <th className="!text-right">{t("Capture", "Capture")}</th>
                      <th className="!text-right">{t("Rate", "Stopa")}</th>
                      <th className="!text-right">{t("Output MWh", "Proizv. MWh")}</th>
                      <th className="!text-right">{t("Contract MWh", "Ugovor MWh")}</th>
                      <th className="!text-right">{t("Realised €/MWh", "Ostvareno €/MWh")}</th>
                      <th className="!text-right">{t("Merchant €", "Merchant €")}</th>
                      <th className="!text-right">{t("Contract €", "Ugovor €")}</th>
                      <th className="!text-right">{t("Advantage €", "Prednost €")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {valuation.years.map((year) => (
                      <tr key={year.year}>
                        <td className="num">{year.year}</td>
                        <td className="num text-right">{fmtPrice(year.baseload)}</td>
                        <td className="num text-right">{fmtPrice(year.capturePrice)}</td>
                        <td className="num text-right">{fmtShare(year.captureRate, 1)}</td>
                        <td className="num text-right">{fmt(year.producedMWh, 0)}</td>
                        <td className="num text-right">{fmt(year.contractMWh, 0)}</td>
                        <td className="num text-right">{fmtPrice(year.realisedPrice)}</td>
                        <td className="num text-right">{fmtCompact(year.merchantRevenue)}</td>
                        <td className="num text-right">{fmtCompact(year.contractRevenue)}</td>
                        <td
                          className={cn(
                            "num text-right",
                            year.sellerAdvantage < 0 ? "text-down" : "text-foreground",
                          )}
                        >
                          {fmtCompact(year.sellerAdvantage)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              </div>
              <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                {t(
                  "Each year reuses the observed period's hourly shape, scaled to 8,760 hours and to that year's forward baseload, with the shape stress applied. It carries the season of the observed period: use a full year of history for a balanced result. Excludes guarantees of origin, grid charges, credit costs, tax and curtailment by the system operator.",
                  "Svaka godina koristi satni oblik posmatranog perioda, skaliran na 8.760 sati i na terminski baseload te godine, uz primenjeni stres oblika. Nosi sezonu posmatranog perioda: koristite celu godinu istorije za uravnotežen rezultat. Ne uključuje garancije porekla, mrežne naknade, kreditne troškove, porez i redukcije operatora sistema.",
                )}
              </p>
            </Panel>

            <div className="grid gap-2 2xl:grid-cols-2">
              {sensitivity && (
                <Panel
                  title={t("Sensitivity", "Osetljivost")}
                  subtitle={t(
                    "Forward baseload (rows) × shape stress in year 1 (columns)",
                    "Terminski baseload (redovi) × stres oblika u god. 1 (kolone)",
                  )}
                  actions={
                    <Segmented
                      size="xs"
                      value={sensitivityMode}
                      onChange={setSensitivityMode}
                      options={[
                        {
                          value: "fair",
                          label: t("Fair strike", "Fer cena"),
                          disabled: inputs.pricing === "indexed",
                        },
                        { value: "npv", label: t("NPV to seller", "NPV prodavca") },
                      ]}
                    />
                  }
                  flush
                >
                  <DataTable>
                    <thead>
                      <tr>
                        <th>Baseload €/MWh</th>
                        {sensitivity.stressSteps.map((stress) => (
                          <th key={stress} className="!text-right">
                            {t("stress", "stres")} {fmt(stress * 100, 0)}%
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sensitivity.baseSteps.map((db, row) => (
                        <tr key={db} className={db === 0 ? "bg-surface-2" : undefined}>
                          <td className="num">
                            {fmt(forwardBase * (1 + db), 1)}{" "}
                            <span className="text-muted-foreground">
                              ({fmtSigned(db * 100, 0)}%)
                            </span>
                          </td>
                          {sensitivity.cells[row].map((cell, col) => (
                            <td key={col} className="num text-right">
                              {sensitivityMode === "fair" && inputs.pricing === "fixed"
                                ? fmtPrice(cell.fairStrike)
                                : fmtCompact(cell.npvSeller)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </DataTable>
                </Panel>
              )}
              <Panel
                title={t("Stress tests", "Stres testovi")}
                subtitle={t(
                  "One change at a time against your case",
                  "Jedna promena u odnosu na vaš slučaj",
                )}
                flush
              >
                <DataTable>
                  <thead>
                    <tr>
                      <th>{t("Case", "Slučaj")}</th>
                      <th className="!text-right">{t("Fair strike", "Fer cena")}</th>
                      <th className="!text-right">{t("NPV to seller €", "NPV prodavca €")}</th>
                      <th className="!text-right">Δ NPV €</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="bg-surface-2">
                      <td>{t("Your case", "Vaš slučaj")}</td>
                      <td className="num text-right">{fmtPrice(valuation.fairStrike)}</td>
                      <td className="num text-right">{fmtCompact(valuation.npvSeller)}</td>
                      <td className="num text-right">—</td>
                    </tr>
                    {stresses.map((stress) => (
                      <tr key={stress.label}>
                        <td>{stress.label}</td>
                        <td className="num text-right">{fmtPrice(stress.result.fairStrike)}</td>
                        <td className="num text-right">{fmtCompact(stress.result.npvSeller)}</td>
                        <td className="num text-right">
                          {fmtCompact(stress.result.npvSeller - valuation.npvSeller)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              </Panel>
            </div>
          </>
        )}

        {projects.length > 0 && (
          <Panel
            title={t("Saved projects", "Sačuvani projekti")}
            subtitle={t(
              "Stored on this device with the results computed when saved",
              "Sačuvano na ovom uređaju sa rezultatima izračunatim pri čuvanju",
            )}
            flush
          >
            <DataTable>
              <thead>
                <tr>
                  <th>{t("Project", "Projekat")}</th>
                  <th>{t("Market", "Tržište")}</th>
                  <th>{t("Structure", "Struktura")}</th>
                  <th>{t("Profile", "Profil")}</th>
                  <th className="!text-right">{t("Capture", "Capture")}</th>
                  <th className="!text-right">{t("Rate", "Stopa")}</th>
                  <th className="!text-right">{t("Fair strike", "Fer cena")}</th>
                  <th className="!text-right">{t("NPV seller €", "NPV prodavca €")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.name}>
                    <td>
                      <button
                        type="button"
                        onClick={() => setInputs(project.inputs)}
                        title={t("Load these inputs", "Učitaj ove unose")}
                        className="text-left text-foreground underline-offset-2 hover:underline"
                      >
                        {project.name}
                      </button>
                      <div className="num text-[10.5px] text-muted-foreground">
                        {project.period}
                      </div>
                    </td>
                    <td className="font-condensed text-xs font-semibold">
                      {SEE_MARKETS[project.inputs.market].short}
                    </td>
                    <td className="text-[11.5px] text-ink-2">
                      {project.inputs.technology} · {project.inputs.volumeBasis} ·{" "}
                      {project.inputs.pricing}
                    </td>
                    <td className="text-[11.5px] text-muted-foreground">{project.profile}</td>
                    <td className="num text-right">{fmtPrice(project.capturePrice)}</td>
                    <td className="num text-right">{fmtShare(project.captureRate, 1)}</td>
                    <td className="num text-right">{fmtPrice(project.fairStrike)}</td>
                    <td className="num text-right">{fmtCompact(project.npvSeller)}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        aria-label={`${t("Delete", "Obriši")} ${project.name}`}
                        onClick={() =>
                          setProjects((prev) => prev.filter((item) => item.name !== project.name))
                        }
                        className="text-muted-foreground hover:text-critical"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </Panel>
        )}

        <p className="px-1 text-[11.5px] text-muted-foreground">
          {t(
            "For project IRR with CAPEX, debt and tax, use",
            "Za IRR projekta sa CAPEX-om, dugom i porezom koristite",
          )}{" "}
          <Link
            to="/dashboard/calculator"
            search={((prev: Record<string, unknown>) => prev) as never}
            className="inline-flex items-center gap-1 text-ink-2 underline-offset-2 hover:underline"
          >
            {t("Project Economics", "Ekonomiku projekata")} <ArrowRight className="h-3 w-3" />
          </Link>
        </p>
      </div>
    </div>
  );
}
