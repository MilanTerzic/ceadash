import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarIcon, Clock3, RefreshCw, ShieldCheck } from "lucide-react";
import { useNavigate, useSearch } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { belgradeDateISO } from "@/lib/date-range";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type PresetKey = "today" | "d1" | "7d" | "30d" | "mtd" | "prev_month" | "ytd" | "custom";

export type ComparisonKey = "previous_equivalent" | "previous_month" | "previous_year" | "none";

export type DateRangeKeys = { from: string; to: string };

const OVERVIEW_PRESETS: PresetKey[] = ["7d", "30d", "mtd", "prev_month", "ytd", "custom"];

function parseDayKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function addDaysKey(dayKey: string, days: number) {
  const date = parseDayKey(dayKey);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDayKey(date);
}

function formatDayKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function monthStartKey(dayKey: string) {
  return `${dayKey.slice(0, 7)}-01`;
}

function previousMonthRange(dayKey: string): DateRangeKeys {
  const [year, month] = dayKey.split("-").map(Number);
  const from = new Date(Date.UTC(year, month - 2, 1, 12));
  const to = new Date(Date.UTC(year, month - 1, 0, 12));
  return { from: formatDayKey(from), to: formatDayKey(to) };
}

function previousYearRange(dayKey: string): DateRangeKeys {
  const [year] = dayKey.split("-").map(Number);
  return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
}

function presetRangeKeys(preset: PresetKey, todayKey = belgradeDateISO()): DateRangeKeys {
  switch (preset) {
    case "today":
      return { from: todayKey, to: todayKey };
    case "d1": {
      const tomorrow = addDaysKey(todayKey, 1);
      return { from: tomorrow, to: tomorrow };
    }
    case "7d":
      return { from: addDaysKey(todayKey, -6), to: todayKey };
    case "30d":
      return { from: addDaysKey(todayKey, -29), to: todayKey };
    case "mtd":
      return { from: monthStartKey(todayKey), to: todayKey };
    case "prev_month":
      return previousMonthRange(todayKey);
    case "ytd":
      return { from: `${todayKey.slice(0, 4)}-01-01`, to: todayKey };
    default:
      return { from: todayKey, to: todayKey };
  }
}

function comparisonRangeKeys(
  range: DateRangeKeys,
  comparison: ComparisonKey,
): DateRangeKeys | undefined {
  if (comparison === "none") return undefined;
  if (comparison === "previous_month") return previousMonthRange(range.to);
  if (comparison === "previous_year") return previousYearRange(range.to);

  const from = parseDayKey(range.from);
  const to = parseDayKey(range.to);
  const days = Math.max(1, Math.round((+to - +from) / 86_400_000) + 1);
  const previousTo = addDaysKey(range.from, -1);
  return { from: addDaysKey(previousTo, -(days - 1)), to: previousTo };
}

function sameRange(a: DateRangeKeys, b: DateRangeKeys) {
  return a.from === b.from && a.to === b.to;
}

function matchingPreset(range: DateRangeKeys, presets: PresetKey[]) {
  const todayKey = belgradeDateISO();
  return presets.find(
    (preset) => preset !== "custom" && sameRange(range, presetRangeKeys(preset, todayKey)),
  );
}

function labelForPreset(preset: PresetKey, t: (en: string, sr: string) => string) {
  switch (preset) {
    case "today":
      return t("Today", "Danas");
    case "d1":
      return "D+1";
    case "7d":
      return t("Last 7d", "Poslednjih 7 dana");
    case "30d":
      return t("Last 30d", "Poslednjih 30 dana");
    case "mtd":
      return t("MTD", "Od pocetka meseca");
    case "prev_month":
      return t("Prev. month", "Prethodni mesec");
    case "ytd":
      return t("YTD", "Od pocetka godine");
    default:
      return t("Custom", "Prilagodjeno");
  }
}

function formatRangeLabel(range?: DateRangeKeys) {
  if (!range) return "";
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Belgrade",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const from = formatter.format(parseDayKey(range.from));
  const to = formatter.format(parseDayKey(range.to));
  return range.from === range.to ? from : `${from} - ${to}`;
}

function checkedTimeLabel(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Belgrade",
  });
}

/** Resolve the requested analysis-period start (Belgrade YYYY-MM-DD) from URL
 *  search params, independent of what data is already cached. Used to drive
 *  server-side backfill so KPIs/charts cover the full chosen period. */
export function useRequestedFromKey(): string {
  return useRequestedRangeKeys().fromKey;
}

/** Resolve the requested analysis-period start AND end (Belgrade YYYY-MM-DD)
 *  from URL search params, independent of what data is already cached. Used
 *  to drive server-side backfill so KPIs/charts cover the full chosen period. */
