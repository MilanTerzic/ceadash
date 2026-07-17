import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Battery, BriefcaseBusiness, Factory, Leaf, PlugZap } from "lucide-react";
import { useMemo, useState } from "react";

import { AssetEmptyState } from "@/components/dashboard/WorkspaceSelectors";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/dashboard/atoms";
import { useDateRange } from "@/lib/date-range";
import { fmtNum } from "@/lib/format";
import { useLang } from "@/lib/i18n";
import { fetchMarketPrices } from "@/lib/market.functions";
import { useWorkspace } from "@/lib/workspace";

const portfolioSearch = z.object({
  view: z.enum(["producer", "consumer", "vpp", "battery", "project"]).optional(),
});

export const Route = createFileRoute("/dashboard/portfolio")({
  validateSearch: (search) => portfolioSearch.parse(search),
  head: () => ({ meta: [{ title: "Portfolio & Flexibility - CEA Power Dashboard" }] }),
  component: PortfolioPage,
});

const views = [
  { value: "producer", label: "Producer", sr: "Proizvodjac", icon: Leaf },
  { value: "consumer", label: "Consumer", sr: "Potrosac", icon: Factory },
  { value: "vpp", label: "VPP / Aggregator", sr: "VPP / Agregator", icon: PlugZap },
  { value: "battery", label: "Battery", sr: "Baterija", icon: Battery },
  {
    value: "project",
    label: "Project Economics",
    sr: "Ekonomika projekta",
    icon: BriefcaseBusiness,
  },
] as const;

type BatteryAssumptions = {
  powerMW: number;
  energyMWh: number;
  durationHours: number;
  efficiencyPct: number;
  maxCyclesPerDay: number;
  degradationEurPerMWh: number;
  variableFeesEurPerMWh: number;
  minimumSpreadEurPerMWh: number;
};

type BatteryAssumptionKey = keyof BatteryAssumptions;
type BatteryPricePoint = { ts: string; price: number };

const batteryDefaults: BatteryAssumptions = {
  powerMW: 10,
  energyMWh: 20,
  durationHours: 2,
  efficiencyPct: 85,
  maxCyclesPerDay: 1,
  degradationEurPerMWh: 5,
  variableFeesEurPerMWh: 2,
  minimumSpreadEurPerMWh: 20,
};

function safeNumber(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function belgradeDay(ts: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ts));
}

function intervalHours(points: BatteryPricePoint[]) {
  const diffs = points
    .slice(0, -1)
    .map((point, index) => (Date.parse(points[index + 1].ts) - Date.parse(point.ts)) / 3_600_000)
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 24);
  if (!diffs.length) return 1;
  const counts = new Map<number, number>();
  for (const diff of diffs) counts.set(diff, (counts.get(diff) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

function average(points: BatteryPricePoint[]) {
  return points.length ? points.reduce((sum, point) => sum + point.price, 0) / points.length : null;
}

function formatWindow(points: BatteryPricePoint[]) {
  return points
    .map((point) =>
      new Date(point.ts).toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        timeZone: "Europe/Belgrade",
      }),
    )
    .join(", ");
}

