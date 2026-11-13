import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { HeatGrid } from "@/components/cea/charts";
import { DataState, Panel, ProvenanceBadge } from "@/components/cea/primitives";
import { FocusControl } from "@/components/see/FocusControl";
import { BorderInspector, MarketInspector, RegionBrief } from "@/components/see/Inspector";
import { LAYERS, buildLayer, type LayerId } from "@/components/see/layers";
import { SeeMap } from "@/components/see/SeeMap";
import { useDateRange } from "@/lib/date-range";
import { useLang } from "@/lib/i18n";
import { hourProfile } from "@/lib/see/analytics";
import { divergingColor } from "@/lib/see/colors";
import { fmt, fmtMW, fmtPrice, fmtShare, fmtSigned } from "@/lib/see/format";
import { daysBetween, type Focus } from "@/lib/see/region";
import {
  CORE_CODES,
  PRICED_CODES,
  SEE_BORDERS,
  SEE_MARKETS,
  type SeeCode,
} from "@/lib/see/registry";
import { useSelection } from "@/lib/see/selection";
import { worstState, type Provenance } from "@/lib/see/status";
import { useRegion } from "@/lib/see/use-region";
import { useSeeCapacity, useSeeFundamentalsMany } from "@/lib/see/use-see-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/")({
  component: CommandCenter,
});

const EXPLICIT_IDS = SEE_BORDERS.filter((border) => border.allocation === "explicit").map(
  (border) => border.id,
);
const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));

