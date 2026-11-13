import { useState } from "react";
import { CalendarRange } from "lucide-react";

import { useDashboardRange, type PresetKey } from "@/components/dashboard/DateRangeControl";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { addDaysISO, belgradeDateISO } from "@/lib/date-range";
import { useLang } from "@/lib/i18n";
import { fmtDay } from "@/lib/see/format";
import { cn } from "@/lib/utils";

const PRESETS: Array<{ key: PresetKey; en: string; sr: string; titleEn: string; titleSr: string }> =
  [
    {
      key: "d1",
      en: "D+1",
      sr: "D+1",
      titleEn: "Tomorrow's delivery day",
      titleSr: "Sutrašnji dan isporuke",
    },
    {
      key: "today",
      en: "Today",
      sr: "Danas",
      titleEn: "Today's delivery day",
      titleSr: "Današnji dan isporuke",
    },
    { key: "7d", en: "7D", sr: "7D", titleEn: "Last 7 days", titleSr: "Poslednjih 7 dana" },
    { key: "30d", en: "30D", sr: "30D", titleEn: "Last 30 days", titleSr: "Poslednjih 30 dana" },
    { key: "mtd", en: "MTD", sr: "MTD", titleEn: "Month to date", titleSr: "Od početka meseca" },
    {
      key: "prev_month",
      en: "Prev M",
      sr: "Preth. M",
      titleEn: "Previous month",
      titleSr: "Prethodni mesec",
    },
    { key: "ytd", en: "YTD", sr: "YTD", titleEn: "Year to date", titleSr: "Od početka godine" },
  ];

/** Persistent delivery-period selector. State lives in the URL (preset / from / to). */
export function PeriodControl() {
  const { t, lang } = useLang();
  const { preset, rangeKeys, setPreset, setRangeKeys } = useDashboardRange({});
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(rangeKeys.from);
  const [to, setTo] = useState(rangeKeys.to);
  const maxDay = addDaysISO(belgradeDateISO(), 1);
  const valid = Boolean(from && to && from <= to && to <= maxDay);

  const label =
    rangeKeys.from === rangeKeys.to
      ? fmtDay(rangeKeys.from)
      : `${fmtDay(rangeKeys.from)} – ${fmtDay(rangeKeys.to)}`;

  return (
    <div className="flex items-center gap-1.5">
      <div
        role="radiogroup"
        aria-label={t("Delivery period", "Period isporuke")}
        className="hidden rounded-sm border border-border bg-background p-0.5 lg:inline-flex"
      >
        {PRESETS.map((item) => {
          const active = preset === item.key;
          return (
            <button
              key={item.key}
              type="button"
              role="radio"
              aria-checked={active}
              title={lang === "sr" ? item.titleSr : item.titleEn}
              onClick={() => setPreset(item.key)}
              className={cn(
                "h-6 rounded-[3px] px-2 font-condensed text-xs font-medium tracking-wide transition-colors",
                active
                  ? "bg-surface-2 text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {lang === "sr" ? item.sr : item.en}
            </button>
          );
        })}
      </div>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setFrom(rangeKeys.from);
            setTo(rangeKeys.to);
          }
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "num inline-flex h-7 items-center gap-1.5 rounded-sm border border-border bg-background px-2 text-xs text-ink-2 transition-colors hover:border-border-strong hover:text-foreground",
              preset === "custom" && "border-border-strong text-foreground",
            )}
            title={t(
              "Delivery period, market time (CET/CEST)",
              "Period isporuke, tržišno vreme (CET/CEST)",
            )}
          >
            <CalendarRange className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="hidden sm:inline">{label}</span>
            <span className="sm:hidden">
              {PRESETS.find((item) => item.key === preset)?.[lang === "sr" ? "sr" : "en"] ?? "···"}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 space-y-3 p-3">
          <div className="grid grid-cols-4 gap-1 lg:hidden">
            {PRESETS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setPreset(item.key);
                  setOpen(false);
                }}
                className={cn(
                  "h-7 rounded-sm border border-border font-condensed text-xs",
                  preset === item.key ? "bg-surface-2 text-foreground" : "text-muted-foreground",
                )}
              >
                {lang === "sr" ? item.sr : item.en}
              </button>
            ))}
          </div>
          <div className="eyebrow">{t("Custom delivery period", "Prilagođeni period")}</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-[11px] text-muted-foreground">
              {t("From", "Od")}
              <input
                type="date"
                value={from}
                max={to || maxDay}
                onChange={(event) => setFrom(event.target.value)}
                className="num h-8 w-full rounded-sm border border-input bg-background px-2 text-xs text-foreground"
              />
            </label>
            <label className="space-y-1 text-[11px] text-muted-foreground">
              {t("To", "Do")}
              <input
                type="date"
                value={to}
                min={from}
                max={maxDay}
                onChange={(event) => setTo(event.target.value)}
                className="num h-8 w-full rounded-sm border border-input bg-background px-2 text-xs text-foreground"
              />
            </label>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            {t(
              "Delivery days in market time (CET/CEST). Day-ahead data ends at tomorrow's delivery day.",
              "Dani isporuke u tržišnom vremenu (CET/CEST). Day-ahead podaci se završavaju sutrašnjim danom.",
            )}
          </p>
          <button
            type="button"
            disabled={!valid}
            onClick={() => {
              setRangeKeys({ from, to });
              setOpen(false);
            }}
            className="h-8 w-full rounded-sm bg-primary text-xs font-semibold text-primary-foreground transition-opacity disabled:opacity-40"
          >
            {t("Apply", "Primeni")}
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
