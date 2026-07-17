import { calculateFinancialResults, clamp, npv } from "./finance";
import type {
  ExpectedPriceCurve,
  FinancingAssumptions,
  NegativePriceRule,
  RenewableResults,
  RenewableRevenueStructure,
  SolarAssumptions,
} from "./types";

type RenewableModelInput = {
  capacityMW: number;
  gridMW: number;
  capexEur: number;
  fixedOpexEurPerYear: number;
  variableOpexEurPerMWh: number;
  degradationPct: number;
  lifetimeYears: number;
  curtailmentPct: number;
  negativePriceRule: NegativePriceRule;
  curtailThresholdEurPerMWh: number;
  ppaPriceEurPerMWh: number;
  revenueStructure: RenewableRevenueStructure;
  merchantSharePct: number;
  financing: FinancingAssumptions;
  hourlyProfilePerMW: number[];
  priceCurve: ExpectedPriceCurve;
};

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function settleRevenue(
  hourlyGenerationMWh: number[],
  hourlyPrices: number[],
  structure: RenewableRevenueStructure,
  ppaPriceEurPerMWh: number,
  merchantSharePct: number,
) {
  const generationMWh = hourlyGenerationMWh.reduce((sum, value) => sum + value, 0);
  const merchantShare = clamp(merchantSharePct, 0, 100) / 100;
  let merchantRevenueEur = 0;
  let ppaRevenueEur = 0;

  if (structure === "merchant") {
    merchantRevenueEur = hourlyGenerationMWh.reduce(
      (sum, generation, index) => sum + generation * (hourlyPrices[index] ?? 0),
      0,
    );
  } else if (structure === "fixed" || structure === "pay_as_produced") {
    ppaRevenueEur = generationMWh * ppaPriceEurPerMWh;
  } else if (structure === "hybrid") {
    for (let index = 0; index < hourlyGenerationMWh.length; index++) {
      const generation = hourlyGenerationMWh[index];
      ppaRevenueEur += generation * (1 - merchantShare) * ppaPriceEurPerMWh;
      merchantRevenueEur += generation * merchantShare * (hourlyPrices[index] ?? 0);
    }
  } else {
    const contractedShare = 1 - merchantShare;
    const baseloadMWh = (generationMWh * contractedShare) / hourlyGenerationMWh.length;
    for (let index = 0; index < hourlyGenerationMWh.length; index++) {
      ppaRevenueEur += baseloadMWh * ppaPriceEurPerMWh;
      merchantRevenueEur += (hourlyGenerationMWh[index] - baseloadMWh) * (hourlyPrices[index] ?? 0);
    }
  }

  return { merchantRevenueEur, ppaRevenueEur };
}

