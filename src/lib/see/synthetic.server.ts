// Synthetic market data for development and visual testing ONLY.
//
// Enabled solely by CEA_SYNTHETIC_DATA=1 on the server. Every result produced here is
// returned with source "demo", which the shell turns into a permanent "SYNTHETIC DATA"
// banner. Nothing in this file is ever mixed into observed series.
import process from "node:process";

export function syntheticEnabled(): boolean {
  return process.env.CEA_SYNTHETIC_DATA === "1";
}

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic pseudo-random number in [0, 1) for a key. */
function rnd(key: string): number {
  let t = (hash(key) + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const BELGRADE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Belgrade",
  hour: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});

function localHourAndWeekend(ms: number): { hour: number; weekend: boolean } {
  const parts = BELGRADE.formatToParts(new Date(ms));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  return { hour, weekend: weekday === "Sat" || weekday === "Sun" };
}

function offsetHours(dayISO: string): number {
  const part =
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Belgrade", timeZoneName: "shortOffset" })
      .formatToParts(new Date(`${dayISO}T12:00:00Z`))
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT+1";
  const match = /([+-]?\d+)/.exec(part);
  return match ? parseInt(match[1], 10) : 1;
}

function addDay(dayISO: string, days: number): string {
  const date = new Date(`${dayISO}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** UTC ms bounds of the CET/CEST delivery window [fromISO 00:00, toISO 24:00). */
export function deliveryWindow(fromISO: string, toISO: string): { start: number; end: number } {
  const after = addDay(toISO, 1);
  return {
    start: Date.parse(`${fromISO}T00:00:00Z`) - offsetHours(fromISO) * 3600_000,
    end: Date.parse(`${after}T00:00:00Z`) - offsetHours(after) * 3600_000,
  };
}

function steps(fromISO: string, toISO: string, stepMinutes: number): number[] {
  const { start, end } = deliveryWindow(fromISO, toISO);
  // Never synthesise the future beyond tomorrow's delivery day: day-ahead data ends there.
  const tomorrow = addDay(new Date().toISOString().slice(0, 10), 1);
  const cap = Math.min(end, deliveryWindow(tomorrow, tomorrow).end);
  const out: number[] = [];
  for (let t = start; t < cap; t += stepMinutes * 60_000) out.push(t);
  return out;
}

// Rough relative price levels and solar depth per zone; purely illustrative.
const LEVEL: Record<string, number> = {
  RS: 104,
  HU: 101,
  RO: 100,
  BG: 97,
  GR: 99,
  HR: 100,
  SI: 99,
  ME: 106,
  MK: 108,
  AL: 103,
  XK: 105,
  AT: 93,
  DE_LU: 88,
  IT_NORD: 112,
  IT_CSUD: 109,
};
const SOLAR_DEPTH: Record<string, number> = { GR: 1.5, BG: 1.3, RO: 1.2, HU: 1.3, DE_LU: 1.4 };
const QUARTER_HOURLY = new Set([
  "HU",
  "RO",
  "BG",
  "GR",
  "HR",
  "SI",
  "AT",
  "DE_LU",
  "IT_NORD",
  "IT_CSUD",
]);

function priceAt(zone: string, ms: number): number {
  const { hour, weekend } = localHourAndWeekend(ms);
  const day = Math.floor(ms / 86400_000);
  const regional =
    (rnd(`regional:${day}`) - 0.5) * 18 + (rnd(`week:${Math.floor(day / 7)}`) - 0.5) * 30;
  const local = (rnd(`${zone}:day:${day}`) - 0.5) * 16;
  const morning = 26 * Math.exp(-((hour - 8) ** 2) / 5);
  const evening = 44 * Math.exp(-((hour - 19.5) ** 2) / 6);
  const solar =
    -48 * (SOLAR_DEPTH[zone] ?? 1) * Math.exp(-((hour - 13) ** 2) / 9) * (0.5 + rnd(`sun:${day}`));
  const night = hour < 6 ? -14 : 0;
  const noise = (rnd(`${zone}:${ms}`) - 0.5) * 9;
  const level = (LEVEL[zone] ?? 100) * (weekend ? 0.84 : 1);
  return (
    Math.round((level + regional + local + morning + evening + solar + night + noise) * 100) / 100
  );
}

export function syntheticPrices(zone: string, fromISO: string, toISO: string) {
  const durationMinutes = QUARTER_HOURLY.has(zone) ? 15 : 60;
  return steps(fromISO, toISO, durationMinutes).map((ms) => ({
    ts: new Date(ms).toISOString(),
    price: priceAt(zone, ms),
    durationMinutes,
  }));
}

function ntcFor(a: string, b: string): number {
  const key = [a, b].sort().join(":");
  return 300 + Math.round(rnd(`ntc:${key}`) * 9) * 100;
}

/** Physical flow from -> to. Power moves towards the dearer zone, with noise. */
export function syntheticFlows(from: string, to: string, fromISO: string, toISO: string) {
  const ntc = ntcFor(from, to);
  return steps(fromISO, toISO, 60).map((ms) => {
    const hasA = from in LEVEL;
    const hasB = to in LEVEL;
    const spread = (hasB ? priceAt(to, ms) : 100) - (hasA ? priceAt(from, ms) : 100);
    const structural =
      (rnd(`bias:${[from, to].sort().join(":")}`) - 0.5) * 0.9 * (from < to ? 1 : -1);
    const drive =
      Math.tanh(spread / 18) * 0.75 + structural + (rnd(`flow:${from}:${to}:${ms}`) - 0.5) * 0.25;
    return {
      ts: new Date(ms).toISOString(),
      mw: Math.round(Math.max(0, Math.min(1, drive)) * ntc),
      durationMinutes: 60,
    };
  });
}

/** Scheduled commercial exchange: related to the physical flow but not equal to it. */
export function syntheticSchedules(from: string, to: string, fromISO: string, toISO: string) {
  const ntc = ntcFor(from, to);
  return syntheticFlows(from, to, fromISO, toISO).map((point) => ({
    ...point,
    mw: Math.round(
      Math.max(0, Math.min(ntc, point.mw * (0.7 + rnd(`sched:${from}:${to}:${point.ts}`) * 0.6))),
    ),
  }));
}

export function syntheticNtc(from: string, to: string, fromISO: string, toISO: string) {
  const ntc = ntcFor(from, to);
  return steps(fromISO, toISO, 60).map((ms) => ({
    ts: new Date(ms).toISOString(),
    mw: ntc - (rnd(`ntcday:${from}:${to}:${Math.floor(ms / 86400_000)}`) < 0.15 ? 100 : 0),
    durationMinutes: 60,
  }));
}

export function syntheticAllocation(from: string, to: string, dayISO: string) {
  const { start } = deliveryWindow(dayISO, dayISO);
  const hasBoth = from in LEVEL && to in LEVEL;
  let spread = 0;
  for (let h = 0; h < 24; h++) {
    const ms = start + h * 3600_000;
    spread += hasBoth ? Math.max(0, priceAt(to, ms) - priceAt(from, ms)) : 0;
  }
  const ntc = ntcFor(from, to);
  return {
    price_eur_mwh:
      Math.round((spread / 24) * (0.5 + rnd(`cap:${from}:${to}:${dayISO}`) * 0.4) * 100) / 100,
    offered_mw: ntc,
    allocated_mw: Math.round(ntc * (0.6 + rnd(`alloc:${from}:${to}:${dayISO}`) * 0.4)),
  };
}

const PEAK_LOAD: Record<string, number> = {
  RS: 5200,
  HU: 6200,
  RO: 7400,
  BG: 5000,
  GR: 6800,
  HR: 2600,
  SI: 1900,
  BA: 1700,
  ME: 520,
  MK: 1100,
  AL: 1150,
  XK: 950,
  AT: 8600,
};

export function syntheticLoad(zone: string, fromISO: string, toISO: string, forecast = false) {
  const peak = PEAK_LOAD[zone] ?? 2000;
  return steps(fromISO, toISO, 60).map((ms) => {
    const { hour, weekend } = localHourAndWeekend(ms);
    const shape =
      0.62 + 0.2 * Math.exp(-((hour - 9) ** 2) / 14) + 0.3 * Math.exp(-((hour - 19) ** 2) / 10);
    const noise = (rnd(`load:${zone}:${ms}:${forecast ? "f" : "a"}`) - 0.5) * 0.04;
    return {
      ts: new Date(ms).toISOString(),
      mw: Math.round(peak * shape * (weekend ? 0.9 : 1) * (1 + noise)),
      durationMinutes: 60,
    };
  });
}

// ENTSO-E production type codes with an illustrative share of peak load per zone.
const MIX: Record<string, Record<string, number>> = {
  RS: { B02: 0.5, B11: 0.12, B12: 0.1, B19: 0.07, B16: 0.03, B04: 0.04 },
  HU: { B14: 0.3, B04: 0.2, B16: 0.5, B19: 0.03, B02: 0.04 },
  RO: { B14: 0.18, B12: 0.14, B11: 0.12, B19: 0.28, B16: 0.2, B04: 0.12, B02: 0.1 },
  BG: { B14: 0.38, B02: 0.25, B16: 0.5, B19: 0.08, B12: 0.08 },
  GR: { B04: 0.35, B16: 0.7, B19: 0.3, B12: 0.08, B02: 0.05 },
  HR: { B12: 0.3, B11: 0.2, B19: 0.25, B04: 0.12, B16: 0.12 },
  SI: { B14: 0.33, B11: 0.25, B02: 0.15, B16: 0.3 },
  BA: { B02: 0.6, B12: 0.35, B19: 0.06, B16: 0.04 },
  ME: { B02: 0.35, B12: 0.5, B19: 0.15 },
  MK: { B02: 0.35, B12: 0.15, B04: 0.2, B16: 0.2, B19: 0.05 },
  AL: { B12: 0.8, B11: 0.2, B16: 0.2 },
  XK: { B02: 0.8, B19: 0.1 },
  AT: { B11: 0.4, B12: 0.15, B19: 0.25, B16: 0.35, B04: 0.1 },
};

export function syntheticGeneration(zone: string, fromISO: string, toISO: string) {
  const peak = PEAK_LOAD[zone] ?? 2000;
  const mix = MIX[zone] ?? { B04: 0.5 };
  return steps(fromISO, toISO, 60).map((ms) => {
    const { hour } = localHourAndWeekend(ms);
    const day = Math.floor(ms / 86400_000);
    const production: Record<string, number> = {};
    for (const [type, share] of Object.entries(mix)) {
      let factor = 0.8 + (rnd(`gen:${zone}:${type}:${day}`) - 0.5) * 0.2;
      if (type === "B16")
        factor = Math.max(0, Math.exp(-((hour - 13) ** 2) / 9) * (0.4 + rnd(`sun:${day}`)));
      if (type === "B19")
        factor = 0.15 + rnd(`wind:${zone}:${Math.floor(ms / (6 * 3600_000))}`) * 0.7;
      if (type === "B12") factor = 0.3 + 0.5 * Math.exp(-((hour - 19) ** 2) / 12);
      production[type] = Math.round(peak * share * factor);
    }
    return {
      ts: new Date(ms).toISOString(),
      gen_mw: Object.values(production).reduce((sum, value) => sum + value, 0),
      durationMinutes: 60,
      production,
    };
  });
}

/** Day-ahead wind (B19) and solar (B16) forecast, close to but not equal to "actuals". */
export function syntheticResForecast(zone: string, fromISO: string, toISO: string) {
  return syntheticGeneration(zone, fromISO, toISO).flatMap((point) =>
    (["B16", "B19"] as const)
      .filter((type) => point.production[type] !== undefined)
      .map((type) => ({
        ts: point.ts,
        mw: Math.round(
          point.production[type] * (0.85 + rnd(`fc:${zone}:${type}:${point.ts}`) * 0.3),
        ),
        durationMinutes: 60,
        productionType: type,
      })),
  );
}
