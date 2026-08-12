import { addDaysISO } from "@/lib/date-range";

export type ComparisonKey = "previous_equivalent" | "previous_month" | "previous_year" | "none";

export type DateRangeKeys = { from: string; to: string };

function parseDayKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function formatDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseComparisonKey(value?: string | null): ComparisonKey {
  switch (value) {
    case "previous_equivalent":
    case "previous_month":
    case "previous_year":
    case "none":
      return value;
    default:
      return "previous_equivalent";
  }
}

export function previousMonthRangeKeys(dayKey: string): DateRangeKeys {
  const date = parseDayKey(dayKey);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const from = new Date(Date.UTC(year, month - 1, 1, 12));
  const to = new Date(Date.UTC(year, month, 0, 12));
  return { from: formatDayKey(from), to: formatDayKey(to) };
}

function previousYearRangeKeys(dayKey: string): DateRangeKeys {
  const year = parseDayKey(dayKey).getUTCFullYear() - 1;
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

export function comparisonRangeKeys(
  range: DateRangeKeys,
  comparison: ComparisonKey,
): DateRangeKeys | undefined {
  if (comparison === "none") return undefined;
  if (comparison === "previous_month") return previousMonthRangeKeys(range.to);
  if (comparison === "previous_year") return previousYearRangeKeys(range.to);

  const from = parseDayKey(range.from);
  const to = parseDayKey(range.to);
  const days = Math.max(1, Math.round((+to - +from) / 86_400_000) + 1);
  const previousTo = addDaysISO(range.from, -1);
  return { from: addDaysISO(previousTo, -(days - 1)), to: previousTo };
}

export function monthKeysBetween(from: string, to: string): string[] {
  const fromDate = parseDayKey(from);
  const toDate = parseDayKey(to);
  if (!Number.isFinite(+fromDate) || !Number.isFinite(+toDate) || fromDate > toDate) return [];

  const months: string[] = [];
  let year = fromDate.getUTCFullYear();
  let month = fromDate.getUTCMonth();
  const endYear = toDate.getUTCFullYear();
  const endMonth = toDate.getUTCMonth();

  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month + 1).padStart(2, "0")}`);
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return months;
}

export function monthOffsetBetween(fromKey: string, toKey: string): number {
  const [fromYear, fromMonth] = fromKey.slice(0, 7).split("-").map(Number);
  const [toYear, toMonth] = toKey.slice(0, 7).split("-").map(Number);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

export function shiftMonthKey(monthKey: string, offset: number): string {
  const [year, month] = monthKey.slice(0, 7).split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1, 12));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}
