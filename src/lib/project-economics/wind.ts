import { clamp } from "./finance";
import { runRenewableModel } from "./solar";
import type { ExpectedPriceCurve, WindAssumptions } from "./types";

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

export function scaleWindProfileToCapacityFactor(profile: number[], targetCapacityFactor: number) {
  const valid = profile.map((value) => clamp(value, 0, 1));
  const target = clamp(targetCapacityFactor, 0, 1);
  if (!valid.length || target === 0) return valid.map(() => 0);
  let low = 0;
  let high = 100;
  for (let iteration = 0; iteration < 80; iteration++) {
    const factor = (low + high) / 2;
    const scaledMean = average(valid.map((value) => Math.min(1, value * factor)));
    if (scaledMean < target) low = factor;
    else high = factor;
  }
  const factor = (low + high) / 2;
  return valid.map((value) => Math.min(1, value * factor));
}

export function runWindEconomics(input: {
  assumptions: WindAssumptions;
  indicativeProfile: number[];
  priceCurve: ExpectedPriceCurve;
}) {
  const assumptions = input.assumptions;
  const availability = clamp(assumptions.availabilityPct, 0, 100) / 100;
  const lossFactor = 1 - clamp(assumptions.wakeElectricalLossPct, 0, 100) / 100;
  const operatingFactor = availability * lossFactor;
  const grossTarget =
    operatingFactor > 0 ? clamp(assumptions.netCapacityFactorPct / 100 / operatingFactor, 0, 1) : 0;
  const grossProfile = scaleWindProfileToCapacityFactor(input.indicativeProfile, grossTarget);
  const netProfile = grossProfile.map((value) => value * operatingFactor);

  return runRenewableModel({
    capacityMW: assumptions.capacityMW,
    gridMW: assumptions.gridMW,
    capexEur: Math.max(0, assumptions.capexEurPerKW) * assumptions.capacityMW * 1_000,
    fixedOpexEurPerYear:
      Math.max(0, assumptions.fixedOpexEurPerKWYear) * assumptions.capacityMW * 1_000,
    variableOpexEurPerMWh: assumptions.variableOpexEurPerMWh,
    degradationPct: assumptions.degradationPct,
    lifetimeYears: assumptions.lifetimeYears,
    curtailmentPct: assumptions.curtailmentPct,
    negativePriceRule: assumptions.negativePriceRule,
    curtailThresholdEurPerMWh: assumptions.curtailThresholdEurPerMWh,
    ppaPriceEurPerMWh: assumptions.ppaPriceEurPerMWh,
    revenueStructure: assumptions.revenueStructure,
    merchantSharePct: assumptions.merchantSharePct,
    financing: assumptions,
    hourlyProfilePerMW: netProfile,
    priceCurve: input.priceCurve,
  });
}
