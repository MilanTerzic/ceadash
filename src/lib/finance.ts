// Pure financial engine — LCOE, IRR, NPV, DSCR, payback.
// All values in EUR. Cashflows are annual unless noted.

export type CalcInputs = {
  capacityMwp: number;
  gridMwac: number;
  capexEurKwp: number;
  fixedOpexEurKwYr: number;
  varOpexEurMwh: number;
  degradationPct: number;
  lifetimeYears: number;
  discountRatePct: number;
  debtSharePct: number;
  interestRatePct: number;
  loanTenorYears: number;
  ppaPriceEurMwh: number;
  ppaStructure: "fixed" | "pay_as_produced" | "baseload" | "merchant" | "hybrid";
  merchantSharePct: number;
  curtailmentPct: number;
  negativePriceRule: "always" | "curtail_negative" | "curtail_threshold";
  curtailThreshold: number;
  // hourly arrays length 8760 (or any): MWh per MW installed and EUR/MWh
  hourlyProfilePerMw: number[];
  hourlyPrice: number[];
};

export type CalcResults = {
  annualGenMwh: number;
  capacityFactor: number;
  merchantRevenue: number;
  ppaRevenue: number;
  blendedPrice: number;
  capturePrice: number;
  captureRate: number;
  lcoeEurMwh: number;
  ebitdaYear1: number;
  paybackYears: number | null;
  irr: number | null;
  npv: number;
  dscrMin: number;
  revenueExposedNegative: number;
  revenueLossCurtailment: number;
  breakEvenPpa: number;
  cashflows: number[]; // length = lifetimeYears + 1, year 0 = -capex
  monthlyGen: { month: number; mwh: number }[];
  monthlyRevenue: { month: number; eur: number }[];
};

export function npv(rate: number, cashflows: number[]): number {
  return cashflows.reduce((acc, cf, i) => acc + cf / Math.pow(1 + rate, i), 0);
}

export function irr(cashflows: number[]): number | null {
  // Bisection on [-0.99, 10]
  let lo = -0.99,
    hi = 10;
  const f = (r: number) => npv(r, cashflows);
  const fLo = f(lo);
  let fHi = f(hi);
  if (isNaN(fLo) || isNaN(fHi)) return null;
  if (fLo * fHi > 0) return null;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.abs(fm) < 1e-4) return mid;
    if (fm * fHi < 0) lo = mid;
    else {
      hi = mid;
      fHi = fm;
    }
  }
  return (lo + hi) / 2;
}

function annuity(p: number, ratePct: number, years: number): number {
  const r = ratePct / 100;
  if (r === 0) return p / years;
  return (p * r) / (1 - Math.pow(1 + r, -years));
}

