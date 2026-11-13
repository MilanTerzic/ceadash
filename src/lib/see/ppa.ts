// PPA settlement and valuation. Pure and unit-tested.
//
// Everything is computed on hours where both a price and a generation value exist.
// Forward years reuse the observed hourly price shape, rescaled to a forward baseload
// assumption the user enters; they are model outputs, never observed forward prices.
import { marketTime, mean, type IntervalValue, type Series } from "./analytics";

export type VolumeBasis =
  /** Buyer takes whatever the plant produces. */
  | "produced"
  /** Seller delivers a flat volume and trades the difference to its output at spot. */
  | "baseload"
  /** As produced, but volumes are nominated day-ahead and deviations cost money. */
  | "nominated";

export type Pricing =
  /** One strike price for every contracted MWh. */
  | "fixed"
  /** Hourly spot less a discount and fee, optionally with a floor and a cap. */
  | "indexed";

export interface PpaContract {
  volumeBasis: VolumeBasis;
  pricing: Pricing;
  /** Fixed strike, EUR/MWh. */
  strike: number;
  /** Flat contracted volume for the baseload basis, MW. */
  baseloadMW: number;
  /** Indexed pricing: share taken off spot, in [0, 1). */
  indexDiscount: number;
  /** Indexed pricing: fixed fee taken off spot, EUR/MWh. */
  indexFee: number;
  indexFloor: number | null;
  indexCap: number | null;
  /** No delivery and no payment in hours with a negative spot price. */
  skipNegativeHours: boolean;
  /** Balancing cost per MWh produced, EUR/MWh (produced and nominated bases). */
  balancingCost: number;
  /** Who carries the balancing cost under the contract. */
  balancingBy: "seller" | "buyer";
  /** Nominated basis: mean absolute deviation from nomination as a share of output. */
  nominationError: number;
  /** Nominated basis: cost of each MWh of deviation, EUR/MWh. */
  imbalanceCost: number;
}

export interface Matched {
  t: number[];
  price: number[];
  gen: number[];
}

/** Hours present in both series, in order. */
export function matchHours(prices: Series, generation: Series): Matched {
  const gen = new Map<number, number>();
  for (let i = 0; i < generation.t.length; i++) gen.set(generation.t[i], generation.v[i]);
  const out: Matched = { t: [], price: [], gen: [] };
  for (let i = 0; i < prices.t.length; i++) {
    const g = gen.get(prices.t[i]);
    if (g === undefined || !Number.isFinite(g) || g < 0) continue;
    out.t.push(prices.t[i]);
    out.price.push(prices.v[i]);
    out.gen.push(g);
  }
  return out;
}

export interface CaptureStats {
  hours: number;
  volumeMWh: number;
  baseload: number | null;
  /** Generation-weighted price, EUR/MWh. */
  capturePrice: number | null;
  /** capturePrice / baseload. */
  captureRate: number | null;
  /** baseload - capturePrice: what the profile costs against a flat delivery. */
  profileCost: number | null;
  negativeHours: number;
  /** Share of output produced in negative-price hours, in [0, 1]. */
  negativeVolumeShare: number | null;
  capacityFactor: number | null;
}

export function captureStats(m: Matched, capacityMW?: number): CaptureStats {
  const hours = m.t.length;
  let volume = 0;
  let revenue = 0;
  let negHours = 0;
  let negVolume = 0;
  for (let i = 0; i < hours; i++) {
    volume += m.gen[i];
    revenue += m.gen[i] * m.price[i];
    if (m.price[i] < 0) {
      negHours += 1;
      negVolume += m.gen[i];
    }
  }
  const baseload = mean(m.price);
  const capture = volume > 0 ? revenue / volume : null;
  return {
    hours,
    volumeMWh: volume,
    baseload,
    capturePrice: capture,
    captureRate:
      capture !== null && baseload !== null && baseload !== 0 ? capture / baseload : null,
    profileCost: capture !== null && baseload !== null ? baseload - capture : null,
    negativeHours: negHours,
    negativeVolumeShare: volume > 0 ? negVolume / volume : null,
    capacityFactor:
      capacityMW && capacityMW > 0 && hours > 0 ? volume / (capacityMW * hours) : null,
  };
}

