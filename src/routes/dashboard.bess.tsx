import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Save, Trash2 } from "lucide-react";

import { CategoryBars, TimeChart } from "@/components/cea/charts";
import {
  DataState,
  DataTable,
  NumField,
  Panel,
  ProvenanceBadge,
  Segmented,
  Stat,
} from "@/components/cea/primitives";
import { FocusControl } from "@/components/see/FocusControl";
import { useDateRange } from "@/lib/date-range";
import { useLang } from "@/lib/i18n";
import { EMPTY_SERIES } from "@/lib/see/analytics";
import {
  checkDispatch,
  optimiseDispatch,
  validParams,
  valueBess,
  type BessInvestment,
  type BessParams,
} from "@/lib/see/bess";
import { fmt, fmtCompact, fmtDay, fmtPrice, fmtShare } from "@/lib/see/format";
import { focusSeries, type Focus } from "@/lib/see/region";
import {
  CORE_PRICED_CODES,
  PRICED_CODES,
  SEE_MARKETS,
  isSeeCode,
  type SeeCode,
} from "@/lib/see/registry";
import { useSelection } from "@/lib/see/selection";
import { usePersistent } from "@/lib/see/store";
import { useSeePrices } from "@/lib/see/use-see-data";

export const Route = createFileRoute("/dashboard/bess")({
  component: BessLab,
});

interface Config {
  market: SeeCode;
  powerMW: number;
  durationH: number;
  rtePct: number;
  socMinPct: number;
  socMaxPct: number;
  cycles: number;
  variableCost: number;
  reservedPct: number;
  capexPerKWh: number;
  capexPerKW: number;
  fixedOpex: number;
  availabilityPct: number;
  degradationPct: number;
  lifetime: number;
  discountPct: number;
  reservedRevenue: number;
}
interface Scenario {
  name: string;
  config: Config;
  /** Results stored with the scenario so a comparison shows what was computed then. */
  period: string;
  marginPerMWYear: number;
  npv: number;
  irr: number | null;
  cyclesPerDay: number | null;
}

// Starting assumptions are editable illustrations, not market quotes.
const DEFAULTS: Config = {
  market: "RS",
  powerMW: 10,
  durationH: 2,
  rtePct: 86,
  socMinPct: 5,
  socMaxPct: 95,
  cycles: 1.5,
  variableCost: 3,
  reservedPct: 0,
  capexPerKWh: 220,
  capexPerKW: 120,
  fixedOpex: 9000,
  availabilityPct: 97,
  degradationPct: 2,
  lifetime: 15,
  discountPct: 8,
  reservedRevenue: 0,
};
const NO_SCENARIOS: Scenario[] = [];
const DURATIONS = [1, 2, 4];

function toParams(config: Config, durationH = config.durationH): BessParams {
  return {
    powerMW: config.powerMW,
    energyMWh: config.powerMW * durationH,
    roundTripEfficiency: config.rtePct / 100,
    socMin: config.socMinPct / 100,
    socMax: config.socMaxPct / 100,
    maxCyclesPerDay: config.cycles,
    variableCost: config.variableCost,
    reservedShare: config.reservedPct / 100,
  };
}
function toInvestment(config: Config): BessInvestment {
  return {
    capexPerKWh: config.capexPerKWh,
    capexPerKW: config.capexPerKW,
    fixedOpexPerMWYear: config.fixedOpex,
    availability: config.availabilityPct / 100,
    degradationPerYear: config.degradationPct / 100,
    lifetimeYears: config.lifetime,
    discountRate: config.discountPct / 100,
    reservedRevenuePerMWYear: config.reservedRevenue,
  };
}

