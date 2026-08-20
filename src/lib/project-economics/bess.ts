import { calculateFinancialResults, clamp } from "./finance";
import type {
  BessAssumptions,
  BessDispatchPoint,
  BessResults,
  ExpectedPriceCurve,
  HourlyPricePoint,
} from "./types";

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

const BELGRADE_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Belgrade",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function belgradeDayKey(ts: string): string {
  return BELGRADE_DAY.format(new Date(ts));
}

export function dailySignalSets(
  prices: number[],
  durationHours: number,
  cyclesPerDay: number,
  economics?: { roundTripEfficiencyPct?: number; variableThroughputEurPerMWh?: number },
) {
  const count = Math.max(
    0,
    Math.min(Math.floor(prices.length / 2), Math.ceil(durationHours * cyclesPerDay)),
  );
  if (!count) return { charge: new Set<number>(), discharge: new Set<number>() };

  const sorted = prices
    .map((price, index) => ({ price, index }))
    .filter((point) => Number.isFinite(point.price))
    .sort((a, b) => a.price - b.price || a.index - b.index);
  if (sorted.length < 2) return { charge: new Set<number>(), discharge: new Set<number>() };

  const rte = clamp(economics?.roundTripEfficiencyPct ?? 100, 0.01, 100) / 100;
  const variableCost = Math.max(0, economics?.variableThroughputEurPerMWh ?? 0);
  const charge = new Set<number>();
  const discharge = new Set<number>();

  const lows = sorted.slice(0, count);
  const highs = [...sorted].reverse().slice(0, count);
  const used = new Set<number>();
  for (let i = 0; i < Math.min(lows.length, highs.length); i++) {
    const low = lows[i];
    const high = highs[i];
    if (low.index === high.index || used.has(low.index) || used.has(high.index)) continue;
    // For 1 MWh delivered, approximately 1/RTE MWh must be bought. Dispatch
    // only when the output price covers charging energy plus variable cost.
    const netMarginPerMWhOut = high.price - low.price / rte - variableCost;
    if (netMarginPerMWhOut <= 0) continue;
    charge.add(low.index);
    discharge.add(high.index);
    used.add(low.index);
    used.add(high.index);
  }

  return { charge, discharge };
}

function groupByBelgradeDay(prices: HourlyPricePoint[]): HourlyPricePoint[][] {
  const groups = new Map<string, HourlyPricePoint[]>();
  for (const point of prices) {
    const key = belgradeDayKey(point.ts);
    const group = groups.get(key) ?? [];
    group.push(point);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, points]) => points.sort((a, b) => a.ts.localeCompare(b.ts)));
}

export function dispatchBess(input: {
  assumptions: BessAssumptions;
  prices: HourlyPricePoint[];
  usableEnergyMWh?: number;
}): BessDispatchPoint[] {
  const assumptions = input.assumptions;
  const powerMW = Math.max(0, assumptions.powerMW);
  const usableEnergyMWh = Math.max(0, input.usableEnergyMWh ?? assumptions.energyMWh);
  const minSocMWh = usableEnergyMWh * (clamp(assumptions.minSocPct, 0, 100) / 100);
  const maxSocMWh = usableEnergyMWh * (clamp(assumptions.maxSocPct, 0, 100) / 100);
  if (!input.prices.length || powerMW <= 0 || maxSocMWh <= minSocMWh) return [];

  const availability = clamp(assumptions.availabilityPct, 0, 100) / 100;
  const chargePowerMW = Math.min(powerMW, Math.max(0, assumptions.gridImportMW)) * availability;
  const dischargePowerMW = Math.min(powerMW, Math.max(0, assumptions.gridExportMW)) * availability;
  const oneWayEfficiency = Math.sqrt(clamp(assumptions.roundTripEfficiencyPct, 0.01, 100) / 100);
  const durationHours = usableEnergyMWh / powerMW;
  const maxCyclesPerDay = clamp(assumptions.maxCyclesPerDay, 0, 10);
  let socMWh = minSocMWh;
  const dispatch: BessDispatchPoint[] = [];

  for (const day of groupByBelgradeDay(input.prices)) {
    const signals = dailySignalSets(
      day.map((point) => point.priceEurPerMWh),
      durationHours,
      maxCyclesPerDay,
      {
        roundTripEfficiencyPct: assumptions.roundTripEfficiencyPct,
        variableThroughputEurPerMWh: assumptions.variableThroughputEurPerMWh,
      },
    );
    let chargedInputMWh = 0;
    let dischargedOutputMWh = 0;
    const dailyInputLimitMWh = usableEnergyMWh * maxCyclesPerDay;
    const dailyOutputLimitMWh = usableEnergyMWh * maxCyclesPerDay;

    for (let hour = 0; hour < day.length; hour++) {
      const point = day[hour];
      let chargingMW = 0;
      let dischargingMW = 0;
      if (signals.charge.has(hour) && chargedInputMWh < dailyInputLimitMWh) {
        const socHeadroomInputMWh = (maxSocMWh - socMWh) / oneWayEfficiency;
        chargingMW = Math.max(
          0,
          Math.min(chargePowerMW, socHeadroomInputMWh, dailyInputLimitMWh - chargedInputMWh),
        );
        socMWh += chargingMW * oneWayEfficiency;
        chargedInputMWh += chargingMW;
      } else if (signals.discharge.has(hour) && dischargedOutputMWh < dailyOutputLimitMWh) {
        const availableOutputMWh = (socMWh - minSocMWh) * oneWayEfficiency;
        dischargingMW = Math.max(
          0,
          Math.min(dischargePowerMW, availableOutputMWh, dailyOutputLimitMWh - dischargedOutputMWh),
        );
        socMWh -= dischargingMW / oneWayEfficiency;
        dischargedOutputMWh += dischargingMW;
      }

      socMWh = clamp(socMWh, minSocMWh, maxSocMWh);
      const chargingCostEur = chargingMW * point.priceEurPerMWh;
      const dischargeRevenueEur = dischargingMW * point.priceEurPerMWh;
      dispatch.push({
        ts: point.ts,
        priceEurPerMWh: point.priceEurPerMWh,
        chargingMW,
        dischargingMW,
        socMWh,
        chargingCostEur,
        dischargeRevenueEur,
        netMarginEur: dischargeRevenueEur - chargingCostEur,
      });
    }
  }

  return dispatch.sort((a, b) => a.ts.localeCompare(b.ts));
}