/** Capture statistics per market-time month. */
export function monthlyCapture(m: Matched): Array<{ month: string } & CaptureStats> {
  const groups = new Map<string, Matched>();
  for (let i = 0; i < m.t.length; i++) {
    const month = marketTime(m.t[i]).day.slice(0, 7);
    const group = groups.get(month) ?? { t: [], price: [], gen: [] };
    group.t.push(m.t[i]);
    group.price.push(m.price[i]);
    group.gen.push(m.gen[i]);
    groups.set(month, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, group]) => ({ month, ...captureStats(group) }));
}

/**
 * Hourly price curve for a forward year: the observed shape, optionally depressed in the
 * plant's high-output hours (`shapeStress`, a cannibalisation stress), then rescaled so
 * its simple mean equals `targetBaseload`.
 *
 * stressed_h = price_h x (1 - shapeStress x gen_h / max(gen))
 */
export function forwardCurve(m: Matched, targetBaseload: number, shapeStress = 0): number[] {
  const maxGen = Math.max(0, ...m.gen);
  const stressed = m.price.map((price, i) => {
    if (!(shapeStress > 0) || maxGen <= 0) return price;
    // A positive price falls towards zero; a negative price is left as it is.
    return price > 0 ? price * (1 - Math.min(1, shapeStress) * (m.gen[i] / maxGen)) : price;
  });
  const base = mean(stressed);
  if (base === null || base <= 0) return stressed;
  const scale = targetBaseload / base;
  return stressed.map((price) => price * scale);
}

export interface Settlement {
  hours: number;
  /** Energy produced in settled hours, MWh. */
  producedMWh: number;
  /** Energy sold under the contract, MWh. */
  contractMWh: number;
  /** What the same output earns sold entirely at spot, EUR. */
  merchantRevenue: number;
  /** What the seller earns with the contract, including residual spot trades, EUR. */
  contractRevenue: number;
  /** Balancing and imbalance cost carried by the seller under the contract, EUR. */
  sellerBalancing: number;
  /** The same cost when selling merchant (always the seller's), EUR. */
  merchantBalancing: number;
  /** Baseload basis: energy bought at spot to cover shortfalls, MWh. */
  residualBoughtMWh: number;
  /** Baseload basis: surplus sold at spot, MWh. */
  residualSoldMWh: number;
  /** Output not delivered because the spot price was negative, MWh. */
  skippedMWh: number;
  /** contract net of balancing minus merchant net of balancing, EUR. Positive favours the seller. */
  sellerAdvantage: number;
  /** Average price received per contracted MWh, EUR/MWh. */
  realisedPrice: number | null;
}

function indexedPrice(spot: number, contract: PpaContract): number {
  let price = spot * (1 - contract.indexDiscount) - contract.indexFee;
  if (contract.indexFloor !== null) price = Math.max(contract.indexFloor, price);
  if (contract.indexCap !== null) price = Math.min(contract.indexCap, price);
  return price;
}

/** Settles a contract hour by hour against a price curve (seller's view). */
export function settle(m: Matched, prices: number[], contract: PpaContract): Settlement {
  let produced = 0;
  let contractMWh = 0;
  let merchant = 0;
  let contractRevenue = 0;
  let contractPaid = 0;
  let bought = 0;
  let sold = 0;
  let skipped = 0;
  for (let i = 0; i < m.t.length; i++) {
    const spot = prices[i];
    let gen = m.gen[i];
    if (contract.skipNegativeHours && spot < 0) {
      // The plant is curtailed: nothing is produced, sold or paid in this hour.
      skipped += gen;
      gen = 0;
      if (contract.volumeBasis !== "baseload") continue;
    }
    produced += gen;
    merchant += gen * spot;
    const price = contract.pricing === "fixed" ? contract.strike : indexedPrice(spot, contract);
    if (contract.volumeBasis === "baseload") {
      const q = contract.baseloadMW;
      contractMWh += q;
      contractPaid += q * price;
      // The seller balances its own output against the flat obligation at spot.
      contractRevenue += q * price + (gen - q) * spot;
      if (gen < q) bought += q - gen;
      else sold += gen - q;
    } else {
      contractMWh += gen;
      contractPaid += gen * price;
      contractRevenue += gen * price;
    }
  }
  const perMWh =
    contract.balancingCost +
    (contract.volumeBasis === "nominated" ? contract.nominationError * contract.imbalanceCost : 0);
  const merchantBalancing = produced * contract.balancingCost;
  // On the baseload basis the seller always balances its own plant.
  const sellerBalancing =
    contract.volumeBasis !== "baseload" && contract.balancingBy === "buyer" ? 0 : produced * perMWh;
  return {
    hours: m.t.length,
    producedMWh: produced,
    contractMWh,
    merchantRevenue: merchant,
    contractRevenue,
    sellerBalancing,
    merchantBalancing,
    residualBoughtMWh: bought,
    residualSoldMWh: sold,
    skippedMWh: skipped,
    sellerAdvantage: contractRevenue - sellerBalancing - (merchant - merchantBalancing),
    realisedPrice: contractMWh > 0 ? contractPaid / contractMWh : null,
  };
}