export function runRenewableModel(input: RenewableModelInput): RenewableResults {
  const capacityMW = Math.max(0, input.capacityMW);
  const gridMW = Math.max(0, input.gridMW);
  const n = Math.min(input.hourlyProfilePerMW.length, input.priceCurve.hourly.length);
  const curtailmentFactor = 1 - clamp(input.curtailmentPct, 0, 100) / 100;
  const hourlyGenerationMWh: number[] = [];
  let curtailedGenerationMWh = 0;
  let negativePriceGenerationMWh = 0;

  for (let index = 0; index < n; index++) {
    const unconstrained = Math.max(0, input.hourlyProfilePerMW[index] ?? 0) * capacityMW;
    const clipped = Math.min(unconstrained, gridMW);
    curtailedGenerationMWh += Math.max(0, unconstrained - clipped);
    const technicallyAvailable = clipped * curtailmentFactor;
    curtailedGenerationMWh += clipped - technicallyAvailable;
    const price = input.priceCurve.hourly[index]?.priceEurPerMWh ?? 0;
    const priceCurtailment =
      (input.negativePriceRule === "curtail_negative" && price < 0) ||
      (input.negativePriceRule === "curtail_threshold" && price < input.curtailThresholdEurPerMWh);
    if (priceCurtailment) {
      curtailedGenerationMWh += technicallyAvailable;
      hourlyGenerationMWh.push(0);
    } else {
      hourlyGenerationMWh.push(technicallyAvailable);
      if (price < 0) negativePriceGenerationMWh += technicallyAvailable;
    }
  }

  const annualGenerationMWh = hourlyGenerationMWh.reduce((sum, value) => sum + value, 0);
  const firstYearPrices = input.priceCurve.hourly.slice(0, n).map((point) => point.priceEurPerMWh);
  const captureNumerator = hourlyGenerationMWh.reduce(
    (sum, generation, index) => sum + generation * firstYearPrices[index],
    0,
  );
  const capturePriceEurPerMWh =
    annualGenerationMWh > 0 ? captureNumerator / annualGenerationMWh : null;
  const marketAverage = average(firstYearPrices);
  const captureRate =
    capturePriceEurPerMWh != null && marketAverage !== 0
      ? capturePriceEurPerMWh / marketAverage
      : null;
  const yearOneSettlement = settleRevenue(
    hourlyGenerationMWh,
    firstYearPrices,
    input.revenueStructure,
    input.ppaPriceEurPerMWh,
    input.merchantSharePct,
  );

  const annualGeneration: number[] = [];
  const annualRevenue: number[] = [];
  const annualOpex: number[] = [];
  const priceBase = marketAverage || 1;
  for (let yearIndex = 0; yearIndex < Math.max(1, Math.round(input.lifetimeYears)); yearIndex++) {
    const degradation = Math.pow(1 - clamp(input.degradationPct, 0, 100) / 100, yearIndex);
    const generation = hourlyGenerationMWh.map((value) => value * degradation);
    const targetPrice =
      input.priceCurve.yearly[yearIndex]?.averageEurPerMWh ??
      input.priceCurve.yearly.at(-1)?.averageEurPerMWh ??
      marketAverage;
    const prices = firstYearPrices.map((price) => price * (targetPrice / priceBase));
    const settlement = settleRevenue(
      generation,
      prices,
      input.revenueStructure,
      input.ppaPriceEurPerMWh,
      input.merchantSharePct,
    );
    const generationTotal = generation.reduce((sum, value) => sum + value, 0);
    annualGeneration.push(generationTotal);
    annualRevenue.push(settlement.merchantRevenueEur + settlement.ppaRevenueEur);
    annualOpex.push(
      Math.max(0, input.fixedOpexEurPerYear) +
        Math.max(0, input.variableOpexEurPerMWh) * generationTotal,
    );
  }

  const financial = calculateFinancialResults({
    totalCapexEur: input.capexEur,
    annualRevenueEur: annualRevenue,
    annualOpexEur: annualOpex,
    annualGenerationMWh: annualGeneration,
    financing: input.financing,
  });

  const monthlyGenerationMWh = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    value: 0,
  }));
  const monthlyRevenueEur = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    value: 0,
  }));
  const year = Number(input.priceCurve.hourly[0]?.ts.slice(0, 4)) || 2026;
  for (let index = 0; index < hourlyGenerationMWh.length; index++) {
    const month =
      new Date(input.priceCurve.hourly[index]?.ts ?? Date.UTC(year, 0, 1)).getUTCMonth() || 0;
    const generation = hourlyGenerationMWh[index];
    monthlyGenerationMWh[month].value += generation;
    const merchantShare =
      input.revenueStructure === "merchant"
        ? 1
        : input.revenueStructure === "hybrid"
          ? clamp(input.merchantSharePct, 0, 100) / 100
          : 0;
    monthlyRevenueEur[month].value +=
      generation *
      (merchantShare * firstYearPrices[index] + (1 - merchantShare) * input.ppaPriceEurPerMWh);
  }

  let low = 0;
  let high = 500;
  const discountRate = clamp(input.financing.discountRatePct, 0, 100) / 100;
  for (let iteration = 0; iteration < 50; iteration++) {
    const price = (low + high) / 2;
    const cashflows = [
      -Math.max(0, input.capexEur),
      ...annualGeneration.map((generation, index) => generation * price - annualOpex[index]),
    ];
    if (npv(discountRate, cashflows) >= 0) high = price;
    else low = price;
  }

  return {
    ...financial,
    annualGenerationMWh,
    capacityFactor: capacityMW > 0 && n > 0 ? annualGenerationMWh / (capacityMW * n) : 0,
    capturePriceEurPerMWh,
    captureRate,
    merchantRevenueEur: yearOneSettlement.merchantRevenueEur,
    ppaRevenueEur: yearOneSettlement.ppaRevenueEur,
    blendedPriceEurPerMWh:
      annualGenerationMWh > 0
        ? (yearOneSettlement.merchantRevenueEur + yearOneSettlement.ppaRevenueEur) /
          annualGenerationMWh
        : null,
    curtailedGenerationMWh,
    negativePriceGenerationMWh,
    breakEvenPpaEurPerMWh: annualGenerationMWh > 0 ? (low + high) / 2 : null,
    monthlyGenerationMWh,
    monthlyRevenueEur,
    hourlyGenerationMWh,
  };
}

export function runSolarEconomics(input: {
  assumptions: SolarAssumptions;
  hourlyProfilePerMW: number[];
  priceCurve: ExpectedPriceCurve;
}) {
  const assumptions = input.assumptions;
  return runRenewableModel({
    capacityMW: assumptions.capacityMWp,
    gridMW: assumptions.gridMWac,
    capexEur: Math.max(0, assumptions.capexEurPerKWp) * assumptions.capacityMWp * 1_000,
    fixedOpexEurPerYear:
      Math.max(0, assumptions.fixedOpexEurPerKWYear) * assumptions.capacityMWp * 1_000,
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
    hourlyProfilePerMW: input.hourlyProfilePerMW,
    priceCurve: input.priceCurve,
  });
}