function calculateBatteryArbitrage(points: BatteryPricePoint[], assumptions: BatteryAssumptions) {
  const stepHours = intervalHours(points);
  const intervalsPerCycle = Math.max(1, Math.ceil(assumptions.durationHours / stepHours));
  const efficiency = Math.min(1, Math.max(0.01, assumptions.efficiencyPct / 100));
  const energyPerCycleMWh = Math.min(
    assumptions.energyMWh,
    assumptions.powerMW * assumptions.durationHours,
  );
  const costAdder = assumptions.degradationEurPerMWh + assumptions.variableFeesEurPerMWh;
  const byDay = new Map<string, BatteryPricePoint[]>();
  for (const point of points) {
    const day = belgradeDay(point.ts);
    const rows = byDay.get(day) ?? [];
    rows.push(point);
    byDay.set(day, rows);
  }

  const dayResults = [...byDay.entries()].flatMap(([day, dayPoints]) => {
    if (dayPoints.length < intervalsPerCycle * 2) return [];
    const low = dayPoints.slice().sort((a, b) => a.price - b.price);
    const high = dayPoints.slice().sort((a, b) => b.price - a.price);
    const cycles = Math.max(1, Math.floor(assumptions.maxCyclesPerDay));
    return Array.from({ length: cycles }, (_, cycle) => {
      const charge = low.slice(cycle * intervalsPerCycle, (cycle + 1) * intervalsPerCycle);
      const discharge = high.slice(cycle * intervalsPerCycle, (cycle + 1) * intervalsPerCycle);
      const chargeAvg = average(charge);
      const dischargeAvg = average(discharge);
      if (chargeAvg == null || dischargeAvg == null) return null;
      const grossSpread = dischargeAvg - chargeAvg;
      const netSpread = dischargeAvg * efficiency - chargeAvg;
      const spreadAfterCosts = netSpread - costAdder;
      const profitable = spreadAfterCosts >= assumptions.minimumSpreadEurPerMWh;
      return {
        day,
        cycle: cycle + 1,
        charge,
        discharge,
        chargeAvg,
        dischargeAvg,
        grossSpread,
        netSpread,
        spreadAfterCosts,
        margin: profitable ? spreadAfterCosts * energyPerCycleMWh : 0,
        profitable,
      };
    }).filter((result): result is NonNullable<typeof result> => result != null);
  });

  const best = dayResults.slice().sort((a, b) => b.spreadAfterCosts - a.spreadAfterCosts)[0];
  const profitable = dayResults.filter((result) => result.profitable);
  const dailyMargins = new Map<string, number>();
  for (const result of dayResults) {
    dailyMargins.set(result.day, (dailyMargins.get(result.day) ?? 0) + result.margin);
  }
  const totalMargin = [...dailyMargins.values()].reduce((sum, value) => sum + value, 0);
  const dayCount = byDay.size;
  const avgDailyMargin = dayCount ? totalMargin / dayCount : null;

  return {
    best,
    estimatedCycles: profitable.length,
    estimatedDailyMargin: avgDailyMargin,
    estimatedMonthlyMargin: avgDailyMargin == null ? null : avgDailyMargin * 30,
    profitableDaysPct: dayCount
      ? (new Set(profitable.map((result) => result.day)).size / dayCount) * 100
      : null,
    intervalsPerCycle,
    energyPerCycleMWh,
  };
}

function BatteryInputs({
  assumptions,
  onChange,
}: {
  assumptions: BatteryAssumptions;
  onChange: (key: BatteryAssumptionKey, value: number) => void;
}) {
  const fields: Array<[BatteryAssumptionKey, string, string]> = [
    ["powerMW", "Power", "MW"],
    ["energyMWh", "Energy", "MWh"],
    ["durationHours", "Duration", "h"],
    ["efficiencyPct", "Round-trip efficiency", "%"],
    ["maxCyclesPerDay", "Max cycles / day", ""],
    ["degradationEurPerMWh", "Degradation cost", "EUR/MWh"],
    ["variableFeesEurPerMWh", "Variable fees", "EUR/MWh"],
    ["minimumSpreadEurPerMWh", "Minimum spread", "EUR/MWh"],
  ];
  return (
    <div className="grid gap-3 rounded-lg border border-border/70 bg-card p-5 sm:grid-cols-2 xl:grid-cols-4">
      {fields.map(([key, label, unit]) => (
        <label key={key} className="grid gap-1 text-xs text-muted-foreground">
          <span>{label}</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              step={key === "maxCyclesPerDay" ? 1 : "any"}
              value={assumptions[key]}
              onChange={(event) => onChange(key, Number(event.target.value))}
              className="h-9 min-w-0 rounded-md border border-border/60 bg-surface-2 px-2 text-sm text-foreground"
            />
            {unit ? <span className="w-16 text-[11px]">{unit}</span> : null}
          </div>
        </label>
      ))}
    </div>
  );
}

