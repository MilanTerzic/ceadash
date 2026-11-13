// Battery dispatch optimisation and valuation. Pure and unit-tested.
//
// Method
// - Each market-time delivery day is optimised on its own against that day's hourly
//   day-ahead prices, with perfect foresight of those prices. This is an upper bound on
//   day-ahead arbitrage: a real bidder does not know the clearing prices in advance.
// - The optimiser is an exact dynamic programme over a discretised state of charge.
//   A move between two SoC levels is either a charge or a discharge, so simultaneous
//   charging and discharging cannot occur, and power and SoC limits hold by construction.
// - A daily cycle limit is enforced by pricing discharged energy (Lagrangian) and
//   raising that price until the limit holds; the result can sit slightly below the cap.
import { marketTime, type Series } from "./analytics";

export interface BessParams {
  /** Rated charge and discharge power at the grid connection, MW. */
  powerMW: number;
  /** Nameplate energy capacity, MWh. */
  energyMWh: number;
  /** AC round-trip efficiency, in (0, 1]. Split evenly between charge and discharge. */
  roundTripEfficiency: number;
  /** Lowest and highest allowed state of charge as a share of nameplate energy. */
  socMin: number;
  socMax: number;
  /** Full equivalent cycles allowed per day (discharged energy / usable energy). */
  maxCyclesPerDay: number;
  /** Variable cost per MWh discharged to the grid (degradation, wear), EUR/MWh. */
  variableCost: number;
  /** Share of power held back for other services and so unavailable for arbitrage. */
  reservedShare: number;
}

export interface DispatchStep {
  t: number;
  price: number;
  /** Power drawn from the grid, MW (>= 0). */
  chargeMW: number;
  /** Power delivered to the grid, MW (>= 0). */
  dischargeMW: number;
  /** State of charge at the end of the hour, MWh. */
  socMWh: number;
  /** Energy sold minus energy bought at the hour's price, EUR. */
  cashflow: number;
}

export interface DispatchSummary {
  hours: number;
  days: number;
  chargedMWh: number;
  dischargedMWh: number;
  /** Sum of energy sold x price, EUR. */
  revenue: number;
  /** Sum of energy bought x price, EUR. */
  chargingCost: number;
  grossMargin: number;
  variableCosts: number;
  netMargin: number;
  /** Full equivalent cycles over the period. */
  cycles: number;
  cyclesPerDay: number | null;
  avgBuyPrice: number | null;
  avgSellPrice: number | null;
}

export interface DispatchResult {
  steps: DispatchStep[];
  summary: DispatchSummary;
  /** Per delivery day net margin, EUR. */
  daily: Array<{ day: string; netMargin: number; cycles: number; hours: number }>;
}

interface DayPlan {
  levels: number[];
  /** SoC-side energy discharged, MWh. */
  dischargedSoc: number;
}

export function usableEnergy(params: BessParams): number {
  return Math.max(0, params.energyMWh * (params.socMax - params.socMin));
}