const PARAM_ERRORS: Record<string, { en: string; sr: string }> = {
  power_must_be_positive: { en: "Power must be above zero.", sr: "Snaga mora biti veća od nule." },
  energy_must_be_positive: {
    en: "Duration must be above zero.",
    sr: "Trajanje mora biti veće od nule.",
  },
  efficiency_out_of_range: {
    en: "Round-trip efficiency must be between 1% and 100%.",
    sr: "Efikasnost mora biti između 1% i 100%.",
  },
  soc_window_invalid: {
    en: "Maximum SoC must be above minimum SoC.",
    sr: "Maksimalni SoC mora biti iznad minimalnog.",
  },
  cycles_must_be_positive: {
    en: "Cycles per day must be above zero.",
    sr: "Ciklusi po danu moraju biti iznad nule.",
  },
  variable_cost_negative: {
    en: "Variable cost cannot be negative.",
    sr: "Varijabilni trošak ne može biti negativan.",
  },
  reserved_share_out_of_range: {
    en: "Reserved share must be below 100%.",
    sr: "Rezervisani udeo mora biti ispod 100%.",
  },
};

function BessLab() {
  const { t, lang } = useLang();
  const { range } = useDateRange();
  const { market: selectedMarket } = useSelection();
  const prices = useSeePrices();
  const [config, setConfig] = useState<Config>(() => ({
    ...DEFAULTS,
    market:
      selectedMarket && SEE_MARKETS[selectedMarket].price !== null
        ? selectedMarket
        : DEFAULTS.market,
  }));
  const [scenarios, setScenarios] = usePersistent<Scenario[]>("bess.scenarios", NO_SCENARIOS);
  const set = <K extends keyof Config>(key: K, value: Config[K]) =>
    setConfig((prev) => ({ ...prev, [key]: value }));

  const market = prices.data[config.market];
  const series = market?.series ?? EMPTY_SERIES;
  const params = useMemo(() => toParams(config), [config]);
  const error = validParams(params);
  const result = useMemo(() => optimiseDispatch(series, params), [series, params]);
  const issues = useMemo(() => checkDispatch(result, params), [result, params]);
  const valuation = useMemo(
    () => valueBess(result.summary, params, toInvestment(config)),
    [result, params, config],
  );

  const days = result.daily.map((day) => day.day);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  // Follow the newest day until the user picks one that is still in the period.
  const focus: Focus = {
    mode: "day",
    day: pickedDay && days.includes(pickedDay) ? pickedDay : (days[days.length - 1] ?? ""),
  };
  const focusDay = focus.day;

  const dayView = useMemo(() => {
    const pick = (values: number[]) =>
      focusSeries({ t: result.steps.map((step) => step.t), v: values }, focus);
    return {
      price: pick(result.steps.map((step) => step.price)),
      discharge: pick(result.steps.map((step) => step.dischargeMW)),
      charge: pick(result.steps.map((step) => -step.chargeMW)),
      soc: pick(result.steps.map((step) => step.socMWh)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, focusDay]);

  // Same battery chemistry and costs, run on every core market for three durations.
  const comparison = useMemo(
    () =>
      CORE_PRICED_CODES.map((code) => {
        const data = prices.data[code]?.series;
        return {
          code,
          cells: DURATIONS.map((duration) => {
            if (!data?.t.length || error) return null;
            // A coarser SoC grid keeps this grid of 3 x 11 optimisations fast.
            const run = optimiseDispatch(data, toParams(config, duration), 61);
            return run.summary.days > 0
              ? ((run.summary.netMargin / run.summary.days) *
                  365 *
                  (config.availabilityPct / 100)) /
                  config.powerMW
              : null;
          }),
        };
      }),
    [prices.data, config, error],
  );
  const bestCell = Math.max(
    0,
    ...comparison.flatMap((row) => row.cells.filter((cell): cell is number => cell !== null)),
  );

  const summary = result.summary;
  const hasPrices = series.t.length > 0;
  const perMWDay = summary.days > 0 ? summary.netMargin / summary.days / config.powerMW : null;

  const save = () => {
    const name = window.prompt(
      t("Name this scenario", "Naziv scenarija"),
      `${config.market} ${config.powerMW} MW / ${config.durationH} h`,
    );
    if (!name?.trim()) return;
    setScenarios((prev) => [
      ...prev.filter((item) => item.name !== name.trim()),
      {
        name: name.trim(),
        config,
        period: `${range.from} – ${range.to}`,
        marginPerMWYear: valuation.marginPerMWYear,
        npv: valuation.npv,
        irr: valuation.irr,
        cyclesPerDay: summary.cyclesPerDay,
      },
    ]);
  };

  return (
    <div className="grid gap-2 p-2 xl:grid-cols-[320px_minmax(0,1fr)]">
      <div className="grid content-start gap-2">
        <Panel title={t("Battery", "Baterija")}>
          <div className="grid gap-2.5">
            <label className="grid gap-0.5">
              <span className="text-[11px] font-normal text-muted-foreground">
                {t("Market (day-ahead prices)", "Tržište (day-ahead cene)")}
              </span>
              <select
                value={config.market}
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
            <div>
              <span className="text-[11px] text-muted-foreground">{t("Duration", "Trajanje")}</span>
              <div className="mt-0.5 flex items-center gap-2">
                <Segmented
                  value={DURATIONS.includes(config.durationH) ? String(config.durationH) : "custom"}
                  onChange={(value) => value !== "custom" && set("durationH", Number(value))}
                  options={[
                    { value: "1", label: "1 h" },
                    { value: "2", label: "2 h" },
                    { value: "4", label: "4 h" },
                    {
                      value: "custom",
                      label: t("Custom", "Drugo"),
                      disabled: DURATIONS.includes(config.durationH),
                    },
                  ]}
                />
                <NumField
                  label=""
                  value={config.durationH}
                  onChange={(v) => set("durationH", v)}
                  unit="h"
                  min={0.25}
                  max={12}
                  step={0.25}
                  className="w-20"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumField
                label={t("Power", "Snaga")}
                value={config.powerMW}
                onChange={(v) => set("powerMW", v)}
                unit="MW"
                min={0.1}
                step={1}
              />
              <NumField
                label={t("Energy (derived)", "Energija (izvedeno)")}
                value={Number((config.powerMW * config.durationH).toFixed(2))}
                onChange={(v) => set("durationH", Number((v / config.powerMW).toFixed(2)))}
                unit="MWh"
                min={0.1}
                step={1}
              />
              <NumField
                label={t("Round-trip efficiency", "Kružna efikasnost")}
                value={config.rtePct}
                onChange={(v) => set("rtePct", v)}
                unit="%"
                min={1}
                max={100}
              />
              <NumField
                label={t("Max cycles / day", "Maks. ciklusa / dan")}
                value={config.cycles}
                onChange={(v) => set("cycles", v)}
                min={0.1}
                max={10}
                step={0.1}
              />
              <NumField
                label={t("Min SoC", "Min SoC")}
                value={config.socMinPct}
                onChange={(v) => set("socMinPct", v)}
                unit="%"
                min={0}
                max={99}
              />
              <NumField
                label={t("Max SoC", "Maks SoC")}
                value={config.socMaxPct}
                onChange={(v) => set("socMaxPct", v)}
                unit="%"
                min={1}
                max={100}
              />
              <NumField
                label={t("Variable cost", "Varijabilni trošak")}
                title={t(
                  "Wear and degradation cost per MWh discharged",
                  "Trošak habanja po isporučenom MWh",
                )}
                value={config.variableCost}
                onChange={(v) => set("variableCost", v)}
                unit="€/MWh"
                min={0}
                step={0.5}
              />
              <NumField
                label={t("Power reserved", "Rezervisana snaga")}
                title={t(
                  "Share of power held for other services. It is removed from arbitrage, so income is not counted twice.",
                  "Udeo snage zadržan za druge usluge. Uklanja se iz arbitraže, pa se prihod ne računa dvaput.",
                )}
                value={config.reservedPct}
                onChange={(v) => set("reservedPct", v)}
                unit="%"
                min={0}
                max={99}
              />
            </div>
            {error && (
              <p className="text-xs text-critical">{PARAM_ERRORS[error]?.[lang] ?? error}</p>
            )}
          </div>
        </Panel>

        <Panel
          title={t("Investment assumptions", "Investicione pretpostavke")}
          subtitle={t("Your inputs, not market quotes", "Vaši unosi, ne tržišne kotacije")}
        >
          <div className="grid grid-cols-2 gap-2">
            <NumField
              label="CAPEX"
              value={config.capexPerKWh}
              onChange={(v) => set("capexPerKWh", v)}
              unit="€/kWh"
              min={0}
              step={5}
            />
            <NumField
              label="CAPEX"
              value={config.capexPerKW}
              onChange={(v) => set("capexPerKW", v)}
              unit="€/kW"
              min={0}
              step={5}
            />
            <NumField
              label={t("Fixed O&M", "Fiksni O&M")}
              value={config.fixedOpex}
              onChange={(v) => set("fixedOpex", v)}
              unit="€/MW/y"
              min={0}
              step={500}
            />
            <NumField
              label={t("Availability", "Raspoloživost")}
              value={config.availabilityPct}
              onChange={(v) => set("availabilityPct", v)}
              unit="%"
              min={1}
              max={100}
            />
            <NumField
              label={t("Capacity fade", "Pad kapaciteta")}
              value={config.degradationPct}
              onChange={(v) => set("degradationPct", v)}
              unit="%/y"
              min={0}
              max={20}
              step={0.1}
            />
            <NumField
              label={t("Lifetime", "Životni vek")}
              value={config.lifetime}
              onChange={(v) => set("lifetime", v)}
              unit={t("years", "god.")}
              min={1}
              max={40}
            />
            <NumField
              label={t("Discount rate", "Diskontna stopa")}
              value={config.discountPct}
              onChange={(v) => set("discountPct", v)}
              unit="%"
              min={0}
              max={40}
              step={0.5}
            />
            <NumField
              label={t("Reserved-power income", "Prihod rezervisane snage")}
              title={t(
                "Your assumption for capacity or ancillary income on the reserved share",
                "Vaša pretpostavka prihoda od kapaciteta ili pomoćnih usluga",
              )}
              value={config.reservedRevenue}
              onChange={(v) => set("reservedRevenue", v)}
              unit="€/MW/y"
              min={0}
              step={1000}
            />
          </div>
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            {t(
              "No verified FCR, aFRR or mFRR price feed is connected for SEE. Ancillary income enters only through the reserved share and the income you type here.",
              "Nijedan provereni izvor cena FCR, aFRR ili mFRR nije povezan za JIE. Prihod od pomoćnih usluga ulazi samo kroz rezervisani udeo i prihod koji ovde unesete.",
            )}
          </p>
          <button
            type="button"
            onClick={save}
            disabled={!hasPrices || Boolean(error)}
            className="mt-2 inline-flex h-7 w-full items-center justify-center gap-1.5 rounded-sm bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-40"
          >
            <Save className="h-3.5 w-3.5" />
            {t("Save scenario", "Sačuvaj scenario")}
          </button>
        </Panel>
      </div>

      <div className="grid content-start gap-2">
        <Panel
          title={`${t("Optimised day-ahead arbitrage", "Optimizovana day-ahead arbitraža")} · ${SEE_MARKETS[config.market].short}`}
          subtitle={`${config.powerMW} MW / ${fmt(config.powerMW * config.durationH, 1)} MWh · ${fmtDay(range.from)} – ${fmtDay(range.to)}`}
          status={market ? <ProvenanceBadge status={market.status} /> : undefined}
        >
          {!hasPrices ? (
            <DataState loading={prices.isLoading} status={market?.status} height={140} />
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4 2xl:grid-cols-8">
              <Stat
                label={t("Net margin, period", "Neto marža, period")}
                value={fmtCompact(summary.netMargin)}
                unit="€"
                hint={`${summary.days} ${t("days", "dana")}`}
              />
              <Stat label={t("Per MW per day", "Po MW dnevno")} value={fmt(perMWDay, 0)} unit="€" />
              <Stat
                label={t("Annualised", "Godišnje")}
                value={fmtCompact(valuation.arbitrageYear1 / config.powerMW)}
                unit="€/MW/y"
                hint={t("period scaled to 365 days", "period skaliran na 365 dana")}
              />
              <Stat
                label={t("Cycles / day", "Ciklusa / dan")}
                value={fmt(summary.cyclesPerDay, 2)}
                hint={`${t("limit", "limit")} ${config.cycles}`}
              />
              <Stat
                label={t("Avg buy", "Pros. kupovina")}
                value={fmtPrice(summary.avgBuyPrice)}
                unit="€/MWh"
              />
              <Stat
                label={t("Avg sell", "Pros. prodaja")}
                value={fmtPrice(summary.avgSellPrice)}
                unit="€/MWh"
              />
              <Stat
                label={t("Energy sold", "Prodata energija")}
                value={fmtCompact(summary.dischargedMWh)}
                unit="MWh"
              />
              <Stat
                label={t("Wear cost", "Trošak habanja")}
                value={fmtCompact(summary.variableCosts)}
                unit="€"
              />
            </div>
          )}
          <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
            {t(
              "Each delivery day is optimised with perfect foresight of that day's day-ahead prices, starting empty. This is an upper bound on day-ahead arbitrage: it excludes forecast error, intraday and balancing trading, grid fees, taxes and imbalance costs.",
              "Svaki dan isporuke je optimizovan sa savršenim predviđanjem day-ahead cena tog dana, počevši prazno. Ovo je gornja granica day-ahead arbitraže: ne uključuje grešku prognoze, unutardnevnu i balansnu trgovinu, mrežne naknade, poreze i troškove debalansa.",
            )}{" "}
            {issues.length === 0 && hasPrices
              ? t(
                  "Feasibility check passed: power, SoC, energy balance and cycle limits hold in every hour.",
                  "Provera izvodljivosti uspešna: snaga, SoC, energetski bilans i limit ciklusa važe u svakom satu.",
                )
              : issues.length > 0
                ? `${t("Feasibility check failed", "Provera izvodljivosti nije uspela")}: ${issues.slice(0, 3).join(", ")}`
                : ""}
          </p>
        </Panel>

        {hasPrices && !error && (
          <>
            <Panel
              title={t("Hourly dispatch", "Satni dispečing")}
              subtitle={t(
                "Price, grid power and state of charge on one time axis",
                "Cena, snaga na mreži i stanje napunjenosti na istoj vremenskoj osi",
              )}
              actions={
                <FocusControl
                  dayOnly
                  focus={focus}
                  days={days}
                  onChange={(next) => next.mode === "day" && setPickedDay(next.day)}
                />
              }
            >
              <div className="grid gap-3">
                <div>
                  <div className="eyebrow mb-1">
                    {t("Day-ahead price", "Day-ahead cena")} · €/MWh
                  </div>
                  <TimeChart
                    height={120}
                    unit="€/MWh"
                    legend={false}
                    zeroLine
                    series={[
                      {
                        key: "price",
                        label: t("Price", "Cena"),
                        color: "var(--series-1)",
                        data: dayView.price,
                        kind: "step",
                      },
                    ]}
                  />
                </div>
                <div>
                  <div className="eyebrow mb-1">
                    {t(
                      "Grid power: discharge above zero, charge below",
                      "Snaga na mreži: pražnjenje iznad nule, punjenje ispod",
                    )}{" "}
                    · MW
                  </div>
                  <TimeChart
                    height={120}
                    unit="MW"
                    digits={2}
                    zeroLine
                    series={[
                      {
                        key: "discharge",
                        label: t("Discharge (sell)", "Pražnjenje (prodaja)"),
                        color: "var(--series-3)",
                        data: dayView.discharge,
                        kind: "bar",
                        stack: "p",
                      },
                      {
                        key: "charge",
                        label: t("Charge (buy)", "Punjenje (kupovina)"),
                        color: "var(--series-2)",
                        data: dayView.charge,
                        kind: "bar",
                        stack: "p",
                      },
                    ]}
                  />
                </div>
                <div>
                  <div className="eyebrow mb-1">
                    {t("State of charge at hour end", "Stanje napunjenosti na kraju sata")} · MWh
                  </div>
                  <TimeChart
                    height={110}
                    unit="MWh"
                    digits={2}
                    legend={false}
                    yDomain={[0, Number((config.powerMW * config.durationH).toFixed(2))]}
                    series={[
                      {
                        key: "soc",
                        label: "SoC",
                        color: "var(--series-7)",
                        data: dayView.soc,
                        kind: "area",
                      },
                    ]}
                  />
                </div>
              </div>
            </Panel>

            <div className="grid gap-2 2xl:grid-cols-2">
              <Panel
                title={t("Net margin by delivery day", "Neto marža po danu isporuke")}
                subtitle="€"
              >
                <CategoryBars
                  height={190}
                  unit="€"
                  digits={0}
                  color="var(--series-3)"
                  data={result.daily.map((day) => ({
                    label: day.day.slice(5),
                    value: day.netMargin,
                  }))}
                />
              </Panel>

              <Panel
                title={t("Investment case", "Investicioni slučaj")}
                subtitle={t(
                  "Constant conditions: this period repeated every year, with capacity fade",
                  "Konstantni uslovi: ovaj period se ponavlja svake godine, uz pad kapaciteta",
                )}
              >
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
                  <Stat label="CAPEX" value={fmtCompact(valuation.capex)} unit="€" />
                  <Stat
                    label="NPV"
                    value={fmtCompact(valuation.npv)}
                    unit="€"
                    hint={`@ ${config.discountPct}%`}
                  />
                  <Stat
                    label="IRR"
                    value={valuation.irr === null ? "—" : fmtShare(valuation.irr, 1)}
                  />
                  <Stat
                    label={t("Payback", "Povraćaj")}
                    value={fmt(valuation.paybackYears, 1)}
                    unit={t("years", "god.")}
                    hint={
                      valuation.paybackYears === null
                        ? t("not within lifetime", "ne u životnom veku")
                        : undefined
                    }
                  />
                </div>
                <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-[12.5px]">
                  <dt className="text-ink-2">{t("Arbitrage, year 1", "Arbitraža, godina 1")}</dt>
                  <dd className="num text-right">{fmt(valuation.arbitrageYear1, 0)} €</dd>
                  <dt className="text-ink-2">
                    {t("Reserved-power income, year 1", "Prihod rezervisane snage, godina 1")}
                  </dt>
                  <dd className="num text-right">{fmt(valuation.reservedYear1, 0)} €</dd>
                  <dt className="text-ink-2">− {t("Fixed O&M per year", "Fiksni O&M godišnje")}</dt>
                  <dd className="num text-right">{fmt(valuation.fixedOpex, 0)} €</dd>
                  <dt className="border-t border-border pt-1 text-foreground">
                    {t("Net cash flow, year 1", "Neto novčani tok, godina 1")}
                  </dt>
                  <dd className="num border-t border-border pt-1 text-right text-foreground">
                    {fmt(valuation.cashflows[0], 0)} €
                  </dd>
                  <dt className="text-ink-2">
                    {t("Net cash flow, final year", "Neto novčani tok, poslednja godina")}
                  </dt>
                  <dd className="num text-right">
                    {fmt(valuation.cashflows[valuation.cashflows.length - 1], 0)} €
                  </dd>
                </dl>
                <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                  {t(
                    "Revenue is one observed period scaled to a year. It carries that period's season and price shape, with no inflation, augmentation, financing or tax. Use a period of a full year for a seasonally balanced view.",
                    "Prihod je jedan posmatrani period skaliran na godinu. Nosi sezonu i oblik cena tog perioda, bez inflacije, dogradnje, finansiranja i poreza. Koristite period od cele godine za sezonski uravnotežen prikaz.",
                  )}
                </p>
              </Panel>
            </div>

            <Panel
              title={t("Market and duration comparison", "Poređenje tržišta i trajanja")}
              subtitle={t(
                "Annualised net arbitrage margin, € per MW per year, same battery assumptions",
                "Godišnja neto marža arbitraže, € po MW godišnje, iste pretpostavke",
              )}
              flush
            >
              <DataTable>
                <thead>
                  <tr>
                    <th>{t("Market", "Tržište")}</th>
                    {DURATIONS.map((duration) => (
                      <th key={duration} className="!text-right">
                        {duration} h
                      </th>
                    ))}
                    <th
                      className="!text-right"
                      title={t("Gain from 2 h to 4 h", "Dobitak od 2 h do 4 h")}
                    >
                      4 h ÷ 2 h
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.map((row) => (
                    <tr
                      key={row.code}
                      className={row.code === config.market ? "bg-surface-2" : undefined}
                    >
                      <td>
                        <button
                          type="button"
                          onClick={() => set("market", row.code)}
                          className="font-condensed text-xs font-semibold tracking-wide hover:text-brand"
                        >
                          {SEE_MARKETS[row.code].short}
                        </button>
                        <span className="ml-1.5 text-[11px] text-muted-foreground">
                          {SEE_MARKETS[row.code].exchange}
                        </span>
                      </td>
                      {row.cells.map((cell, index) => (
                        <td key={index} className="num text-right">
                          <span className="inline-flex items-center justify-end gap-2">
                            {cell !== null && (
                              <span
                                aria-hidden
                                className="inline-block h-1.5 rounded-[1px] bg-[var(--series-3)]"
                                style={{
                                  width: `${bestCell > 0 ? Math.max(2, (cell / bestCell) * 56) : 0}px`,
                                }}
                              />
                            )}
                            {fmt(cell, 0)}
                          </span>
                        </td>
                      ))}
                      <td className="num text-right text-ink-2">
                        {row.cells[1] && row.cells[2]
                          ? `×${fmt(row.cells[2] / row.cells[1], 2)}`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </Panel>
          </>
        )}

        {scenarios.length > 0 && (
          <Panel
            title={t("Saved scenarios", "Sačuvani scenariji")}
            subtitle={t(
              "Stored on this device with the results computed when saved",
              "Sačuvano na ovom uređaju sa rezultatima izračunatim pri čuvanju",
            )}
            flush
          >
            <DataTable>
              <thead>
                <tr>
                  <th>{t("Scenario", "Scenario")}</th>
                  <th>{t("Market", "Tržište")}</th>
                  <th className="!text-right">MW / h</th>
                  <th>{t("Price period", "Period cena")}</th>
                  <th className="!text-right">€/MW/y</th>
                  <th className="!text-right">NPV €</th>
                  <th className="!text-right">IRR</th>
                  <th className="!text-right">{t("Cycles/day", "Ciklusa/dan")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {scenarios.map((scenario) => (
                  <tr key={scenario.name}>
                    <td>
                      <button
                        type="button"
                        onClick={() => setConfig(scenario.config)}
                        className="text-left text-foreground underline-offset-2 hover:underline"
                        title={t("Load these inputs", "Učitaj ove unose")}
                      >
                        {scenario.name}
                      </button>
                    </td>
                    <td className="font-condensed text-xs font-semibold">
                      {SEE_MARKETS[scenario.config.market].short}
                    </td>
                    <td className="num text-right">
                      {scenario.config.powerMW} / {scenario.config.durationH}
                    </td>
                    <td className="num text-[11.5px] text-muted-foreground">{scenario.period}</td>
                    <td className="num text-right">{fmt(scenario.marginPerMWYear, 0)}</td>
                    <td className="num text-right">{fmtCompact(scenario.npv)}</td>
                    <td className="num text-right">
                      {scenario.irr === null ? "—" : fmtShare(scenario.irr, 1)}
                    </td>
                    <td className="num text-right">{fmt(scenario.cyclesPerDay, 2)}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        aria-label={`${t("Delete", "Obriši")} ${scenario.name}`}
                        onClick={() =>
                          setScenarios((prev) => prev.filter((item) => item.name !== scenario.name))
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
      </div>
    </div>
  );
}
