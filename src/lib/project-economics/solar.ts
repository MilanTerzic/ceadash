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

type HourlySettlement = { merchantRevenueEur: number; ppaRevenueEur: number };

function settleRevenue(
  hourlyGenerationMWh: number[],
  hourlyPrices: number[],
  structure: RenewableRevenueStructure,
  ppaPriceEurPerMWh: number,
  merchantSharePct: number,
) {
  const generationMWh = hourlyGenerationMWh.reduce((sum, value) => sum + value, 0);
  const merchantShare = clamp(merchantSharePct, 0, 100) / 100;
  const hourly: HourlySettlement[] = hourlyGenerationMWh.map(() => ({
    merchantRevenueEur: 0,
    ppaRevenueEur: 0,
  }));

  if (structure === "merchant") {
    for (let index = 0; index < hourlyGenerationMWh.length; index++) {
      hourly[index].merchantRevenueEur =
        hourlyGenerationMWh[index] * (hourlyPrices[index] ?? 0);
    }
  } else if (structure === "fixed" || structure === "pay_as_produced") {
    for (let index = 0; index < hourlyGenerationMWh.length; index++) {
      hourly[index].ppaRevenueEur = hourlyGenerationMWh[index] * ppaPriceEurPerMWh;
    }
  } else if (structure === "hybrid") {
    for (let index = 0; index < hourlyGenerationMWh.length; index++) {
      const generation = hourlyGenerationMWh[index];
      hourly[index].ppaRevenueEur = generation * (1 - merchantShare) * ppaPriceEurPerMWh;
      hourly[index].merchantRevenueEur = generation * merchantShare * (hourlyPrices[index] ?? 0);
    }
  } else {
    // Baseload PPA is settled against one constant contracted MWh/h block for
    // the whole first-year sample. Keeping this at hourly level lets monthly
    // reporting aggregate the exact same settlement used by the annual KPI.
    const contractedShare = 1 - merchantShare;
    const baseloadMWh = hourlyGenerationMWh.length
      ? (generationMWh * contractedShare) / hourlyGenerationMWh.length
      : 0;
    for (let index = 0; index < hourlyGenerationMWh.length; index++) {
      hourly[index].ppaRevenueEur = baseloadMWh * ppaPriceEurPerMWh;
      hourly[index].merchantRevenueEur =
        (hourlyGenerationMWh[index] - baseloadMWh) * (hourlyPrices[index] ?? 0);
    }
  }

  const merchantRevenueEur = hourly.reduce((sum, row) => sum + row.merchantRevenueEur, 0);
  const ppaRevenueEur = hourly.reduce((sum, row) => sum + row.ppaRevenueEur, 0);
  return { merchantRevenueEur, ppaRevenueEur, hourly };
}

const BELGRADE_MONTH = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Belgrade",
  month: "2-digit",
});

function belgradeMonthIndex(ts: string | undefined): number {
  if (!ts) return 0;
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return 0;
  const month = Number(BELGRADE_MONTH.format(date));
  return Number.isFinite(month) && month >= 1 && month <= 12 ? month - 1 : 0;
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
  for (let index = 0; index < hourlyGenerationMWh.length; index++) {
    const month = belgradeMonthIndex(input.priceCurve.hourly[index]?.ts);
    monthlyGenerationMWh[month].value += hourlyGenerationMWh[index];
    const settled = yearOneSettlement.hourly[index];
    monthlyRevenueEur[month].value +=
      (settled?.merchantRevenueEur ?? 0) + (settled?.ppaRevenueEur ?? 0);
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
