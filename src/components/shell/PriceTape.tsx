import { useMemo } from "react";

import { Delta } from "@/components/cea/primitives";
import { addDaysISO, belgradeDateISO } from "@/lib/date-range";
import { useLang } from "@/lib/i18n";
import { dailyStats } from "@/lib/see/analytics";
import { fmtDay, fmtPrice } from "@/lib/see/format";
import { PRICED_CODES, SEE_MARKETS, type SeeCode } from "@/lib/see/registry";
import { useSelection } from "@/lib/see/selection";
import type { Provenance } from "@/lib/see/status";
import { useSeePrices } from "@/lib/see/use-see-data";
import { cn } from "@/lib/utils";

export interface TapeEntry {
  code: SeeCode;
  /** Latest complete delivery day. */
  day: string | null;
  base: number | null;
  /** Change in baseload versus the previous complete delivery day. */
  change: number | null;
  state: Provenance | null;
}

/** Latest complete delivery day per market, independent of the selected period. */
export function useTape(): { entries: TapeEntry[]; isLoading: boolean; refetch: () => void } {
  const today = belgradeDateISO();
  const range = useMemo(() => ({ from: addDaysISO(today, -3), to: addDaysISO(today, 1) }), [today]);
  const prices = useSeePrices(PRICED_CODES, range);
  const entries = useMemo(
    () =>
      PRICED_CODES.map((code): TapeEntry => {
        const market = prices.data[code];
        if (!market) return { code, day: null, base: null, change: null, state: null };
        const days = dailyStats(market.series).filter((day) => day.complete);
        const last = days[days.length - 1];
        const prev = days[days.length - 2];
        return {
          code,
          day: last?.day ?? null,
          base: last?.base ?? null,
          change: last && prev ? last.base - prev.base : null,
          state: market.status.state,
        };
      }),
    [prices.data],
  );
  return { entries, isLoading: prices.isLoading, refetch: prices.refetch };
}

/** The always-visible regional price ribbon. Click a market to select it everywhere. */
export function PriceTape({ entries, isLoading }: { entries: TapeEntry[]; isLoading: boolean }) {
  const { t } = useLang();
  const { market, selectMarket } = useSelection();
  const latestDay = entries.reduce<string | null>(
    (max, entry) => (entry.day && (!max || entry.day > max) ? entry.day : max),
    null,
  );

  return (
    <div className="flex h-9 items-stretch border-b border-border bg-surface">
      <div
        className="flex shrink-0 flex-col justify-center border-r border-border px-3 leading-none"
        title={t(
          "Day-ahead baseload for the latest complete delivery day, change versus the previous delivery day. EUR/MWh.",
          "Day-ahead baseload za poslednji kompletan dan isporuke, promena u odnosu na prethodni dan. EUR/MWh.",
        )}
      >
        <span className="eyebrow !text-[9.5px]">{t("DA base", "DA base")} · €/MWh</span>
        <span className="num mt-0.5 text-[11px] text-ink-2">
          {latestDay ? fmtDay(latestDay) : "—"}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none]">
        {entries.map((entry) => {
          const active = market === entry.code;
          const lagging = Boolean(entry.day && latestDay && entry.day < latestDay);
          return (
            <button
              key={entry.code}
              type="button"
              onClick={() => selectMarket(active ? null : entry.code)}
              title={`${SEE_MARKETS[entry.code].name} · ${SEE_MARKETS[entry.code].exchange ?? ""}${
                entry.day ? ` · ${fmtDay(entry.day)}` : ""
              }`}
              className={cn(
                "group flex shrink-0 items-center gap-2 border-r border-border px-3 transition-colors hover:bg-surface-2",
                active && "bg-surface-2 shadow-[inset_0_-2px_0_var(--brand)]",
              )}
            >
              <span
                className={cn(
                  "font-condensed text-xs font-semibold tracking-wide",
                  active ? "text-foreground" : "text-ink-2",
                )}
              >
                {SEE_MARKETS[entry.code].short}
              </span>
              <span className={cn("num text-[13px] text-foreground", isLoading && "opacity-40")}>
                {fmtPrice(entry.base)}
              </span>
              {entry.change !== null && <Delta value={entry.change} className="text-[11px]" />}
              {lagging && (
                <span
                  className="num text-[10px] text-warning"
                  title={t("Older delivery day", "Stariji dan isporuke")}
                >
                  {fmtDay(entry.day!)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
