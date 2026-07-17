import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartCard, KpiCard } from "@/components/dashboard/atoms";
import { useLang } from "@/lib/i18n";
import type {
  AssetType,
  BessResults,
  HybridResults,
  RenewableResults,
} from "@/lib/project-economics/types";

const number = (value: number | null | undefined, digits = 1) =>
  value == null || !Number.isFinite(value)
    ? "-"
    : value.toLocaleString("en-GB", { maximumFractionDigits: digits });

const money = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1_000_000) return `${number(value / 1_000_000, 2)} mEUR`;
  if (Math.abs(value) >= 1_000) return `${number(value / 1_000, 1)} kEUR`;
  return `${number(value, 0)} EUR`;
};

const energy = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value)) return "-";
  return Math.abs(value) >= 1_000 ? `${number(value / 1_000, 1)} GWh` : `${number(value, 0)} MWh`;
};

function CashflowChart({ cashflows }: { cashflows: number[] }) {
  const { t } = useLang();
  return (
    <ChartCard
      title={t("Project cash flow", "Novcani tok projekta")}
      description={t(
        "Equity cash flow after debt service.",
        "Novcani tok kapitala nakon otplate duga.",
      )}
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={cashflows.map((value, year) => ({ year, value: value / 1_000_000 }))}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="year" />
            <YAxis unit=" mEUR" />
            <Tooltip formatter={(value) => `${number(Number(value), 2)} mEUR`} />
            <Line
              dataKey="value"
              name={t("Cash flow", "Novcani tok")}
              stroke="var(--color-chart-2)"
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function SensitivityChart({ rows }: { rows: Array<{ label: string; npvEur: number }> }) {
  const { t } = useLang();
  return (
    <ChartCard
      title={t("Price sensitivity", "Osetljivost na cenu")}
      description={t(
        "NPV under lower, base and higher merchant-price scenarios.",
        "NPV pri nizem, osnovnom i visem merchant cenovnom scenariju.",
      )}
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows.map((row) => ({ ...row, value: row.npvEur / 1_000_000 }))}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="label" />
            <YAxis unit=" mEUR" />
            <Tooltip formatter={(value) => `${number(Number(value), 2)} mEUR`} />
            <Bar dataKey="value" name="NPV" fill="var(--color-chart-1)" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function RenewableView({
  result,
  sensitivity,
}: {
  result: RenewableResults;
  sensitivity: Array<{ label: string; npvEur: number }>;
}) {
  const { t } = useLang();
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label={t("Annual generation", "Godisnja proizvodnja")}
          value={energy(result.annualGenerationMWh)}
        />
        <KpiCard
          label={t("Net capacity factor", "Neto faktor kapaciteta")}
          value={`${number(result.capacityFactor * 100, 1)}%`}
        />
        <KpiCard
          label={t("Capture price", "Capture cena")}
          value={number(result.capturePriceEurPerMWh, 1)}
          unit="EUR/MWh"
        />
        <KpiCard
          label={t("Capture rate", "Capture stopa")}
          value={result.captureRate == null ? "-" : `${number(result.captureRate * 100, 1)}%`}
        />
        <KpiCard
          label={t("Blended realised price", "Kombinovana realizovana cena")}
          value={number(result.blendedPriceEurPerMWh, 1)}
          unit="EUR/MWh"
        />
        <KpiCard label="LCOE" value={number(result.lcoeEurPerMWh, 1)} unit="EUR/MWh" />
        <KpiCard
          label={t("EBITDA year 1", "EBITDA godina 1")}
          value={money(result.annualEbitdaEur[0])}
        />
        <KpiCard
          label={t("Project IRR", "Projektni IRR")}
          value={result.projectIrr == null ? "-" : `${number(result.projectIrr * 100, 1)}%`}
        />
        <KpiCard label="NPV" value={money(result.npvEur)} />
        <KpiCard
          label={t("Payback", "Povrat")}
          value={result.paybackYears == null ? "-" : `${number(result.paybackYears, 1)} y`}
        />
        <KpiCard label="DSCR" value={number(result.dscrMin, 2)} />
        <KpiCard
          label={t("Break-even PPA", "Break-even PPA")}
          value={number(result.breakEvenPpaEurPerMWh, 1)}
          unit="EUR/MWh"
        />
        <KpiCard
          label={t("Merchant revenue", "Merchant prihod")}
          value={money(result.merchantRevenueEur)}
        />
        <KpiCard label={t("PPA revenue", "PPA prihod")} value={money(result.ppaRevenueEur)} />
        <KpiCard
          label={t("Curtailed generation", "Ogranicena proizvodnja")}
          value={energy(result.curtailedGenerationMWh)}
        />
        <KpiCard
          label={t("Negative-price exposure", "Izlozenost negativnim cenama")}
          value={energy(result.negativePriceGenerationMWh)}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title={t("Monthly generation", "Mesecna proizvodnja")}>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={result.monthlyGenerationMWh}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="month" />
                <YAxis unit=" MWh" />
                <Tooltip formatter={(value) => `${number(Number(value), 0)} MWh`} />
                <Bar
                  dataKey="value"
                  name={t("Generation", "Proizvodnja")}
                  fill="var(--color-chart-3)"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
        <ChartCard title={t("Monthly revenue", "Mesecni prihod")}>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={result.monthlyRevenueEur.map((row) => ({ ...row, value: row.value / 1_000 }))}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="month" />
                <YAxis unit=" kEUR" />
                <Tooltip formatter={(value) => `${number(Number(value), 1)} kEUR`} />
                <Bar dataKey="value" name={t("Revenue", "Prihod")} fill="var(--color-chart-1)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>
      <CashflowChart cashflows={result.cashflowsEur} />
      <SensitivityChart rows={sensitivity} />
    </>
  );
}

function BessView({
  result,
  sensitivity,
}: {
  result: BessResults;
  sensitivity: Array<{ label: string; npvEur: number }>;
}) {
  const { t } = useLang();
  const representativeDay =
    Array.from({ length: Math.ceil(result.dispatch.length / 24) }, (_, index) =>
      result.dispatch.slice(index * 24, index * 24 + 24),
    ).find((day) => day.some((point) => point.chargingMW > 0 || point.dischargingMW > 0)) ??
    result.dispatch.slice(0, 24);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label={t("Usable duration", "Korisno trajanje")}
          value={number(result.durationHours, 1)}
          unit="h"
        />
        <KpiCard
          label={t("Annual charged energy", "Godisnja energija punjenja")}
          value={energy(result.annualChargedMWh)}
        />
        <KpiCard
          label={t("Annual discharged energy", "Godisnja energija praznjenja")}
          value={energy(result.annualDischargedMWh)}
        />
        <KpiCard
          label={t("Equivalent full cycles", "Ekvivalentni puni ciklusi")}
          value={number(result.equivalentFullCycles, 0)}
        />
        <KpiCard
          label={t("Average charging price", "Prosecna cena punjenja")}
          value={number(result.averageChargingPriceEurPerMWh, 1)}
          unit="EUR/MWh"
        />
        <KpiCard
          label={t("Average discharging price", "Prosecna cena praznjenja")}
          value={number(result.averageDischargingPriceEurPerMWh, 1)}
          unit="EUR/MWh"
        />
        <KpiCard
          label={t("Captured spread", "Ostvareni spread")}
          value={number(result.capturedSpreadEurPerMWh, 1)}
          unit="EUR/MWh"
        />
        <KpiCard
          label={t("Gross arbitrage", "Bruto arbitraza")}
          value={money(result.grossArbitrageRevenueEur)}
        />
        <KpiCard
          label={t("Tolling revenue", "Tolling prihod")}
          value={money(result.tollingRevenueEur)}
        />
        <KpiCard
          label={t("Ancillary assumption", "Pretpostavka pomocnih usluga")}
          value={money(result.ancillaryRevenueEur)}
        />
        <KpiCard label="LCOS" value={number(result.lcosEurPerMWh, 1)} unit="EUR/MWh" />
        <KpiCard label="EBITDA" value={money(result.annualEbitdaEur[0])} />
        <KpiCard
          label="IRR"
          value={result.projectIrr == null ? "-" : `${number(result.projectIrr * 100, 1)}%`}
        />
        <KpiCard label="NPV" value={money(result.npvEur)} />
        <KpiCard
          label={t("Payback", "Povrat")}
          value={result.paybackYears == null ? "-" : `${number(result.paybackYears, 1)} y`}
        />
        <KpiCard label="DSCR" value={number(result.dscrMin, 2)} />
      </div>
      <ChartCard
        title={t("Representative dispatch day", "Reprezentativni dan dispeciranja")}
        description={t(
          "Deterministic daily arbitrage heuristic; it is not mathematical optimisation.",
          "Deterministicka dnevna arbitrazna heuristika; nije matematicka optimizacija.",
        )}
      >
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={representativeDay.map((point, hour) => ({
                ...point,
                hour,
                charge: -point.chargingMW,
              }))}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="hour" />
              <YAxis yAxisId="power" unit=" MW" />
              <YAxis yAxisId="price" orientation="right" unit=" EUR/MWh" />
              <Tooltip />
              <Legend />
              <Bar
                yAxisId="power"
                dataKey="charge"
                name={t("Charging", "Punjenje")}
                fill="var(--color-chart-4)"
              />
              <Bar
                yAxisId="power"
                dataKey="dischargingMW"
                name={t("Discharging", "Praznjenje")}
                fill="var(--color-chart-2)"
              />
              <Line
                yAxisId="price"
                dataKey="priceEurPerMWh"
                name={t("Price", "Cena")}
                stroke="var(--color-chart-1)"
                dot={false}
              />
              <Line
                yAxisId="power"
                dataKey="socMWh"
                name="SOC (MWh)"
                stroke="var(--color-chart-3)"
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
      <ChartCard title={t("Annual operating revenue", "Godisnji operativni prihod")}>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={result.annualRevenueEur.map((value, index) => ({
                year: index + 1,
                value: value / 1_000,
              }))}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="year" />
              <YAxis unit=" kEUR" />
              <Tooltip formatter={(value) => `${number(Number(value), 1)} kEUR`} />
              <Bar dataKey="value" name={t("Revenue", "Prihod")} fill="var(--color-chart-1)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
      <CashflowChart cashflows={result.cashflowsEur} />
      <SensitivityChart rows={sensitivity} />
    </>
  );
}

function HybridView({
  result,
  sensitivity,
}: {
  result: HybridResults;
  sensitivity: Array<{ label: string; npvEur: number }>;
}) {
  const { t } = useLang();
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label={t("Solar generation", "Solarna proizvodnja")}
          value={energy(result.solarGenerationMWh)}
        />
        <KpiCard
          label={t("Wind generation", "Proizvodnja vetra")}
          value={energy(result.windGenerationMWh)}
        />
        <KpiCard
          label={t("Renewable generation", "OIE proizvodnja")}
          value={energy(result.totalRenewableGenerationMWh)}
        />
        <KpiCard label={t("Grid export", "Izvoz u mrezu")} value={energy(result.gridExportMWh)} />
        <KpiCard
          label={t("Renewable BESS charge", "BESS punjenje iz OIE")}
          value={energy(result.bessChargingFromRenewablesMWh)}
        />
        <KpiCard
          label={t("Grid BESS charge", "BESS punjenje iz mreze")}
          value={energy(result.bessChargingFromGridMWh)}
        />
        <KpiCard
          label={t("BESS discharge", "BESS praznjenje")}
          value={energy(result.bessDischargeMWh)}
        />
        <KpiCard
          label={t("Recovered clipped energy", "Povracena odsecena energija")}
          value={energy(result.recoveredClippedEnergyMWh)}
        />
        <KpiCard
          label={t("Remaining curtailment", "Preostalo ogranicenje")}
          value={energy(result.remainingCurtailmentMWh)}
        />
        <KpiCard
          label={t("Renewable charging share", "OIE udeo punjenja")}
          value={
            result.renewableChargingShare == null
              ? "-"
              : `${number(result.renewableChargingShare * 100, 1)}%`
          }
        />
        <KpiCard
          label={t("Capture price before storage", "Capture cena pre skladistenja")}
          value={number(result.capturePriceBeforeStorageEurPerMWh, 1)}
          unit="EUR/MWh"
        />
        <KpiCard
          label={t("Capture-price uplift", "Rast capture cene")}
          value={number(result.capturePriceUpliftEurPerMWh, 1)}
          unit="EUR/MWh"
        />
        <KpiCard label={t("Combined CAPEX", "Ukupni CAPEX")} value={money(result.totalCapexEur)} />
        <KpiCard label="LCOE / LCOS" value={number(result.lcoeEurPerMWh, 1)} unit="EUR/MWh" />
        <KpiCard
          label="IRR"
          value={result.projectIrr == null ? "-" : `${number(result.projectIrr * 100, 1)}%`}
        />
        <KpiCard label="NPV" value={money(result.npvEur)} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title={t("Monthly energy flows", "Mesecni tokovi energije")}>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={result.monthlyEnergyMWh}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="month" />
                <YAxis unit=" MWh" />
                <Tooltip />
                <Legend />
                <Bar
                  dataKey="renewableExport"
                  name={t("Renewable export", "OIE izvoz")}
                  stackId="a"
                  fill="var(--color-chart-3)"
                />
                <Bar
                  dataKey="batteryDischarge"
                  name={t("BESS discharge", "BESS praznjenje")}
                  stackId="a"
                  fill="var(--color-chart-2)"
                />
                <Bar
                  dataKey="batteryCharge"
                  name={t("BESS charge", "BESS punjenje")}
                  fill="var(--color-chart-4)"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
        <ChartCard title={t("Monthly revenue", "Mesecni prihod")}>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={result.monthlyRevenueEur.map((row) => ({ ...row, value: row.value / 1_000 }))}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="month" />
                <YAxis unit=" kEUR" />
                <Tooltip formatter={(value) => `${number(Number(value), 1)} kEUR`} />
                <Bar dataKey="value" name={t("Revenue", "Prihod")} fill="var(--color-chart-1)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>
      <CashflowChart cashflows={result.cashflowsEur} />
      <SensitivityChart rows={sensitivity} />
    </>
  );
}

export function EconomicsResults({
  asset,
  renewable,
  bess,
  hybrid,
  sensitivity,
}: {
  asset: AssetType;
  renewable?: RenewableResults;
  bess?: BessResults;
  hybrid?: HybridResults;
  sensitivity: Array<{ label: string; npvEur: number }>;
}) {
  if ((asset === "solar" || asset === "wind") && renewable) {
    return <RenewableView result={renewable} sensitivity={sensitivity} />;
  }
  if (asset === "bess" && bess) return <BessView result={bess} sensitivity={sensitivity} />;
  if (asset === "hybrid" && hybrid) return <HybridView result={hybrid} sensitivity={sensitivity} />;
  return null;
}