export interface PpaTerm {
  /** Contract length in years. */
  years: number;
  /** Forward baseload assumption for year 1, EUR/MWh. */
  forwardBaseload: number;
  /** Yearly change of the forward baseload, e.g. -0.02. */
  baseloadEscalation: number;
  /** Cannibalisation stress added per year (see forwardCurve), e.g. 0.02. */
  shapeStressPerYear: number;
  /** Starting shape stress in year 1. */
  shapeStressStart: number;
  /** Yearly loss of output, e.g. 0.004. */
  degradation: number;
  discountRate: number;
}

export interface PpaYear {
  year: number;
  baseload: number;
  capturePrice: number | null;
  captureRate: number | null;
  producedMWh: number;
  contractMWh: number;
  realisedPrice: number | null;
  merchantRevenue: number;
  contractRevenue: number;
  sellerAdvantage: number;
  discountFactor: number;
}

export interface PpaValuation {
  years: PpaYear[];
  /** NPV of (contract - merchant) for the seller, EUR. The buyer's is the negative. */
  npvSeller: number;
  /** Discounted contracted volume, MWh. */
  discountedMWh: number;
  /** npvSeller per discounted contracted MWh, EUR/MWh. */
  npvPerMWh: number | null;
  /** Fixed strike at which npvSeller is zero; null for indexed pricing. */
  fairStrike: number | null;
}

/** Scales the observed sample to full years and settles each contract year. */
export function valuePpa(m: Matched, contract: PpaContract, term: PpaTerm): PpaValuation {
  const years: PpaYear[] = [];
  const hours = m.t.length;
  if (hours === 0)
    return { years, npvSeller: 0, discountedMWh: 0, npvPerMWh: null, fairStrike: null };
  const toYear = 8760 / hours;
  let npv = 0;
  let discountedMWh = 0;
  const count = Math.max(1, Math.round(term.years));
  for (let y = 0; y < count; y++) {
    const baseload = term.forwardBaseload * (1 + term.baseloadEscalation) ** y;
    const stress = Math.max(0, term.shapeStressStart + term.shapeStressPerYear * y);
    const curve = forwardCurve(m, baseload, stress);
    const output = Math.max(0, 1 - term.degradation) ** y;
    const scaled: Matched = { t: m.t, price: curve, gen: m.gen.map((g) => g * output) };
    const s = settle(scaled, curve, contract);
    const stats = captureStats(scaled);
    // Mid-year discounting: cash arrives through the year.
    const df = 1 / (1 + term.discountRate) ** (y + 0.5);
    const advantage = s.sellerAdvantage * toYear;
    npv += advantage * df;
    discountedMWh += s.contractMWh * toYear * df;
    years.push({
      year: y + 1,
      baseload,
      capturePrice: stats.capturePrice,
      captureRate: stats.captureRate,
      producedMWh: s.producedMWh * toYear,
      contractMWh: s.contractMWh * toYear,
      realisedPrice: s.realisedPrice,
      merchantRevenue: s.merchantRevenue * toYear,
      contractRevenue: s.contractRevenue * toYear,
      sellerAdvantage: advantage,
      discountFactor: df,
    });
  }
  let fairStrike: number | null = null;
  if (contract.pricing === "fixed") {
    // NPV is linear in the strike, so two evaluations give the zero crossing.
    const at = (strike: number) => valuePpaNpv(m, { ...contract, strike }, term);
    const n0 = at(0);
    const n1 = at(1);
    fairStrike = n1 !== n0 ? -n0 / (n1 - n0) : null;
  }
  return {
    years,
    npvSeller: npv,
    discountedMWh,
    npvPerMWh: discountedMWh > 0 ? npv / discountedMWh : null,
    fairStrike,
  };
}

