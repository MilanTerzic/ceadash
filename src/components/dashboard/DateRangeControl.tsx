import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";
import { belgradeDayKey } from "@/lib/baseload";

export type PresetKey = "7d" | "30d" | "mtd" | "prev_month" | "ytd" | "custom";

function presetRange(preset: PresetKey, latest: Date): { from: Date; to: Date } {
  const to = new Date(latest);
  const from = new Date(latest);
  switch (preset) {
    case "7d":
      from.setDate(to.getDate() - 6);
      return { from, to };
    case "30d":
      from.setDate(to.getDate() - 29);
      return { from, to };
    case "mtd":
      return { from: new Date(to.getFullYear(), to.getMonth(), 1), to };
    case "prev_month": {
      const f = new Date(to.getFullYear(), to.getMonth() - 1, 1);
      const t = new Date(to.getFullYear(), to.getMonth(), 0);
      return { from: f, to: t };
    }
    case "ytd":
      return { from: new Date(to.getFullYear(), 0, 1), to };
    default:
      return { from, to };
  }
}

/** Resolve the requested analysis-period start (Belgrade YYYY-MM-DD) from URL
 *  search params, independent of what data is already cached. Used to drive
 *  server-side backfill so KPIs/charts cover the full chosen period. */
export function useRequestedFromKey(): string {
  const search = useSearch({ strict: false }) as { from?: string; to?: string; preset?: PresetKey };
  const preset: PresetKey = search.preset ?? "30d";
  const now = new Date();
  let from: Date;
  if (preset === "custom") {
    from = search.from ? new Date(search.from) : presetRange("30d", now).from;
  } else {
    from = presetRange(preset, now).from;
  }
  // Format as Belgrade YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(from);
}

export function useDashboardRange(opts: { firstAvailable?: Date; latestAvailable?: Date }) {
  const search = useSearch({ strict: false }) as { from?: string; to?: string; preset?: PresetKey };
  const navigate = useNavigate();

  const latest = opts.latestAvailable ?? new Date();
  const preset: PresetKey = search.preset ?? "30d";

  const range = useMemo<{ from: Date; to: Date } | undefined>(() => {
    if (preset !== "custom") {
      return presetRange(preset, latest);
    }
    if (search.from && search.to) {
      return { from: new Date(search.from), to: new Date(search.to) };
    }
    return presetRange("30d", latest);
  }, [preset, search.from, search.to, latest]);

  const setPreset = (p: PresetKey) => {
    navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({ ...prev, preset: p, from: undefined, to: undefined }),
      replace: true,
    });
  };

  return {
    preset,
    range,
    fromKey: range ? belgradeDayKey(range.from) : undefined,
    toKey: range ? belgradeDayKey(range.to) : undefined,
    setPreset,
    firstAvailable: opts.firstAvailable,
    latestAvailable: opts.latestAvailable,
  };
}

export function DateRangeControl({
  firstAvailable,
  latestAvailable,
}: {
  firstAvailable?: Date;
  latestAvailable?: Date;
}) {
  const { t } = useLang();
  const navigate = useNavigate();
  const { preset, range, setPreset } = useDashboardRange({ firstAvailable, latestAvailable });

  const [open, setOpen] = useState(false);
  const [draftRange, setDraftRange] = useState<DateRange | undefined>(range);
  const [selectingEnd, setSelectingEnd] = useState(false);

  useEffect(() => {
    setDraftRange(range);
  }, [range]);

  const presets: { key: PresetKey; label: string }[] = [
    { key: "7d", label: t("Last 7d", "7 dana") },
    { key: "30d", label: t("Last 30d", "30 dana") },
    { key: "mtd", label: t("MTD", "Tek. mesec") },
    { key: "prev_month", label: t("Prev. month", "Pret. mesec") },
    { key: "ytd", label: t("YTD", "YTD") },
  ];

  const label = range
    ? belgradeDayKey(range.from) === belgradeDayKey(range.to)
      ? format(range.from, "d MMM yyyy")
      : `${format(range.from, "d MMM yyyy")} – ${format(range.to, "d MMM yyyy")}`
    : t("Pick a range", "Izaberi opseg");

  const disabledMatcher = useMemo(() => {
    const today = new Date();
    const minDate = new Date(today.getFullYear() - 5, today.getMonth(), today.getDate());
    return { before: minDate, after: today };
  }, []);

  const applyRange = (from: Date, to: Date) => {
    navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        preset: "custom",
        from: belgradeDayKey(from),
        to: belgradeDayKey(to),
      }),
      replace: true,
    });
  };

  const handleDayClick = (day: Date) => {
    if (!selectingEnd || !draftRange?.from || draftRange.to) {
      setDraftRange({ from: day, to: undefined });
      setSelectingEnd(true);
      return;
    }

    if (day < draftRange.from) {
      setDraftRange({ from: day, to: undefined });
      return;
    }

    const next = { from: draftRange.from, to: day };
    setDraftRange(next);
    setSelectingEnd(false);
    applyRange(next.from, next.to);
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      setSelectingEnd(false);
      return;
    }
    if (!isOpen) {
      setDraftRange(range);
      setSelectingEnd(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("Analysis period", "Period analize")}
          </Label>
          <Popover open={open} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "mt-1.5 w-[280px] justify-start text-left font-normal",
                  !range && "text-muted-foreground",
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {label}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto max-w-[calc(100vw-2rem)] p-0" align="start">
              <div className={cn("pointer-events-auto max-h-[calc(100vh-7rem)] overflow-auto p-3")}>
                <Calendar
                  mode="range"
                  selected={draftRange}
                  onDayClick={handleDayClick}
                  defaultMonth={draftRange?.from ?? range?.from}
                  disabled={disabledMatcher}
                  numberOfMonths={2}
                  initialFocus
                  className="p-0"
                />
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/70 pt-3 text-xs text-muted-foreground">
                  <span>
                    {selectingEnd && draftRange?.from
                      ? `${format(draftRange.from, "d MMM yyyy")} – ${t("select end date", "izaberite krajnji datum")}`
                      : draftRange?.from
                        ? draftRange.to
                          ? `${format(draftRange.from, "d MMM yyyy")} – ${format(draftRange.to, "d MMM yyyy")}`
                          : t("Select end date", "Izaberite krajnji datum")
                      : t("Select start date", "Izaberite početni datum")}
                  </span>
                  <Button size="sm" variant="outline" className="h-8 px-3 text-xs" onClick={() => setOpen(false)}>
                    {t("Done", "Gotovo")}
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <Button
              key={p.key}
              size="sm"
              variant={preset === p.key ? "default" : "outline"}
              className="h-8 px-3 text-xs"
              onClick={() => setPreset(p.key)}
            >
              {p.label}
            </Button>
          ))}
          <Button
            size="sm"
            variant={preset === "custom" ? "default" : "outline"}
            className="h-8 px-3 text-xs"
            onClick={() => {
              setPreset("custom");
              setOpen(true);
            }}
          >
            {t("Custom", "Prilagođeno")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground max-w-md">
          {t(
            "All KPIs, charts and the Weekly Update use this range. Time zone: Europe/Belgrade.",
            "Svi KPI, grafici i nedeljni izveštaj koriste ovaj opseg. Vremenska zona: Europe/Belgrade.",
          )}
        </p>
      </div>
    </div>
  );
}