function CommandCenter() {
  const { t, lang } = useLang();
  const { range } = useDateRange();
  const { market, border, selectMarket, selectBorder } = useSelection();
  const [layer, setLayer] = useState<LayerId>("price");
  const days = useMemo(() => daysBetween(range.from, range.to), [range.from, range.to]);
  const [focus, setFocus] = useState<Focus>({ mode: "day", day: days[days.length - 1] });

  // Keep the focus day inside the period when the period changes.
  useEffect(() => {
    setFocus((current) =>
      current.mode === "day" && !days.includes(current.day)
        ? { mode: "day", day: days[days.length - 1] }
        : current,
    );
  }, [days]);

  const { region, prices, physical, scheduled, ntc } = useRegion(focus, {
    scheduled: layer === "scheduled",
    ntc: layer === "utilisation" || border !== null,
  });

  // The latest delivery day is often tomorrow's, which may not be published yet:
  // fall back once to the newest day that has prices.
  const [autoFocused, setAutoFocused] = useState(false);
  useEffect(() => {
    if (autoFocused || prices.isLoading || focus.mode !== "day") return;
    const hasPrices = PRICED_CODES.some((code) => region.markets[code].stats.hours > 0);
    if (hasPrices) {
      setAutoFocused(true);
      return;
    }
    const index = days.indexOf(focus.day);
    if (index > 0) setFocus({ mode: "day", day: days[index - 1] });
    else setAutoFocused(true);
  }, [autoFocused, prices.isLoading, focus, region, days]);
  useEffect(() => setAutoFocused(false), [range.from, range.to]);

  const selectedExplicit = border !== null && EXPLICIT_IDS.includes(border);
  const capacityIds = layer === "capacity" ? EXPLICIT_IDS : selectedExplicit ? [border!] : [];
  const capacity = useSeeCapacity(capacityIds, capacityIds.length > 0);
  const fundamentals = useSeeFundamentalsMany(CORE_CODES, layer === "mix");

  const view = useMemo(
    () => buildLayer(layer, region, { capacity: capacity.data, fundamentals: fundamentals.data }),
    [layer, region, capacity.data, fundamentals.data],
  );

  const layerLoading =
    (layer === "price" || layer === "spread" ? prices.isLoading : false) ||
    (layer === "flow" || layer === "utilisation" ? physical.isLoading : false) ||
    (layer === "scheduled" && scheduled.isLoading) ||
    (layer === "utilisation" && ntc.isLoading) ||
    (layer === "capacity" && capacity.isLoading) ||
    (layer === "mix" && fundamentals.isLoading);

  const layerState: Provenance | null = useMemo(() => {
    const priceStates = PRICED_CODES.map((code) => region.markets[code].status?.state).filter(
      Boolean,
    ) as Provenance[];
    const flowStates = Object.values(region.borders)
      .flatMap((b) => [b.statusAB?.state, b.statusBA?.state])
      .filter(Boolean) as Provenance[];
    return worstState(layer === "flow" || layer === "utilisation" ? flowStates : priceStates);
  }, [region, layer]);

  const layerEmpty =
    !layerLoading &&
    Object.values(view.nodes).every((node) => !node || node.empty) &&
    Object.values(view.links).every((link) => link.empty);

  // Hour-of-day profile per market, coloured against the mean of the whole grid.
  const heat = useMemo(() => {
    const profiles = PRICED_CODES.map((code) => ({
      code,
      profile: hourProfile(region.markets[code].series),
    }));
    const all = profiles.flatMap((row) =>
      row.profile.filter((value): value is number => value !== null),
    );
    const centre = all.length ? all.reduce((sum, value) => sum + value, 0) / all.length : null;
    const span = all.length
      ? Math.max(15, ...all.map((value) => Math.abs(value - (centre ?? 0)))) * 0.8
      : 1;
    return { profiles, centre, span };
  }, [region]);

  const describeMarket = (code: SeeCode) => {
    const info = SEE_MARKETS[code];
    const m = region.markets[code];
    return (
      <div className="grid gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-foreground">
            {lang === "sr" ? info.nameSr : info.name}
          </span>
          <span className="text-muted-foreground">{info.exchange ?? "—"}</span>
        </div>
        {info.price === null ? (
          <span className="text-muted-foreground">
            {t("No day-ahead price", "Nema day-ahead cene")}
          </span>
        ) : (
          <div className="num grid grid-cols-2 gap-x-3 text-ink-2">
            <span>Base {fmtPrice(m.stats.base)}</span>
            <span>Peak {fmtPrice(m.stats.peak)}</span>
            <span>Min {fmt(m.stats.min, 1)}</span>
            <span>Max {fmt(m.stats.max, 1)}</span>
          </div>
        )}
        <span className="num text-ink-2">
          {t("Net position", "Neto pozicija")}:{" "}
          {m.netImport === null
            ? `— (${m.bordersCovered}/${m.bordersTotal} ${t("borders", "granica")})`
            : `${fmtSigned(m.netImport, 0)} MW`}
        </span>
      </div>
    );
  };

  const describeBorder = (id: string) => {
    const b = region.borders[id];
    const a = SEE_MARKETS[b.border.a].short;
    const z = SEE_MARKETS[b.border.b].short;
    const net = b.flow.meanNet;
    return (
      <div className="grid gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-foreground">
            {a} ⇄ {z}
          </span>
          <span className="text-muted-foreground">
            {b.border.allocation === "implicit"
              ? t("coupled", "spojeno")
              : t("explicit", "eksplicitno")}
            {b.border.link === "HVDC" ? " · HVDC" : ""}
          </span>
        </div>
        <span className="num text-ink-2">
          {t("Physical", "Fizički")}:{" "}
          {net === null
            ? "—"
            : `${net >= 0 ? `${a}→${z}` : `${z}→${a}`} ${fmtMW(Math.abs(net))} MW`}
        </span>
        {b.scheduled.meanNet !== null && (
          <span className="num text-ink-2">
            {t("Scheduled", "Planirano")}:{" "}
            {`${b.scheduled.meanNet >= 0 ? `${a}→${z}` : `${z}→${a}`} ${fmtMW(Math.abs(b.scheduled.meanNet))} MW`}
          </span>
        )}
        <span className="num text-ink-2">
          Spread {z}−{a}: {fmtSigned(b.spreadStats.mean, 1)} €/MWh
        </span>
        {b.meanUtilisation !== null && (
          <span className="num text-ink-2">
            {t("Utilisation", "Iskorišćenost")}: {fmtShare(b.meanUtilisation)}
          </span>
        )}
      </div>
    );
  };

  const activeLayer = LAYERS.find((item) => item.id === layer)!;

  return (
    <div className="grid gap-2 p-2 xl:h-full xl:grid-cols-[minmax(0,1fr)_440px] xl:grid-rows-[minmax(0,1fr)_auto]">
      <Panel
        flush
        className="min-h-[520px] xl:row-span-2 xl:min-h-0"
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-foreground">
              {lang === "sr" ? activeLayer.titleSr : activeLayer.titleEn}
            </span>
          </span>
        }
        subtitle={`${t("Node", "Čvor")}: ${view.nodeMeaning[lang]}`}
        status={<ProvenanceBadge state={layerLoading ? null : layerState} />}
        actions={<FocusControl focus={focus} days={days} onChange={setFocus} />}
        bodyClassName="flex flex-col"
      >
        <div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-1.5 [scrollbar-width:none]">
          {LAYERS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={layer === item.id}
              title={lang === "sr" ? item.titleSr : item.titleEn}
              onClick={() => setLayer(item.id)}
              className={cn(
                "h-6 shrink-0 rounded-sm border px-2.5 font-condensed text-xs font-medium tracking-wide transition-colors",
                layer === item.id
                  ? "border-brand bg-brand/10 text-foreground"
                  : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
              )}
            >
              {lang === "sr" ? item.sr : item.en}
            </button>
          ))}
        </div>
        <div className="relative min-h-0 flex-1">
          <SeeMap
            nodes={view.nodes}
            links={view.links}
            countryFill={view.countryFill}
            selectedMarket={market}
            selectedBorder={border}
            onSelectMarket={selectMarket}
            onSelectBorder={selectBorder}
            describeMarket={describeMarket}
            describeBorder={describeBorder}
          />
          {(layerLoading || layerEmpty) && (
            <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
              <div className="pointer-events-auto rounded-sm border border-border-strong bg-popover/95 shadow-pop">
                <DataState
                  loading={layerLoading}
                  state={layerState ?? "empty"}
                  reason={
                    PRICED_CODES.map((code) => region.markets[code].status?.reason).find(Boolean) ??
                    undefined
                  }
                  height={64}
                  compact
                >
                  {layer === "capacity" && layerState !== "unavailable"
                    ? t(
                        "No daily explicit auction results were published for this day.",
                        "Nema objavljenih rezultata dnevnih eksplicitnih aukcija za ovaj dan.",
                      )
                    : layer === "utilisation" && layerState !== "unavailable"
                      ? t(
                          "No day-ahead NTC was published for these borders, so utilisation cannot be rated.",
                          "Day-ahead NTC nije objavljen za ove granice, pa iskorišćenost ne može biti ocenjena.",
                        )
                      : undefined}
                </DataState>
              </div>
            </div>
          )}
        </div>
        <p className="border-t border-border px-3 py-1.5 text-[11px] leading-snug text-muted-foreground">
          {view.legend[lang]}
          {physical.clipped &&
          (layer === "flow" || layer === "utilisation" || layer === "scheduled")
            ? ` ${t("Flows are loaded for the last 62 days of the period.", "Tokovi su učitani za poslednja 62 dana perioda.")}`
            : ""}
        </p>
      </Panel>

      <div className="min-h-[420px] xl:min-h-0">
        {border ? (
          <BorderInspector
            id={border}
            region={region}
            capacity={capacity.data[border]}
            capacityDay={capacity.day}
          />
        ) : market ? (
          <MarketInspector code={market} region={region} />
        ) : (
          <RegionBrief region={region} loading={prices.isLoading} />
        )}
      </div>

      <Panel
        title={t("Hourly price map", "Satna mapa cena")}
        subtitle={
          focus.mode === "day"
            ? t("Day-ahead price by hour, market time", "Day-ahead cena po satu, tržišno vreme")
            : t(
                "Mean day-ahead price by hour of day over the period",
                "Prosečna day-ahead cena po satu dana u periodu",
              )
        }
        bodyClassName="!px-2.5 !pb-1 !pt-2"
      >
        {heat.centre === null ? (
          <DataState
            loading={prices.isLoading}
            state={layerState ?? "empty"}
            height={120}
            compact
          />
        ) : (
          <HeatGrid
            columns={HOURS}
            compact
            cellHeight={13}
            rowHeader=""
            summaryHeader="Base"
            activeRow={market}
            onRowClick={(id) => selectMarket(market === id ? null : (id as SeeCode))}
            rows={heat.profiles.map(({ code, profile }) => ({
              id: code,
              label: SEE_MARKETS[code].short,
              title: SEE_MARKETS[code].name,
              summary: fmtPrice(region.markets[code].stats.base),
              cells: profile.map((value) => ({
                value,
                color: divergingColor(value, heat.centre, heat.span),
              })),
            }))}
            describe={(rowId, column, value) =>
              `${SEE_MARKETS[rowId as SeeCode].name} · ${HOURS[column]}:00–${String(column + 1).padStart(2, "0")}:00 · ${
                value === null ? t("no observation", "nema podatka") : `${fmtPrice(value)} €/MWh`
              } · ${t("grid mean", "prosek mape")} ${fmtPrice(heat.centre)}`
            }
          />
        )}
      </Panel>
    </div>
  );
}