/** Optimal SoC path for one day by backward induction. `lambda` prices SoC-side discharge. */
function planDay(
  prices: number[],
  params: BessParams,
  levelsCount: number,
  lambda: number,
): DayPlan {
  const usable = usableEnergy(params);
  const eta = Math.sqrt(params.roundTripEfficiency);
  const power = params.powerMW * (1 - params.reservedShare);
  const delta = usable / (levelsCount - 1);
  // Largest SoC change in one hour, in levels: charging adds P*eta, discharging removes P/eta.
  const maxUp = Math.floor((power * eta) / delta + 1e-9);
  const maxDown = Math.floor(power / eta / delta + 1e-9);
  const T = prices.length;

  let value = new Float64Array(levelsCount); // value-to-go after the last hour: 0
  const choice: Int16Array[] = [];
  for (let h = T - 1; h >= 0; h--) {
    const price = prices[h];
    const next = new Float64Array(levelsCount);
    const pick = new Int16Array(levelsCount);
    for (let i = 0; i < levelsCount; i++) {
      let best = value[i];
      let bestJ = i;
      const top = Math.min(levelsCount - 1, i + maxUp);
      for (let j = i + 1; j <= top; j++) {
        // Buy (j - i) * delta / eta from the grid.
        const v = value[j] - (price * (j - i) * delta) / eta;
        if (v > best + 1e-12) {
          best = v;
          bestJ = j;
        }
      }
      const bottom = Math.max(0, i - maxDown);
      for (let j = i - 1; j >= bottom; j--) {
        const soc = (i - j) * delta;
        // Sell soc * eta to the grid; wear and the cycle price apply to this energy.
        const v = value[j] + (price - params.variableCost) * soc * eta - lambda * soc;
        if (v > best + 1e-12) {
          best = v;
          bestJ = j;
        }
      }
      next[i] = best;
      pick[i] = bestJ;
    }
    value = next;
    choice[h] = pick;
  }

  const levels: number[] = [];
  let level = 0; // each day starts at the minimum SoC
  let dischargedSoc = 0;
  for (let h = 0; h < T; h++) {
    const nextLevel = choice[h][level];
    if (nextLevel < level) dischargedSoc += (level - nextLevel) * delta;
    level = nextLevel;
    levels.push(level);
  }
  return { levels, dischargedSoc };
}

