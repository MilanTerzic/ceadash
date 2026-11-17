import { useEffect, useMemo, useRef } from "react";

import { Segmented } from "@/components/cea/primitives";
import { useLang } from "@/lib/i18n";
import type { BaseCell } from "@/lib/see/analytics";
import { divergingColor } from "@/lib/see/colors";
import { fmt, fmtDay, fmtPrice } from "@/lib/see/format";
import { SEE_MARKETS, type SeeCode } from "@/lib/see/registry";
import { cn } from "@/lib/utils";

export type TableColour = "level" | "daily";

const weekday = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

/**
 * Day-ahead baseload per market and delivery day as a heat map.
 *
 * Colour is the day-ahead baseload against a reference: the mean of the whole grid
 * ("level", so a dear week reads red) or the mean of that day's markets ("daily", so the
 * cheap and dear markets of each day stand out). A missing value is a hatched dash, never
 * zero; a day with missing hours shows its mean marked with an asterisk.
 */
export function DailyBaseTable({
  rows,
  days,
  colour,
  onColourChange,
  selectedMarket,
  onSelectMarket,
  focusDay,
  today,
  tomorrow,
}: {
  rows: Array<{ code: SeeCode; cells: BaseCell[] }>;
  days: string[];
  colour: TableColour;
  onColourChange: (colour: TableColour) => void;
  selectedMarket: SeeCode | null;
  onSelectMarket: (code: SeeCode | null) => void;
  /** Highlighted column: the day shown on the map. */
  focusDay: string | null;
  today: string;
  tomorrow: string;
}) {
  const { t } = useLang();
  // On narrow screens the newest days are the ones that matter, so start scrolled to them.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [days]);

  const model = useMemo(() => {
    const all: number[] = [];
    const byDay = days.map((_, column) => {
      // Means use full days only, so a half-published day cannot skew the reference.
      const values = rows
        .map((row) => (row.cells[column].complete ? row.cells[column].base : null))
        .filter((value): value is number => value !== null);
      all.push(...values);
      return values;
    });
    const gridMean = average(all);
    const dayMeans = byDay.map(average);
    const reference = (column: number) => (colour === "level" ? gridMean : dayMeans[column]);
    let widest = 0;
    rows.forEach((row) =>
      row.cells.forEach((cell, column) => {
        const ref = reference(column);
        if (cell.base !== null && ref !== null)
          widest = Math.max(widest, Math.abs(cell.base - ref));
      }),
    );
    const span = Math.max(15, widest * 0.8);
    return { gridMean, dayMeans, span, reference };
  }, [rows, days, colour]);

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 pb-2 pt-2.5">
        <Segmented
          size="xs"
          ariaLabel={t("Colour scale", "Skala boja")}
          value={colour}
          onChange={onColourChange}
          options={[
            {
              value: "level",
              label: t("Price level", "Nivo cene"),
              title: t(
                "Colour against the mean of the whole table, so dear days read red",
                "Boja prema proseku cele tabele, pa skuplji dani izgledaju crveno",
              ),
            },
            {
              value: "daily",
              label: t("Vs day mean", "Prema proseku dana"),
              title: t(
                "Colour against the mean of that day's markets, so the dearest and cheapest markets of each day stand out",
                "Boja prema proseku tržišta tog dana, pa se najskuplja i najjeftinija tržišta dana ističu",
              ),
            },
          ]}
        />
        <span className="text-[11px] text-muted-foreground">
          {colour === "level"
            ? t(
                `Blue is cheaper and red dearer than the table mean (${fmtPrice(model.gridMean)} €/MWh).`,
                `Plavo je jeftinije, a crveno skuplje od proseka tabele (${fmtPrice(model.gridMean)} €/MWh).`,
              )
            : t(
                "Blue is cheaper and red dearer than the mean of the markets on that day.",
                "Plavo je jeftinije, a crveno skuplje od proseka tržišta tog dana.",
              )}
        </span>
      </div>

      <div ref={scroller} className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-separate border-spacing-px text-center">
          <caption className="sr-only">
            {t(
              "Day-ahead baseload price, EUR per MWh, by market and delivery day",
              "Day-ahead baseload cena, EUR po MWh, po tržištu i danu isporuke",
            )}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 w-14 bg-surface text-left" />
              {days.map((day) => {
                const isFocus = day === focusDay;
                return (
                  <th
                    key={day}
                    scope="col"
                    className={cn(
                      "px-0.5 pb-1 font-normal leading-tight",
                      isFocus ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <span className="block text-[9.5px] uppercase tracking-wider">
                      {day === tomorrow
                        ? "D+1"
                        : day === today
                          ? t("Today", "Danas")
                          : weekday(day)}
                    </span>
                    <span className={cn("num block text-[11px]", isFocus && "font-semibold")}>
                      {fmtDay(day)}
                    </span>
                  </th>
                );
              })}
              <th
                scope="col"
                className="w-14 pb-1 text-right text-[9.5px] font-normal uppercase tracking-wider text-muted-foreground"
              >
                {t("Avg", "Prosek")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const info = SEE_MARKETS[row.code];
              const selected = selectedMarket === row.code;
              const complete = row.cells
                .filter((cell) => cell.complete && cell.base !== null)
                .map((cell) => cell.base as number);
              return (
                <tr key={row.code}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-surface pr-1 text-left font-normal"
                  >
                    <button
                      type="button"
                      title={info.name}
                      aria-pressed={selected}
                      onClick={() => onSelectMarket(selected ? null : row.code)}
                      className={cn(
                        "h-[22px] w-full truncate text-left font-condensed text-xs font-semibold tracking-wide transition-colors",
                        selected ? "text-brand" : "text-ink-2 hover:text-foreground",
                      )}
                    >
                      {info.short}
                    </button>
                  </th>
                  {row.cells.map((cell, column) => {
                    const ref = model.reference(column);
                    const partial = cell.base !== null && !cell.complete;
                    return (
                      <td
                        key={cell.day}
                        title={
                          cell.base === null
                            ? `${info.name} · ${fmtDay(cell.day)} · ${t("not published", "nije objavljeno")}`
                            : `${info.name} · ${fmtDay(cell.day)} · ${fmtPrice(cell.base)} €/MWh${
                                partial
                                  ? ` · ${t("only", "samo")} ${cell.hours}/${cell.expected} ${t("hours", "sati")}`
                                  : ""
                              }`
                        }
                        className={cn(
                          "num h-[22px] rounded-[2px] px-0.5 text-[11px] text-foreground",
                          cell.day === focusDay &&
                            "outline outline-1 -outline-offset-1 outline-foreground/60",
                          cell.base === null &&
                            "bg-[repeating-linear-gradient(135deg,transparent,transparent_3px,var(--border)_3px,var(--border)_4px)] text-muted-foreground",
                          partial && "italic",
                        )}
                        style={
                          cell.base === null
                            ? undefined
                            : { background: divergingColor(cell.base, ref, model.span) }
                        }
                      >
                        {cell.base === null ? "—" : `${fmt(cell.base, 1)}${partial ? "*" : ""}`}
                      </td>
                    );
                  })}
                  <td className="num pl-1 text-right text-[11px] text-ink-2">
                    {complete.length ? fmt(average(complete), 1) : "—"}
                  </td>
                </tr>
              );
            })}
            <tr>
              <th
                scope="row"
                className="sticky left-0 z-10 bg-surface pr-1 pt-1 text-left font-normal"
              >
                <span className="eyebrow !text-[9.5px]">{t("Mean", "Prosek")}</span>
              </th>
              {model.dayMeans.map((value, column) => (
                <td key={days[column]} className="num pt-1 text-[11px] text-ink-2">
                  {value === null ? "—" : fmt(value, 1)}
                </td>
              ))}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