export function useRequestedRangeKeys(): { fromKey: string; toKey: string; preset: PresetKey } {
  const search = useSearch({ strict: false }) as { from?: string; to?: string; preset?: PresetKey };
  const preset: PresetKey = search.preset ?? "30d";
  const fallback = presetRangeKeys("30d");
  const range =
    preset === "custom"
      ? {
          from: search.from ?? fallback.from,
          to: search.to ?? fallback.to,
        }
      : presetRangeKeys(preset);
  return { fromKey: range.from, toKey: range.to, preset };
}

export function useDashboardRange(opts: { firstAvailable?: Date; latestAvailable?: Date }) {
  const search = useSearch({ strict: false }) as { from?: string; to?: string; preset?: PresetKey };
  const navigate = useNavigate();
  const preset: PresetKey = search.preset ?? "30d";

  const rangeKeys = useMemo<DateRangeKeys>(() => {
    if (preset !== "custom") return presetRangeKeys(preset);
    const fallback = presetRangeKeys("30d");
    return {
      from: search.from ?? fallback.from,
      to: search.to ?? fallback.to,
    };
  }, [preset, search.from, search.to]);

  const range = useMemo(
    () => ({ from: parseDayKey(rangeKeys.from), to: parseDayKey(rangeKeys.to) }),
    [rangeKeys.from, rangeKeys.to],
  );

  const setPreset = (p: PresetKey) => {
    navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        preset: p,
        from: undefined,
        to: undefined,
      }),
      replace: true,
    });
  };

  const setRangeKeys = (next: DateRangeKeys) => {
    navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        preset: "custom" as const,
        from: next.from,
        to: next.to,
      }),
      replace: true,
    });
  };

  return {
    preset,
    range,
    rangeKeys,
    fromKey: rangeKeys.from,
    toKey: rangeKeys.to,
    setPreset,
    setRangeKeys,
    firstAvailable: opts.firstAvailable,
    latestAvailable: opts.latestAvailable,
  };
}

type DateRangeControlProps = {
  firstAvailable?: Date;
  latestAvailable?: Date;
  disabled?: boolean;
  range?: DateRangeKeys;
  activePreset?: PresetKey;
  presets?: PresetKey[];
  onRangeChange?: (range: DateRangeKeys, preset: PresetKey) => void;
  comparison?: ComparisonKey;
  onComparisonChange?: (comparison: ComparisonKey, comparisonRange?: DateRangeKeys) => void;
  coverage?: ReactNode;
  lastRefresh?: string;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  maxFutureDays?: number;
};

