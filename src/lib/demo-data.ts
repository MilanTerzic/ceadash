// Synthetic but realistic-looking SEEPEX-style hourly prices and RES profiles
// for one full year, used as fallback when live ENTSO-E data is unavailable.
// All values are deterministic per timestamp — NO stateful PRNG — so SSR and
// client renders produce identical output (avoids hydration mismatches).
// All prices in EUR/MWh.

export type HourlyPoint = {
  ts: Date;
  price: number;
  solar: number;
  wind: number;
  isReal?: boolean;
};

const YEAR = 2026;

// Deterministic noise from a 32-bit integer key (xorshift-style hash).
function hashNoise(key: number) {
  let x = key | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  // Map to [0,1)
  return ((x >>> 0) % 100000) / 100000;
}

function dayOfYear(d: Date) {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((d.getTime() - start) / 86400000);
}

function solarProfile(d: Date): number {
  const h = d.getUTCHours();
  const doy = dayOfYear(d);
  const season = 0.55 + 0.45 * Math.cos(((doy - 172) / 365) * 2 * Math.PI);
  const bell = Math.max(0, Math.cos(((h - 13) / 6) * (Math.PI / 2)));
  const cloud = 0.78 + 0.22 * hashNoise(doy * 31 + h * 7 + 11);
  return Math.max(0, bell ** 1.8 * season * cloud);
}

function windProfile(d: Date): number {
  const h = d.getUTCHours();
  const doy = dayOfYear(d);
  const season = 0.5 + 0.3 * Math.cos(((doy - 350) / 365) * 2 * Math.PI);
  const diurnal = 0.45 + 0.25 * Math.cos((h / 24) * 2 * Math.PI);
  const gust = 0.5 + 0.9 * hashNoise(doy * 53 + h * 17 + 23);
  return Math.max(0, Math.min(0.95, season * diurnal * gust));
}

function hourlyPrice(d: Date, solar: number, wind: number): number {
  const h = d.getUTCHours();
  const dow = d.getUTCDay();
  const doy = dayOfYear(d);

  const base = 78;
  const seasonal = 12 * Math.cos(((doy - 15) / 365) * 2 * Math.PI);
  const morningPeak = 30 * Math.exp(-((h - 8) ** 2) / 4);
  const eveningPeak = 45 * Math.exp(-((h - 19) ** 2) / 4);
  const middayDip = -22 * Math.exp(-((h - 13) ** 2) / 6);
  const weekend = dow === 0 || dow === 6 ? -12 : 0;
  const resPush = -55 * solar - 25 * wind;
  const noise = (hashNoise(doy * 97 + h * 13 + 5) - 0.5) * 24;

  return base + seasonal + morningPeak + eveningPeak + middayDip + weekend + resPush + noise;
}

let cached: HourlyPoint[] | null = null;

export function getDemoYear(year = YEAR): HourlyPoint[] {
  if (cached && cached[0]?.ts.getUTCFullYear() === year) return cached;
  const out: HourlyPoint[] = [];
  const start = Date.UTC(year, 0, 1, 0, 0, 0);
  const end = Date.UTC(year + 1, 0, 1, 0, 0, 0);
  for (let t = start; t < end; t += 3600_000) {
    const ts = new Date(t);
    const solar = solarProfile(ts);
    const wind = windProfile(ts);
    const price = hourlyPrice(ts, solar, wind);
    out.push({ ts, price, solar, wind });
  }
  cached = out;
  return out;
}

/** Merge real DB/ENTSO-E prices into the demo year (by ISO hour). */
export function applyRealPrices(
  points: HourlyPoint[],
  real: { ts: string; price: number }[],
): HourlyPoint[] {
  if (!real.length) return points;
  const m = new Map(real.map((r) => [r.ts.slice(0, 13), r.price]));
  let touched = false;
  const merged = points.map((p) => {
    const k = p.ts.toISOString().slice(0, 13);
    const v = m.get(k);
    if (v == null) return p;
    touched = true;
    return { ...p, price: v, isReal: true };
  });
  return touched ? merged : points;
}

export function getRecentDays(days: number, source = getDemoYear()): HourlyPoint[] {
  return source.slice(-days * 24);
}

export function dailyAvg(points: HourlyPoint[], key: "price" | "solar" | "wind") {
  const map = new Map<string, number[]>();
  for (const p of points) {
    const k = p.ts.toISOString().slice(0, 10);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(p[key]);
  }
  return Array.from(map.entries()).map(([day, vals]) => ({
    day,
    value: vals.reduce((a, b) => a + b, 0) / vals.length,
  }));
}

export function monthlyAvg(points: HourlyPoint[], key: "price" | "solar" | "wind") {
  const map = new Map<string, number[]>();
  for (const p of points) {
    const k = p.ts.toISOString().slice(0, 7);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(p[key]);
  }
  return Array.from(map.entries()).map(([month, vals]) => ({
    month,
    value: vals.reduce((a, b) => a + b, 0) / vals.length,
  }));
}

export function captureMetricsByMonth(points: HourlyPoint[]) {
  const map = new Map<string, { sumP: number; nP: number; sumPS: number; sumS: number; sumPW: number; sumW: number; nNeg: number; sumSneg: number; sumWneg: number }>();
  for (const p of points) {
    const k = p.ts.toISOString().slice(0, 7);
    let m = map.get(k);
    if (!m) {
      m = { sumP: 0, nP: 0, sumPS: 0, sumS: 0, sumPW: 0, sumW: 0, nNeg: 0, sumSneg: 0, sumWneg: 0 };
      map.set(k, m);
    }
    m.sumP += p.price;
    m.nP += 1;
    m.sumPS += p.price * p.solar;
    m.sumS += p.solar;
    m.sumPW += p.price * p.wind;
    m.sumW += p.wind;
    if (p.price < 0) {
      m.nNeg += 1;
      m.sumSneg += p.solar;
      m.sumWneg += p.wind;
    }
  }
  return Array.from(map.entries()).map(([month, v]) => {
    const baseload = v.sumP / v.nP;
    const solarCapture = v.sumS > 0 ? v.sumPS / v.sumS : 0;
    const windCapture = v.sumW > 0 ? v.sumPW / v.sumW : 0;
    return {
      month,
      baseload,
      solarCapture,
      windCapture,
      solarRate: solarCapture / baseload,
      windRate: windCapture / baseload,
      negHours: v.nNeg,
      solarNegShare: v.sumS > 0 ? v.sumSneg / v.sumS : 0,
      windNegShare: v.sumW > 0 ? v.sumWneg / v.sumW : 0,
    };
  });
}
