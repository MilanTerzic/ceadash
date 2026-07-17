import type { FinancialResults, FinancingAssumptions } from "./types";

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

export const finiteOr = (value: number, fallback = 0) =>
  Number.isFinite(value) ? value : fallback;

export function npv(rate: number, cashflows: number[]) {
  const safeRate = Math.max(-0.99, finiteOr(rate));
  return cashflows.reduce(
    (total, cashflow, year) => total + finiteOr(cashflow) / Math.pow(1 + safeRate, year),
    0,
  );
}

export function irr(cashflows: number[]): number | null {
  if (cashflows.length < 2 || cashflows.every((value) => value >= 0)) return null;
  let low = -0.99;
  let high = 10;
  let highValue = npv(high, cashflows);
  const lowValue = npv(low, cashflows);
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || lowValue * highValue > 0)
    return null;
  for (let iteration = 0; iteration < 100; iteration++) {
    const middle = (low + high) / 2;
    const value = npv(middle, cashflows);
    if (Math.abs(value) < 0.01) return middle;
    if (value * highValue < 0) low = middle;
    else {
      high = middle;
      highValue = value;
    }
  }
  return (low + high) / 2;
}

function annualDebtService(principal: number, interestRatePct: number, years: number) {
  if (principal <= 0 || years <= 0) return 0;
  const rate = clamp(interestRatePct, 0, 100) / 100;
  if (rate === 0) return principal / years;
  return (principal * rate) / (1 - Math.pow(1 + rate, -years));
}

export function calculateFinancialResults(input: {
  totalCapexEur: number;
  annualRevenueEur: number[];
  annualOpexEur: number[];
  annualGenerationMWh?: number[];
  financing: FinancingAssumptions;
}): FinancialResults {
  const totalCapexEur = Math.max(0, finiteOr(input.totalCapexEur));
  const lifetimeYears = Math.max(input.annualRevenueEur.length, input.annualOpexEur.length, 1);
  const annualRevenueEur = Array.from({ length: lifetimeYears }, (_, index) =>
    Math.max(-1e15, finiteOr(input.annualRevenueEur[index])),
  );
  const annualOpexEur = Array.from({ length: lifetimeYears }, (_, index) =>
    Math.max(0, finiteOr(input.annualOpexEur[index])),
  );
  const annualEbitdaEur = annualRevenueEur.map((revenue, index) => revenue - annualOpexEur[index]);
  const projectCashflows = [-totalCapexEur, ...annualEbitdaEur];
  const discountRate = clamp(input.financing.discountRatePct, 0, 100) / 100;

  const debtShare = clamp(input.financing.debtSharePct, 0, 100) / 100;
  const debt = totalCapexEur * debtShare;
  const equity = totalCapexEur - debt;
  const tenor = Math.max(
    0,
    Math.min(lifetimeYears, Math.round(finiteOr(input.financing.loanTenorYears))),
  );
  const debtService = annualDebtService(debt, input.financing.interestRatePct, tenor);
  const equityCashflows = [
    -equity,
    ...annualEbitdaEur.map((ebitda, index) => ebitda - (index < tenor ? debtService : 0)),
  ];
  const dscrValues = annualEbitdaEur
    .slice(0, tenor)
    .filter(() => debtService > 0)
    .map((ebitda) => ebitda / debtService)
    .filter(Number.isFinite);

  let cumulative = -totalCapexEur;
  let paybackYears: number | null = null;
  for (let year = 0; year < annualEbitdaEur.length; year++) {
    const opening = cumulative;
    cumulative += annualEbitdaEur[year];
    if (cumulative >= 0 && annualEbitdaEur[year] > 0) {
      paybackYears = year + Math.abs(opening) / annualEbitdaEur[year];
      break;
    }
  }

  let discountedCosts = totalCapexEur;
  let discountedGeneration = 0;
  for (let year = 0; year < lifetimeYears; year++) {
    const factor = Math.pow(1 + discountRate, year + 1);
    discountedCosts += annualOpexEur[year] / factor;
    discountedGeneration += Math.max(0, input.annualGenerationMWh?.[year] ?? 0) / factor;
  }

  return {
    totalCapexEur,
    annualRevenueEur,
    annualOpexEur,
    annualEbitdaEur,
    cashflowsEur: equityCashflows,
    projectIrr: irr(projectCashflows),
    npvEur: npv(discountRate, projectCashflows),
    paybackYears,
    dscrMin: dscrValues.length ? Math.min(...dscrValues) : null,
    lcoeEurPerMWh: discountedGeneration > 0 ? discountedCosts / discountedGeneration : null,
  };
}