export function DateRangeControl({
  firstAvailable,
  latestAvailable,
  disabled = false,
  range: controlledRange,
  activePreset,
  presets = OVERVIEW_PRESETS,
  onRangeChange,
  comparison: controlledComparison,
  onComparisonChange,
  coverage,
  lastRefresh,
  onRefresh,
  isRefreshing = false,
  maxFutureDays = 0,
}: DateRangeControlProps) {
  const { t } = useLang();
  const dashboardRange = useDashboardRange({ firstAvailable, latestAvailable });
  const isControlled = Boolean(controlledRange && onRangeChange);
  const rangeKeys = controlledRange ?? dashboardRange.rangeKeys;
  const selectedPreset =
    activePreset ??
    matchingPreset(rangeKeys, presets) ??
    (isControlled ? "custom" : dashboardRange.preset);
  const [open, setOpen] = useState(false);
  const [internalComparison, setInternalComparison] =
    useState<ComparisonKey>("previous_equivalent");
  const comparison = controlledComparison ?? internalComparison;
  const [draftFromKey, setDraftFromKey] = useState(rangeKeys.from);
  const [draftToKey, setDraftToKey] = useState(rangeKeys.to);

  useEffect(() => {
    setDraftFromKey(rangeKeys.from);
    setDraftToKey(rangeKeys.to);
  }, [rangeKeys.from, rangeKeys.to]);

  useEffect(() => {
    onComparisonChange?.(comparison, comparisonRangeKeys(rangeKeys, comparison));
  }, [comparison, onComparisonChange, rangeKeys]);

  const label = rangeKeys ? formatRangeLabel(rangeKeys) : t("Pick a range", "Izaberite period");
  const comparisonRange = comparisonRangeKeys(rangeKeys, comparison);

  const selectableBounds = useMemo(() => {
    const today = belgradeDateISO();
    return {
      min: `${Number(today.slice(0, 4)) - 5}${today.slice(4)}`,
      max: addDaysKey(today, maxFutureDays),
    };
  }, [maxFutureDays]);

  const applyRange = (next: DateRangeKeys, preset: PresetKey) => {
    if (isControlled) {
      onRangeChange?.(next, preset);
      return;
    }
    if (preset === "custom") {
      dashboardRange.setRangeKeys(next);
    } else {
      dashboardRange.setPreset(preset);
    }
  };

  const canApply = Boolean(draftFromKey && draftToKey && draftFromKey <= draftToKey);

  const handleApply = () => {
    if (!canApply) return;
    applyRange({ from: draftFromKey, to: draftToKey }, "custom");
    setOpen(false);
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setDraftFromKey(rangeKeys.from);
      setDraftToKey(rangeKeys.to);
    }
  };

  const handlePresetClick = (preset: PresetKey) => {
    if (preset === "custom") {
      setOpen(true);
      return;
    }
    applyRange(presetRangeKeys(preset), preset);
  };

  const handleComparisonChange = (value: ComparisonKey) => {
    if (controlledComparison === undefined) {
      setInternalComparison(value);
    }
    onComparisonChange?.(value, comparisonRangeKeys(rangeKeys, value));
  };

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-0">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("Analysis period", "Period analize")}
          </Label>
          <Popover open={open} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                disabled={disabled}
                className={cn(
                  "mt-1.5 w-full min-w-[240px] justify-start text-left font-normal sm:w-[280px]",
                  !rangeKeys && "text-muted-foreground",
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {label}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[min(360px,calc(100vw-2rem))] p-0" align="start">
              <div className="pointer-events-auto space-y-4 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="analysis-from"
                      className="text-xs uppercase tracking-wider text-muted-foreground"
                    >
                      {t("From", "Od")}
                    </Label>
                    <Input
                      id="analysis-from"
                      type="date"
                      value={draftFromKey}
                      min={selectableBounds.min}
                      max={selectableBounds.max}
                      disabled={disabled}
                      onChange={(e) => setDraftFromKey(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="analysis-to"
                      className="text-xs uppercase tracking-wider text-muted-foreground"
                    >
                      {t("To", "Do")}
                    </Label>
                    <Input
                      id="analysis-to"
                      type="date"
                      value={draftToKey}
                      min={draftFromKey || selectableBounds.min}
                      max={selectableBounds.max}
                      disabled={disabled}
                      onChange={(e) => setDraftToKey(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-border/70 pt-3">
                  <span className="text-xs text-muted-foreground">
                    {!canApply && draftFromKey && draftToKey
                      ? t(
                          "End date must be after start date",
                          "Krajnji datum mora biti posle pocetnog",
                        )
                      : t("Choose both dates, then apply", "Izaberite oba datuma, zatim primenite")}
                  </span>
                  <Button
                    size="sm"
                    className="h-8 px-3 text-xs"
                    disabled={!canApply || disabled}
                    onClick={handleApply}
                  >
                    {t("Apply", "Primeni")}
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((preset) => (
            <Button
              key={preset}
              size="sm"
              variant={selectedPreset === preset ? "default" : "outline"}
              className="h-8 px-3 text-xs"
              disabled={disabled}
              onClick={() => handlePresetClick(preset)}
            >
              {labelForPreset(preset, t)}
            </Button>
          ))}
        </div>
        <div className="min-w-[220px] flex-1 sm:flex-none">
          <Label
            htmlFor="compare-with"
            className="text-xs uppercase tracking-wider text-muted-foreground"
          >
            {t("Compare with", "Uporedi sa")}
          </Label>
          <select
            id="compare-with"
            value={comparison}
            disabled={disabled}
            onChange={(event) => handleComparisonChange(event.target.value as ComparisonKey)}
            className="mt-1.5 h-9 w-full rounded-md border border-border/70 bg-background px-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="previous_equivalent">
              {t("Previous equivalent period", "Prethodni ekvivalentni period")}
            </option>
            <option value="previous_month">{t("Previous month", "Prethodni mesec")}</option>
            <option value="previous_year">{t("Previous year", "Prethodna godina")}</option>
            <option value="none">{t("No comparison", "Bez poredjenja")}</option>
          </select>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/70 pt-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <CalendarIcon className="h-3.5 w-3.5" />
          {t("Selected", "Izabrano")}: <span className="text-foreground">{label}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock3 className="h-3.5 w-3.5" />
          {t("Time zone", "Vremenska zona")}:{" "}
          <span className="text-foreground">Europe/Belgrade</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-positive" />
          {coverage ??
            t(
              "Data coverage is shown beside each dataset.",
              "Pokrivenost podataka je prikazana uz svaki dataset.",
            )}
        </span>
        {comparisonRange && (
          <span>
            {t("Compare", "Uporedi")}:{" "}
            <span className="text-foreground">{formatRangeLabel(comparisonRange)}</span>
          </span>
        )}
        {lastRefresh && (
          <span className="num">
            {t("Checked", "Provereno")}:{" "}
            <span className="text-foreground">{checkedTimeLabel(lastRefresh)}</span>
          </span>
        )}
        {onRefresh && (
          <Button
            size="sm"
            variant="outline"
            onClick={onRefresh}
            className="ml-auto h-8 gap-1.5"
            disabled={isRefreshing || disabled}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            {t("Refresh", "Osvezi")}
          </Button>
        )}
      </div>
    </div>
  );
}