function planDayWithCycleCap(prices: number[], params: BessParams, levelsCount: number): DayPlan {
  const cap = usableEnergy(params) * params.maxCyclesPerDay;
  const free = planDay(prices, params, levelsCount, 0);
  if (free.dischargedSoc <= cap + 1e-9) return free;
  let lo = 0;
  let hi = Math.max(1, ...prices.map((price) => Math.abs(price))) * 2;
  let best = planDay(prices, params, levelsCount, hi);
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const plan = planDay(prices, params, levelsCount, mid);
    if (plan.dischargedSoc <= cap + 1e-9) {
      best = plan;
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return best;
}

export function validParams(params: BessParams): string | null {
  if (!(params.powerMW > 0)) return "power_must_be_positive";
  if (!(params.energyMWh > 0)) return "energy_must_be_positive";
  if (!(params.roundTripEfficiency > 0 && params.roundTripEfficiency <= 1))
    return "efficiency_out_of_range";
  if (!(params.socMin >= 0 && params.socMax <= 1 && params.socMax > params.socMin))
    return "soc_window_invalid";
  if (!(params.maxCyclesPerDay > 0)) return "cycles_must_be_positive";
  if (!(params.variableCost >= 0)) return "variable_cost_negative";
  if (!(params.reservedShare >= 0 && params.reservedShare < 1))
    return "reserved_share_out_of_range";
  return null;
}

/** Optimises dispatch day by day over an hourly price series. */
export function optimiseDispatch(
  prices: Series,
  params: BessParams,
  levelsCount = 121,
): DispatchResult {
  const empty: DispatchResult = {
    steps: [],
    daily: [],
    summary: {
      hours: 0,
      days: 0,
      chargedMWh: 0,
      dischargedMWh: 0,
      revenue: 0,
      chargingCost: 0,
      grossMargin: 0,
      variableCosts: 0,
      netMargin: 0,
      cycles: 0,
      cyclesPerDay: null,
      avgBuyPrice: null,
      avgSellPrice: null,
    },
  };
  if (validParams(params) !== null || prices.t.length === 0) return empty;

  const usable = usableEnergy(params);
  const eta = Math.sqrt(params.roundTripEfficiency);
  const delta = usable / (levelsCount - 1);
  const floor = params.energyMWh * params.socMin;

  // Group consecutive hours into delivery days. A gap in the series ends a block, so the
  // optimiser never carries energy across hours that were not observed.
  const blocks: Array<{ day: string; idx: number[] }> = [];
  for (let i = 0; i < prices.t.length; i++) {
    const day = marketTime(prices.t[i]).day;
    const last = blocks[blocks.length - 1];
    if (last && last.day === day && prices.t[i] === prices.t[last.idx[last.idx.length - 1]] + 1) {
      last.idx.push(i);
    } else {
      blocks.push({ day, idx: [i] });
    }
  }

  const steps: DispatchStep[] = [];
  const dailyMap = new Map<string, { netMargin: number; dischargedSoc: number; hours: number }>();
  for (const block of blocks) {
    const dayPrices = block.idx.map((i) => prices.v[i]);
    const plan = planDayWithCycleCap(dayPrices, params, levelsCount);
    let level = 0;
    let net = 0;
    for (let h = 0; h < block.idx.length; h++) {
      const nextLevel = plan.levels[h];
      const price = dayPrices[h];
      const moved = (nextLevel - level) * delta;
      const chargeMW = moved > 0 ? moved / eta : 0;
      const dischargeMW = moved < 0 ? -moved * eta : 0;
      const cashflow = (dischargeMW - chargeMW) * price;
      net += cashflow - dischargeMW * params.variableCost;
      steps.push({
        t: prices.t[block.idx[h]],
        price,
        chargeMW,
        dischargeMW,
        socMWh: floor + nextLevel * delta,
        cashflow,
      });
      level = nextLevel;
    }
    const entry = dailyMap.get(block.day) ?? { netMargin: 0, dischargedSoc: 0, hours: 0 };
    entry.netMargin += net;
    entry.dischargedSoc += plan.dischargedSoc;
    entry.hours += block.idx.length;
    dailyMap.set(block.day, entry);
  }

  let charged = 0;
  let discharged = 0;
  let revenue = 0;
  let cost = 0;
  for (const step of steps) {
    charged += step.chargeMW;
    discharged += step.dischargeMW;
    revenue += step.dischargeMW * step.price;
    cost += step.chargeMW * step.price;
  }
  const variableCosts = discharged * params.variableCost;
  const cycles = usable > 0 ? discharged / eta / usable : 0;
  const daily = [...dailyMap.entries()].map(([day, entry]) => ({
    day,
    netMargin: entry.netMargin,
    cycles: usable > 0 ? entry.dischargedSoc / usable : 0,
    hours: entry.hours,
  }));
  return {
    steps,
    daily,
    summary: {
      hours: steps.length,
      days: daily.length,
      chargedMWh: charged,
      dischargedMWh: discharged,
      revenue,
      chargingCost: cost,
      grossMargin: revenue - cost,
      variableCosts,
      netMargin: revenue - cost - variableCosts,
      cycles,
      cyclesPerDay: daily.length ? cycles / daily.length : null,
      avgBuyPrice: charged > 0 ? cost / charged : null,
      avgSellPrice: discharged > 0 ? revenue / discharged : null,
    },
  };
}

/** Physical feasibility check of a dispatch. Returns the list of violations (empty = feasible). */
export function checkDispatch(result: DispatchResult, params: BessParams): string[] {
  const issues: string[] = [];
  const eta = Math.sqrt(params.roundTripEfficiency);
  const power = params.powerMW * (1 - params.reservedShare) + 1e-6;
  const lo = params.energyMWh * params.socMin - 1e-6;
  const hi = params.energyMWh * params.socMax + 1e-6;
  let prev: DispatchStep | null = null;
  const dayStartSoc = params.energyMWh * params.socMin;
  for (const step of result.steps) {
    if (step.chargeMW > 0 && step.dischargeMW > 0) issues.push(`simultaneous@${step.t}`);
    if (step.chargeMW > power || step.dischargeMW > power) issues.push(`power@${step.t}`);
    if (step.socMWh < lo || step.socMWh > hi) issues.push(`soc@${step.t}`);
    const newBlock =
      !prev || marketTime(prev.t).day !== marketTime(step.t).day || step.t !== prev.t + 1;
    const before = newBlock ? dayStartSoc : prev!.socMWh;
    const expected = before + step.chargeMW * eta - step.dischargeMW / eta;
    if (Math.abs(expected - step.socMWh) > 1e-6) issues.push(`balance@${step.t}`);
    prev = step;
  }
  const usable = usableEnergy(params);
  for (const day of result.daily) {
    if (day.cycles > params.maxCyclesPerDay + 1e-6) issues.push(`cycles@${day.day}`);
  }
  if (usable <= 0) issues.push("no_usable_energy");
  return issues;
}

// --- Investment case ---------------------------------------------------------

export interface BessInvestment {
  /** EUR per kWh of nameplate energy. */
  capexPerKWh: number;
  /** EUR per kW of rated power. */
  capexPerKW: number;
  /** Fixed operating cost, EUR per MW of rated power per year. */
  fixedOpexPerMWYear: number;
  /** Technical availability, in (0, 1]. */
  availability: number;
  /** Loss of usable energy per year of operation, share of the initial capacity. */
  degradationPerYear: number;
  lifetimeYears: number;
  /** Real discount rate, e.g. 0.08. */
  discountRate: number;
  /**
   * Income for the reserved power share from other services, EUR per MW reserved per year.
   * The reserved share is excluded from arbitrage, so the two are never counted twice.
   */
  reservedRevenuePerMWYear: number;
}

export interface BessValuation {
  capex: number;
  /** Year-1 arbitrage net margin, annualised from the observed period, EUR. */
  arbitrageYear1: number;
  reservedYear1: number;
  fixedOpex: number;
  /** Net cash flow per year of operation, EUR. */
  cashflows: number[];
  npv: number;
  irr: number | null;
  paybackYears: number | null;
  /** Net margin per MW of rated power per year, EUR. */
  marginPerMWYear: number;
}

function npv(rate: number, flows: number[]): number {
  return flows.reduce((sum, flow, year) => sum + flow / (1 + rate) ** year, 0);
}

/** Internal rate of return by bisection; null when the flows never change sign. */
export function irr(flows: number[]): number | null {
  if (!flows.some((flow) => flow > 0) || !flows.some((flow) => flow < 0)) return null;
  let lo = -0.99;
  let hi = 5;
  if (npv(lo, flows) * npv(hi, flows) > 0) return null;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (npv(lo, flows) * npv(mid, flows) <= 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Scales the period's optimised margin to a year and projects it over the asset life.
 * Arbitrage income falls linearly with capacity fade; nothing is escalated for inflation
 * or changes in price shape, so this is a constant-conditions illustration.
 */
export function valueBess(
  summary: DispatchSummary,
  params: BessParams,
  investment: BessInvestment,
): BessValuation {
  const capex =
    investment.capexPerKWh * params.energyMWh * 1000 +
    investment.capexPerKW * params.powerMW * 1000;
  const perDay = summary.days > 0 ? summary.netMargin / summary.days : 0;
  const arbitrageYear1 = perDay * 365 * investment.availability;
  const reservedYear1 =
    investment.reservedRevenuePerMWYear *
    params.powerMW *
    params.reservedShare *
    investment.availability;
  const fixedOpex = investment.fixedOpexPerMWYear * params.powerMW;
  const years = Math.max(1, Math.round(investment.lifetimeYears));
  const cashflows: number[] = [];
  for (let year = 0; year < years; year++) {
    const fade = Math.max(0, 1 - investment.degradationPerYear * year);
    cashflows.push(arbitrageYear1 * fade + reservedYear1 - fixedOpex);
  }
  const flows = [-capex, ...cashflows];
  let cumulative = -capex;
  let payback: number | null = null;
  for (let year = 0; year < cashflows.length; year++) {
    const before = cumulative;
    cumulative += cashflows[year];
    if (payback === null && cumulative >= 0 && cashflows[year] > 0) {
      payback = year + -before / cashflows[year];
    }
  }
  return {
    capex,
    arbitrageYear1,
    reservedYear1,
    fixedOpex,
    cashflows,
    npv: npv(investment.discountRate, flows),
    irr: irr(flows),
    paybackYears: payback,
    marginPerMWYear: params.powerMW > 0 ? (arbitrageYear1 + reservedYear1) / params.powerMW : 0,
  };
}