function valuePpaNpv(m: Matched, contract: PpaContract, term: PpaTerm): number {
  const toYear = 8760 / m.t.length;
  let npv = 0;
  const count = Math.max(1, Math.round(term.years));
  for (let y = 0; y < count; y++) {
    const baseload = term.forwardBaseload * (1 + term.baseloadEscalation) ** y;
    const stress = Math.max(0, term.shapeStressStart + term.shapeStressPerYear * y);
    const curve = forwardCurve(m, baseload, stress);
    const output = Math.max(0, 1 - term.degradation) ** y;
    const s = settle({ t: m.t, price: curve, gen: m.gen.map((g) => g * output) }, curve, contract);
    npv += (s.sellerAdvantage * toYear) / (1 + term.discountRate) ** (y + 0.5);
  }
  return npv;
}

// --- Generation profiles -----------------------------------------------------

/** Rescales a shape so its mean equals capacityMW x capacityFactor. */
export function scaleToCapacityFactor(
  shape: Series,
  capacityMW: number,
  capacityFactor: number,
): Series {
  const avg = mean(shape.v);
  if (avg === null || avg <= 0) return { t: [], v: [] };
  const k = (capacityMW * capacityFactor) / avg;
  // Output cannot exceed installed capacity; clipping is reported by the caller.
  return { t: shape.t, v: shape.v.map((value) => Math.min(capacityMW, Math.max(0, value * k))) };
}

export interface CsvProfile {
  points: IntervalValue[];
  rows: number;
  /** Line numbers (1-based) that could not be read, first 20. */
  badLines: number[];
  detectedDelimiter: string;
}

function localToUtcMs(y: number, mo: number, d: number, h: number, mi: number): number {
  // Find the UTC instant whose Europe/Belgrade wall time equals the given one.
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = (ms: number) => {
    const part =
      new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Belgrade", timeZoneName: "shortOffset" })
        .formatToParts(new Date(ms))
        .find((p) => p.type === "timeZoneName")?.value ?? "GMT+1";
    const match = /([+-]?\d+)/.exec(part);
    return (match ? parseInt(match[1], 10) : 1) * 3_600_000;
  };
  const first = guess - offsetAt(guess);
  return guess - offsetAt(first);
}

/**
 * Reads a two-column generation profile: timestamp, value (MW average for the interval).
 * Timestamps with an explicit zone (Z or +hh:mm) are used as they are. Bare timestamps
 * are read as UTC or as market time (CET/CEST) according to `zone`. In the repeated hour
 * of the autumn clock change a bare market-time stamp cannot say which hour it is; both
 * rows map to the first one, so prefer UTC for full-year files.
 */
export function parseProfileCsv(
  text: string,
  zone: "utc" | "market",
  intervalMinutes = 60,
): CsvProfile {
  const lines = text.split(/\r?\n/);
  const sample = lines.find((line) => line.trim().length > 0) ?? "";
  const delimiter = sample.includes(";") ? ";" : sample.includes("\t") ? "\t" : ",";
  const points: IntervalValue[] = [];
  const badLines: number[] = [];
  let rows = 0;
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const cells = trimmed.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, ""));
    if (cells.length < 2) {
      badLines.push(index + 1);
      return;
    }
    const stamp = cells[0];
    // With ";" or tab as the delimiter a decimal comma is unambiguous.
    const raw = delimiter === "," ? cells[1] : cells[1].replace(",", ".");
    const value = Number(raw);
    const match =
      /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(
        stamp,
      );
    if (!match) {
      // A first line that is not a timestamp is a header, not an error.
      if (rows === 0 && points.length === 0 && badLines.length === 0 && !/^\d/.test(stamp)) return;
      badLines.push(index + 1);
      return;
    }
    rows += 1;
    if (raw === "" || !Number.isFinite(value) || value < 0) {
      badLines.push(index + 1);
      return;
    }
    const [, y, mo, d, h, mi, tz] = match;
    let ms: number;
    if (tz)
      ms = Date.parse(
        `${y}-${mo}-${d}T${h}:${mi}:00${tz === "Z" ? "Z" : tz.includes(":") ? tz : `${tz.slice(0, 3)}:${tz.slice(3)}`}`,
      );
    else if (zone === "utc") ms = Date.UTC(+y, +mo - 1, +d, +h, +mi);
    else ms = localToUtcMs(+y, +mo, +d, +h, +mi);
    if (!Number.isFinite(ms)) {
      badLines.push(index + 1);
      return;
    }
    points.push({ ts: new Date(ms).toISOString(), value, durationMinutes: intervalMinutes });
  });
  return { points, rows, badLines: badLines.slice(0, 20), detectedDelimiter: delimiter };
}
