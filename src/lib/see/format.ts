// Number and time formatting for dense analytical UI. A missing value is always an
// em dash, never a zero.

const DASH = "—";

function finite(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

export function fmt(value: number | null | undefined, digits = 1): string {
  if (!finite(value)) return DASH;
  return value.toLocaleString("en-GB", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** EUR/MWh with adaptive precision: 104.3, 8.42, -0.15 */
export function fmtPrice(value: number | null | undefined): string {
  if (!finite(value)) return DASH;
  return fmt(value, Math.abs(value) < 10 ? 2 : 1);
}

export function fmtSigned(value: number | null | undefined, digits = 1): string {
  if (!finite(value)) return DASH;
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return fmt(0, digits);
  return `${rounded > 0 ? "+" : "−"}${fmt(Math.abs(rounded), digits)}`;
}

export function fmtMW(value: number | null | undefined): string {
  return finite(value) ? fmt(value, 0) : DASH;
}

/** Share in [0, 1] as a percentage. */
export function fmtShare(value: number | null | undefined, digits = 0): string {
  return finite(value) ? `${fmt(value * 100, digits)}%` : DASH;
}

export function fmtCompact(value: number | null | undefined): string {
  if (!finite(value)) return DASH;
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${fmt(value / 1e9, 2)}bn`;
  if (abs >= 1e6) return `${fmt(value / 1e6, 2)}m`;
  if (abs >= 1e4) return `${fmt(value / 1e3, 0)}k`;
  return fmt(value, 0);
}

const HOUR_MS = 3_600_000;
const DAY_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Belgrade",
  day: "2-digit",
  month: "short",
});
const DAY_HOUR_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Belgrade",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const HOUR_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Belgrade",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "14 Nov" for a YYYY-MM-DD delivery day. */
export function fmtDay(dayISO: string): string {
  const date = new Date(`${dayISO}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? DASH : DAY_FMT.format(date);
}

/** "14 Nov 18:00" in market time for a UTC epoch hour. */
export function fmtEpochHour(epochHour: number): string {
  return DAY_HOUR_FMT.format(new Date(epochHour * HOUR_MS));
}

export function fmtEpochHourShort(epochHour: number): string {
  return HOUR_FMT.format(new Date(epochHour * HOUR_MS));
}

/** "14:32 CET" style clock time for an ISO timestamp. */
export function fmtClock(iso: string | undefined): string {
  if (!iso) return DASH;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return DASH;
  return HOUR_FMT.format(date);
}

/** Age of a timestamp as "now", "12 min", "3 h", "2 d". */
export function fmtAge(iso: string | undefined, now = Date.now()): string {
  if (!iso) return DASH;
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return DASH;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 1440)} d`;
}