function dispatchSummary(dispatch: BessDispatchPoint[], assumptions: BessAssumptions) {
  const annualChargedMWh = dispatch.reduce((sum, point) => sum + point.chargingMW, 0);
  const annualDischargedMWh = dispatch.reduce((sum, point) => sum + point.dischargingMW, 0);
  const chargingCostEur = dispatch.reduce((sum, point) => sum + point.chargingCostEur, 0);
  const dischargeRevenueEur = dispatch.reduce((sum, point) => sum + point.dischargeRevenueEur, 0);
  const variableCostsEur =
    annualDischargedMWh * Math.max(0, assumptions.variableThroughputEurPerMWh);
  return {
    annualChargedMWh,
    annualDischargedMWh,
    chargingCostEur,
    dischargeRevenueEur,
    grossArbitrageRevenueEur: dischargeRevenueEur - chargingCostEur,
    variableCostsEur,
  };
}

export function runBessEconomics(input: {
  assumptions: BessAssumptions;
  priceCurve: ExpectedPriceCurve;
}): BessResults {
  const assumptions = input.assumptions;
  const lifetimeYears = Math.max(1, Math.round(assumptions.lifetimeYears));
  const totalCapexEur =
    Math.max(0, assumptions.capexEurPerKW) * Math.max(0, assumptions.powerMW) * 1_000 +
    Math.max(0, assumptions.capexEurPerKWh) * Math.max(0, assumptions.energyMWh) * 1_000;
  const baseAverage = average(input.priceCurve.hourly.map((point) => point.priceEurPerMWh)) ?? 1;
  const annualRevenueEur: number[] = [];
  const annualOpexEur: number[] = [];
  const annualDischargedMWh: number[] = [];
  const annualChargingCostEur: number[] = [];
  const annualUsableCapacityMWh: number[] = [];
  let firstDispatch: BessDispatchPoint[] = [];
  let firstSummary: ReturnType<typeof dispatchSummary> | null = null;

  for (let yearIndex = 0; yearIndex < lifetimeYears; yearIndex++) {
    const degradation = Math.pow(
      1 - clamp(assumptions.annualCapacityDegradationPct, 0, 100) / 100,
      yearIndex,
    );
    const usableEnergyMWh = Math.max(0, assumptions.energyMWh) * degradation;
    annualUsableCapacityMWh.push(usableEnergyMWh);
    const targetAverage = input.priceCurve.yearly[yearIndex]?.averageEurPerMWh ?? baseAverage;
    const prices = input.priceCurve.hourly.map((point) => ({
      ...point,
      priceEurPerMWh: point.priceEurPerMWh * (targetAverage / (baseAverage || 1)),
    }));
    const dispatch = dispatchBess({ assumptions, prices, usableEnergyMWh });
    const summary = dispatchSummary(dispatch, assumptions);
    if (yearIndex === 0) {
      firstDispatch = dispatch;
      firstSummary = summary;
    }
    const tollingShare =
      assumptions.revenueStructure === "tolling"
        ? 1
        : assumptions.revenueStructure === "hybrid"
          ? clamp(assumptions.tollingSharePct, 0, 100) / 100
          : 0;
    const merchantShare = 1 - tollingShare;
    const tollingRevenue =
      Math.max(0, assumptions.tollingEurPerMWYear) *
      Math.max(0, assumptions.powerMW) *
      tollingShare;
    const ancillaryRevenue =
      Math.max(0, assumptions.ancillaryEurPerMWYear) * Math.max(0, assumptions.powerMW);
    annualRevenueEur.push(
      summary.grossArbitrageRevenueEur * merchantShare + tollingRevenue + ancillaryRevenue,
    );
    const augmentation =
      assumptions.augmentationYear > 0 && yearIndex + 1 === Math.round(assumptions.augmentationYear)
        ? totalCapexEur * (clamp(assumptions.augmentationCostPct, 0, 100) / 100)
        : 0;
    annualOpexEur.push(
      Math.max(0, assumptions.fixedOpexEurPerKWYear) * Math.max(0, assumptions.powerMW) * 1_000 +
        summary.variableCostsEur +
        augmentation,
    );
    annualChargingCostEur.push(summary.chargingCostEur);
    annualDischargedMWh.push(summary.annualDischargedMWh);
  }

  const financial = calculateFinancialResults({
    totalCapexEur,
    annualRevenueEur,
    annualOpexEur,
    annualGenerationMWh: annualDischargedMWh,
    financing: assumptions,
  });
  const summary = firstSummary ?? {
    annualChargedMWh: 0,
    annualDischargedMWh: 0,
    chargingCostEur: 0,
    dischargeRevenueEur: 0,
    grossArbitrageRevenueEur: 0,
    variableCostsEur: 0,
  };
  const tollingShare =
    assumptions.revenueStructure === "tolling"
      ? 1
      : assumptions.revenueStructure === "hybrid"
        ? clamp(assumptions.tollingSharePct, 0, 100) / 100
        : 0;
  const tollingRevenueEur =
    Math.max(0, assumptions.tollingEurPerMWYear) * Math.max(0, assumptions.powerMW) * tollingShare;
  const ancillaryRevenueEur =
    Math.max(0, assumptions.ancillaryEurPerMWYear) * Math.max(0, assumptions.powerMW);
  const averageChargingPriceEurPerMWh =
    summary.annualChargedMWh > 0 ? summary.chargingCostEur / summary.annualChargedMWh : null;
  const averageDischargingPriceEurPerMWh =
    summary.annualDischargedMWh > 0
      ? summary.dischargeRevenueEur / summary.annualDischargedMWh
      : null;

  const discountRate = clamp(assumptions.discountRatePct, 0, 100) / 100;
  let discountedLifetimeCosts = totalCapexEur;
  let discountedLifetimeDischarge = 0;
  for (let yearIndex = 0; yearIndex < lifetimeYears; yearIndex++) {
    const discountFactor = Math.pow(1 + discountRate, yearIndex + 1);
    discountedLifetimeCosts +=
      (annualOpexEur[yearIndex] + annualChargingCostEur[yearIndex]) / discountFactor;
    discountedLifetimeDischarge += annualDischargedMWh[yearIndex] / discountFactor;
  }

  return {
    ...financial,
    durationHours:
      assumptions.powerMW > 0 ? Math.max(0, assumptions.energyMWh) / assumptions.powerMW : 0,
    annualChargedMWh: summary.annualChargedMWh,
    annualDischargedMWh: summary.annualDischargedMWh,
    equivalentFullCycles:
      assumptions.energyMWh > 0 ? summary.annualDischargedMWh / assumptions.energyMWh : 0,
    averageChargingPriceEurPerMWh,
    averageDischargingPriceEurPerMWh,
    capturedSpreadEurPerMWh:
      averageChargingPriceEurPerMWh != null && averageDischargingPriceEurPerMWh != null
        ? averageDischargingPriceEurPerMWh - averageChargingPriceEurPerMWh
        : null,
    grossArbitrageRevenueEur: summary.grossArbitrageRevenueEur,
    tollingRevenueEur,
    ancillaryRevenueEur,
    variableCostsEur: summary.variableCostsEur,
    netOperatingRevenueEur:
      summary.grossArbitrageRevenueEur * (1 - tollingShare) +
      tollingRevenueEur +
      ancillaryRevenueEur -
      summary.variableCostsEur,
    lcosEurPerMWh:
      discountedLifetimeDischarge > 0 ? discountedLifetimeCosts / discountedLifetimeDischarge : null,
    annualUsableCapacityMWh,
    dispatch: firstDispatch,
  };
}