export function runCalc(input: CalcInputs): CalcResults {
  const {
    capacityMwp,
    gridMwac,
    capexEurKwp,
    fixedOpexEurKwYr,
    varOpexEurMwh,
    degradationPct,
    lifetimeYears,
    discountRatePct,
    debtSharePct,
    interestRatePct,
    loanTenorYears,
    ppaPriceEurMwh,
    ppaStructure,
    merchantSharePct,
    curtailmentPct,
    negativePriceRule,
    curtailThreshold,
    hourlyProfilePerMw,
    hourlyPrice,
  } = input;

  const n = Math.min(hourlyProfilePerMw.length, hourlyPrice.length);
  const monthlyGen = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, mwh: 0 }));
  const monthlyRevenue = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, eur: 0 }));

  let gen = 0;
  let revGross = 0;
  let revCaptureNum = 0;
  let revExposedNeg = 0;
  let revCurtailedLoss = 0;

  const baseYear = new Date(Date.UTC(2026, 0, 1));
  for (let i = 0; i < n; i++) {
    const profile = hourlyProfilePerMw[i]; // MWh/MW
    let mw = capacityMwp;
    // Grid clipping (DC/AC oversizing)
    let mwh = profile * mw;
    if (mwh > gridMwac) mwh = gridMwac;
    // Curtailment (technical / grid)
    mwh *= 1 - curtailmentPct / 100;
    const price = hourlyPrice[i];
    let producing = true;
    if (negativePriceRule === "curtail_negative" && price < 0) producing = false;
    if (negativePriceRule === "curtail_threshold" && price < curtailThreshold) producing = false;
    if (!producing) {
      revCurtailedLoss += mwh * Math.max(0, price);
      continue;
    }
    gen += mwh;
    revGross += mwh * price;
    revCaptureNum += mwh * price;
    if (price < 0) revExposedNeg += mwh * price;
    const ts = new Date(baseYear.getTime() + i * 3600_000);
    const m = ts.getUTCMonth();
    monthlyGen[m].mwh += mwh;
    monthlyRevenue[m].eur += mwh * price;
  }

  const annualGenMwh = gen;
  const hoursInYear = 8760;
  const capacityFactor = annualGenMwh / (capacityMwp * hoursInYear);
  const capturePrice = gen > 0 ? revCaptureNum / gen : 0;
  const avgPrice = hourlyPrice.slice(0, n).reduce((a, b) => a + b, 0) / Math.max(1, n);
  const captureRate = avgPrice > 0 ? capturePrice / avgPrice : 0;

  // Revenue split
  let blendedPrice: number;
  let merchantRevenue: number;
  let ppaRevenue: number;
  if (ppaStructure === "merchant") {
    merchantRevenue = revGross;
    ppaRevenue = 0;
    blendedPrice = capturePrice;
  } else if (ppaStructure === "fixed" || ppaStructure === "pay_as_produced") {
    ppaRevenue = gen * ppaPriceEurMwh;
    merchantRevenue = 0;
    blendedPrice = ppaPriceEurMwh;
  } else if (ppaStructure === "baseload") {
    ppaRevenue = gen * ppaPriceEurMwh;
    merchantRevenue = 0;
    blendedPrice = ppaPriceEurMwh;
  } else {
    // hybrid
    const ms = merchantSharePct / 100;
    merchantRevenue = revGross * ms;
    ppaRevenue = gen * ppaPriceEurMwh * (1 - ms);
    blendedPrice = gen > 0 ? (merchantRevenue + ppaRevenue) / gen : 0;
  }

  // Costs
  const totalCapex = capexEurKwp * capacityMwp * 1000;
  const fixedOpexYr = fixedOpexEurKwYr * capacityMwp * 1000;
  const varOpexYr = varOpexEurMwh * gen;
  const opexYr = fixedOpexYr + varOpexYr;
  const ebitdaYear1 = merchantRevenue + ppaRevenue - opexYr;

  // Debt
  const debt = totalCapex * (debtSharePct / 100);
  const equity = totalCapex - debt;
  const debtServiceYr = annuity(debt, interestRatePct, loanTenorYears);

  // Cashflows (equity perspective, simplified): year 0 = -equity, then EBITDA - debt service while loan runs
  const r = discountRatePct / 100;
  const cashflows: number[] = [-equity];
  let dscrMin = Infinity;
  for (let y = 1; y <= lifetimeYears; y++) {
    const deg = Math.pow(1 - degradationPct / 100, y - 1);
    const rev = (merchantRevenue + ppaRevenue) * deg;
    const ebitda = rev - opexYr;
    const ds = y <= loanTenorYears ? debtServiceYr : 0;
    const cf = ebitda - ds;
    cashflows.push(cf);
    if (ds > 0) dscrMin = Math.min(dscrMin, ebitda / ds);
  }

  // LCOE: discounted lifetime costs / discounted lifetime generation
  let dCost = totalCapex;
  let dGen = 0;
  for (let y = 1; y <= lifetimeYears; y++) {
    const deg = Math.pow(1 - degradationPct / 100, y - 1);
    const gy = gen * deg;
    dCost += opexYr / Math.pow(1 + r, y);
    dGen += gy / Math.pow(1 + r, y);
  }
  const lcoeEurMwh = dGen > 0 ? dCost / dGen : 0;

  // NPV / IRR on full project (use total capex)
  const projectCF: number[] = [-totalCapex];
  for (let y = 1; y <= lifetimeYears; y++) {
    const deg = Math.pow(1 - degradationPct / 100, y - 1);
    projectCF.push((merchantRevenue + ppaRevenue) * deg - opexYr);
  }
  const npvProject = npv(r, projectCF);
  const irrProject = irr(projectCF);

  // Payback (undiscounted, project)
  let cum = -totalCapex;
  let payback: number | null = null;
  for (let y = 1; y <= lifetimeYears; y++) {
    const deg = Math.pow(1 - degradationPct / 100, y - 1);
    const cf = (merchantRevenue + ppaRevenue) * deg - opexYr;
    cum += cf;
    if (cum >= 0 && payback === null) {
      payback = y - (cum - cf < 0 ? (cum / cf) : 0);
      break;
    }
  }

  // Break-even PPA price: PPA that brings NPV=0 (assume full PPA, pay-as-produced)
  let lo = 0,
    hi = 500;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const cf = [-totalCapex];
    for (let y = 1; y <= lifetimeYears; y++) {
      const deg = Math.pow(1 - degradationPct / 100, y - 1);
      cf.push(gen * mid * deg - opexYr);
    }
    if (npv(r, cf) > 0) hi = mid;
    else lo = mid;
  }
  const breakEvenPpa = (lo + hi) / 2;

  return {
    annualGenMwh,
    capacityFactor,
    merchantRevenue,
    ppaRevenue,
    blendedPrice,
    capturePrice,
    captureRate,
    lcoeEurMwh,
    ebitdaYear1,
    paybackYears: payback,
    irr: irrProject,
    npv: npvProject,
    dscrMin: dscrMin === Infinity ? 0 : dscrMin,
    revenueExposedNegative: revExposedNeg,
    revenueLossCurtailment: revCurtailedLoss,
    breakEvenPpa,
    cashflows,
    monthlyGen,
    monthlyRevenue,
  };
}

// Sensitivity helper — produces a 2-D grid of a chosen output metric
export function sensitivityMatrix(
  base: CalcInputs,
  axisX: { key: keyof CalcInputs; values: number[] },
  axisY: { key: keyof CalcInputs; values: number[] },
  output: keyof CalcResults,
): { x: number; y: number; value: number }[] {
  const cells: { x: number; y: number; value: number }[] = [];
  for (const y of axisY.values) {
    for (const x of axisX.values) {
      const inputs = { ...base, [axisX.key]: x, [axisY.key]: y } as CalcInputs;
      const r = runCalc(inputs);
      cells.push({ x, y, value: (r[output] as number) ?? 0 });
    }
  }
  return cells;
}
