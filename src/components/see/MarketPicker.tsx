import { useRef } from "react";

import { useLang } from "@/lib/i18n";
import { MAX_SERIES, SERIES_VARS } from "@/lib/see/colors";
import { SEE_MARKETS, type SeeCode } from "@/lib/see/registry";
import { cn } from "@/lib/utils";

/**
 * Stable colour slot per selected market: a market keeps its colour while it stays
 * selected, and removing one never repaints the others.
 */
export function useColorSlots(selected: SeeCode[]): Record<string, string> {
  const slots = useRef(new Map<SeeCode, number>());
  for (const code of [...slots.current.keys()]) {
    if (!selected.includes(code)) slots.current.delete(code);
  }
  for (const code of selected) {
    if (slots.current.has(code)) continue;
    const used = new Set(slots.current.values());
    let slot = 0;
    while (used.has(slot) && slot < MAX_SERIES - 1) slot += 1;
    slots.current.set(code, slot);
  }
  return Object.fromEntries(
    selected.map((code) => [code, SERIES_VARS[slots.current.get(code) ?? 0]]),
  );
}

export const MARKET_SETS: Array<{ id: string; en: string; sr: string; codes: SeeCode[] }> = [
  {
    id: "core5",
    en: "RS + neighbours",
    sr: "RS + susedi",
    codes: ["RS", "HU", "RO", "BG", "HR", "ME", "MK"],
  },
  { id: "wb6", en: "WB6", sr: "ZB6", codes: ["RS", "ME", "MK", "AL", "XK"] },
  { id: "sdac", en: "SDAC SEE", sr: "SDAC JIE", codes: ["HU", "RO", "BG", "GR", "HR", "SI"] },
  {
    id: "bench",
    en: "RS vs benchmarks",
    sr: "RS i reperi",
    codes: ["RS", "HU", "AT", "IT_NORD", "GR"],
  },
];

/** Chip multi-select for markets, capped at the number of colours a chart can carry. */
export function MarketPicker({
  options,
  selected,
  onChange,
  colors,
}: {
  options: SeeCode[];
  selected: SeeCode[];
  onChange: (next: SeeCode[]) => void;
  colors: Record<string, string>;
}) {
  const { t, lang } = useLang();
  const full = selected.length >= MAX_SERIES;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {options.map((code) => {
        const on = selected.includes(code);
        const market = SEE_MARKETS[code];
        return (
          <button
            key={code}
            type="button"
            aria-pressed={on}
            disabled={!on && full}
            title={`${lang === "sr" ? market.nameSr : market.name} · ${market.exchange ?? ""}${
              !on && full
                ? ` — ${t("maximum 8 series per chart", "najviše 8 serija po grafikonu")}`
                : ""
            }`}
            onClick={() =>
              onChange(on ? selected.filter((item) => item !== code) : [...selected, code])
            }
            className={cn(
              "inline-flex h-6 items-center gap-1.5 rounded-sm border px-2 font-condensed text-xs font-semibold tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-35",
              on
                ? "border-border-strong bg-surface-2 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            <span
              aria-hidden
              className="h-2 w-2 rounded-[2px]"
              style={{ background: on ? colors[code] : "var(--border-strong)" }}
            />
            {market.short}
          </button>
        );
      })}
      <span className="mx-1 h-4 w-px bg-border" aria-hidden />
      {MARKET_SETS.map((set) => (
        <button
          key={set.id}
          type="button"
          onClick={() => onChange(set.codes.filter((code) => options.includes(code)))}
          className="h-6 rounded-sm px-1.5 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {lang === "sr" ? set.sr : set.en}
        </button>
      ))}
    </div>
  );
}