function ProjectWizard() {
  const steps = ["Project", "Production", "Commercial structure", "Financing", "Results"];
  return (
    <div className="rounded-lg border border-border/70 bg-card p-5">
      <div className="grid gap-2 md:grid-cols-5">
        {steps.map((step, index) => (
          <div key={step} className="rounded-md border border-border/60 bg-surface-2 p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Step {index + 1}
            </div>
            <div className="mt-1 text-sm font-semibold">{step}</div>
          </div>
        ))}
      </div>
      <AssetEmptyState
        title="Project assumptions required"
        description="Enter project, production, commercial and financing assumptions before calculating IRR, NPV, DSCR or break-even PPA."
      />
    </div>
  );
}

function PortfolioPage() {
  const { t } = useLang();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const { range } = useDateRange();
  const { selectedRole } = useWorkspace();
  const active = search.view ?? selectedRole.defaultPortfolioView;
  const [batteryAssumptions, setBatteryAssumptions] = useState<BatteryAssumptions>(batteryDefaults);
  const priceQuery = useQuery({
    queryKey: ["portfolio-battery-prices", range.from, range.to],
    queryFn: () => fetchMarketPrices({ data: { from: range.from, to: range.to } }),
    enabled: active === "battery",
    staleTime: 5 * 60_000,
  });
  const batteryPoints = useMemo<BatteryPricePoint[]>(
    () =>
      (priceQuery.data?.points ?? [])
        .map((point) => ({ ts: point.ts, price: point.price }))
        .filter((point) => Number.isFinite(point.price)),
    [priceQuery.data],
  );
  const cleanBatteryAssumptions = useMemo<BatteryAssumptions>(
    () => ({
      powerMW: safeNumber(batteryAssumptions.powerMW, batteryDefaults.powerMW),
      energyMWh: safeNumber(batteryAssumptions.energyMWh, batteryDefaults.energyMWh),
      durationHours: safeNumber(batteryAssumptions.durationHours, batteryDefaults.durationHours),
      efficiencyPct: safeNumber(batteryAssumptions.efficiencyPct, batteryDefaults.efficiencyPct),
      maxCyclesPerDay: safeNumber(
        batteryAssumptions.maxCyclesPerDay,
        batteryDefaults.maxCyclesPerDay,
      ),
      degradationEurPerMWh: Math.max(0, batteryAssumptions.degradationEurPerMWh || 0),
      variableFeesEurPerMWh: Math.max(0, batteryAssumptions.variableFeesEurPerMWh || 0),
      minimumSpreadEurPerMWh: Math.max(0, batteryAssumptions.minimumSpreadEurPerMWh || 0),
    }),
    [batteryAssumptions],
  );
  const batteryResult = useMemo(
    () => calculateBatteryArbitrage(batteryPoints, cleanBatteryAssumptions),
    [batteryPoints, cleanBatteryAssumptions],
  );
  const updateBatteryAssumption = (key: BatteryAssumptionKey, value: number) => {
    setBatteryAssumptions((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-2xl font-semibold">
          {t("Portfolio & Flexibility", "Portfolio i fleksibilnost")}
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          {t(
            "Shared workspace for producer, consumer, VPP, battery and project-economics workflows. Public market signals are separated from private portfolio availability.",
            "Zajednicki radni prostor za proizvodjace, potrosace, VPP, baterije i ekonomiku projekta. Javni trzisni signali su odvojeni od privatne dostupnosti portfolija.",
          )}
        </p>
      </section>

      <div className="flex flex-wrap gap-2">
        {views.map((view) => {
          const Icon = view.icon;
          return (
            <Button
              key={view.value}
              type="button"
              variant={active === view.value ? "default" : "outline"}
              className="gap-2"
              onClick={() => navigate({ to: "/dashboard/portfolio", search: { view: view.value } })}
            >
              <Icon className="h-4 w-4" />
              {t(view.label, view.sr)}
            </Button>
          );
        })}
      </div>

      {active === "producer" && (
        <div className="space-y-5">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Baseload reference" value="Open Today" />
            <KpiCard label="Solar capture price" value="Market signal" />
            <KpiCard label="Negative-price exposure" value="Market signal" />
            <KpiCard label="Generation coverage" value="N/A" hint="Connect production data." />
          </section>
          <AssetEmptyState description="Connect or upload production data to calculate actual generation, nominations, imbalance, curtailment, revenue and PPA settlement." />
        </div>
      )}

      {active === "consumer" && (
        <div className="space-y-5">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Market reference price" value="Open Today" />
            <KpiCard label="Cheapest intervals" value="Market signal" />
            <KpiCard label="Load-shifting signal" value="Market signal" />
            <KpiCard label="Weighted energy cost" value="N/A" hint="Upload consumption data." />
          </section>
          <AssetEmptyState description="Upload an hourly consumption profile to calculate your weighted energy cost and flexibility potential." />
        </div>
      )}

      {active === "vpp" && (
        <div className="space-y-5">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Market volatility" value="Market signal" />
            <KpiCard label="Negative intervals" value="Market signal" />
            <KpiCard label="2h BESS spread" value="Market signal" />
            <KpiCard label="Portfolio availability" value="N/A" hint="Add flexible assets." />
          </section>
          <AssetEmptyState description="Add flexible assets to calculate portfolio availability and dispatch capability." />
        </div>
      )}

      {active === "battery" && (
        <div className="space-y-5">
          <BatteryInputs assumptions={batteryAssumptions} onChange={updateBatteryAssumption} />
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Gross spread"
              value={batteryResult.best ? fmtNum(batteryResult.best.grossSpread, 1) : "N/A"}
              unit="EUR/MWh"
              hint="Best public day-ahead charge/discharge window in the selected range."
            />
            <KpiCard
              label="Net spread after costs"
              value={batteryResult.best ? fmtNum(batteryResult.best.spreadAfterCosts, 1) : "N/A"}
              unit="EUR/MWh"
              hint="Discharge price adjusted for round-trip efficiency, degradation cost and variable fees."
            />
            <KpiCard
              label="Estimated cycles"
              value={fmtNum(batteryResult.estimatedCycles, 0)}
              unit="profitable"
            />
            <KpiCard
              label="Estimated daily margin"
              value={
                batteryResult.estimatedDailyMargin == null
                  ? "N/A"
                  : fmtNum(batteryResult.estimatedDailyMargin, 0)
              }
              unit="EUR/day"
            />
            <KpiCard
              label="Estimated monthly margin"
              value={
                batteryResult.estimatedMonthlyMargin == null
                  ? "N/A"
                  : fmtNum(batteryResult.estimatedMonthlyMargin, 0)
              }
              unit="EUR/month"
            />
            <KpiCard
              label="Profitable days"
              value={
                batteryResult.profitableDaysPct == null
                  ? "N/A"
                  : fmtNum(batteryResult.profitableDaysPct, 0)
              }
              unit="%"
            />
            <KpiCard
              label="Ancillary-service value"
              value="N/A"
              hint="No ancillary market data connected."
            />
            <KpiCard
              label="Energy per cycle"
              value={fmtNum(batteryResult.energyPerCycleMWh, 1)}
              unit="MWh"
            />
          </section>
          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-border/70 bg-card p-5">
              <h3 className="text-base font-semibold">
                {t("Charging intervals", "Intervali punjenja")}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {batteryResult.best
                  ? formatWindow(batteryResult.best.charge)
                  : t(
                      "No reliable price window is available for the selected period.",
                      "Nema pouzdanog cenovnog prozora za izabrani period.",
                    )}
              </p>
            </div>
            <div className="rounded-lg border border-border/70 bg-card p-5">
              <h3 className="text-base font-semibold">
                {t("Discharge intervals", "Intervali praznjenja")}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {batteryResult.best
                  ? formatWindow(batteryResult.best.discharge)
                  : t(
                      "No reliable price window is available for the selected period.",
                      "Nema pouzdanog cenovnog prozora za izabrani period.",
                    )}
              </p>
            </div>
          </section>
          <AssetEmptyState description="Indicative perfect-foresight arbitrage can use public day-ahead prices. Operationally achievable value requires schedules, constraints and settlement data." />
        </div>
      )}

      {active === "project" && <ProjectWizard />}
    </div>
  );
}
