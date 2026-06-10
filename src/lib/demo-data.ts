// Synthetic but realistic-looking SEEPEX-style hourly prices and RES profiles
// for one full year, used as fallback when live ENTSO-E data is unavailable.
// All prices in EUR/MWh.

export type HourlyPoint = { ts: Date; price: number; solar: number; wind: number };

const YEAR = 2026;

// Deterministic pseudo-random (mulberry32) so demo data is stable across renders
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(42);

function dayOfYear(d: Date) {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / 86400000);
}

// Solar production per MW installed (MWh/h) — bell curve around solar noon,
// scaled by seasonal irradiance.
function solarProfile(d: Date): number {
  const h = d.getHours();
  const doy = dayOfYear(d);
  // Seasonal: peak around day 172 (summer solstice)
  const season = 0.55 + 0.45 * Math.cos(((doy - 172) / 365) * 2 * Math.PI);
  // Hourly bell around 13:00
  const bell = Math.max(0, Math.cos(((h - 13) / 6) * (Math.PI / 2)));
  const cloud = 0.75 + 0.25 * rnd();
  return Math.max(0, bell ** 1.8 * season * cloud);
}

// Wind production per MW installed — anti-correlated with solar, noisier
function windProfile(d: Date): number {
  const h = d.getHours();
  const doy = dayOfYear(d);
  const season = 0.5 + 0.3 * Math.cos(((doy - 350) / 365) * 2 * Math.PI); // winter peak
  // diurnal: stronger at night
  const diurnal = 0.45 + 0.25 * Math.cos((h / 24) * 2 * Math.PI);
  const gust = 0.5 + 0.9 * rnd();
  return Math.max(0, Math.min(0.95, season * diurnal * gust));
}

// SEEPEX-style hourly price (EUR/MWh) with realistic patterns:
// - morning + evening peaks
// - lower weekend prices
// - depressed midday due to solar
// - occasional negative price hours in spring/summer afternoons
function hourlyPrice(d: Date, solar: number, wind: number): number {
  const h = d.getHours();
  const dow = d.getDay(); // 0 = Sun
  const doy = dayOfYear(d);

  const base = 78; // EUR/MWh baseload
  const seasonal = 12 * Math.cos(((doy - 15) / 365) * 2 * Math.PI); // winter peak
  // Twin-peak diurnal (~7-9 and 18-21)
  const morningPeak = 30 * Math.exp(-((h - 8) ** 2) / 4);
  const eveningPeak = 45 * Math.exp(-((h - 19) ** 2) / 4);
  const middayDip = -22 * Math.exp(-((h - 13) ** 2) / 6);
  const weekend = dow === 0 || dow === 6 ? -12 : 0;
  // RES cannibalisation
  const resPush = -55 * solar - 25 * wind;
  const noise = (rnd() - 0.5) * 24;

  return base + seasonal + morningPeak + eveningPeak + middayDip + weekend + resPush + noise;
}

let cached: HourlyPoint[] | null = null;

export function getDemoYear(year = YEAR): HourlyPoint[] {
  if (cached) return cached;
  const out: HourlyPoint[] = [];
  const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0));
  for (let t = start.getTime(); t < end.getTime(); t += 3600_000) {
    const ts = new Date(t);
    const solar = solarProfile(ts);
    const wind = windProfile(ts);
    const price = hourlyPrice(ts, solar, wind);
    out.push({ ts, price, solar, wind });
  }
  cached = out;
  return out;
}

export function getRecentDays(days: number): HourlyPoint[] {
  const data = getDemoYear();
  return data.slice(-days * 24);
}

// Aggregate helpers
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
