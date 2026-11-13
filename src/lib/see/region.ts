// Derived regional view: per-market and per-border figures for a focus window, plus the
// rule-based signals shown on the Command Center. Pure, so it is unit-tested.
import {
  EMPTY_SERIES,
  flowSpreadAlignment,
  flowStats,
  marketTime,
  mean,
  netFlow,
  priceStats,
  spreadSeries,
  spreadStats,
  utilisation,
  type FlowSpreadAlignment,
  type FlowStats,
  type PriceStats,
  type Series,
  type SpreadStats,
} from "./analytics";
import {
  SEE_BORDERS,
  SEE_CODES,
  SEE_MARKETS,
  bordersOf,
  type SeeBorder,
  type SeeCode,
} from "./registry";
import type { SeriesStatus } from "./status";

/** Either the whole loaded period or one market-time delivery day. */
export type Focus = { mode: "period" } | { mode: "day"; day: string };

export function focusSeries(series: Series, focus: Focus): Series {
  if (focus.mode === "period") return series;
  const out: Series = { t: [], v: [] };
  for (let i = 0; i < series.t.length; i++) {
    if (marketTime(series.t[i]).day === focus.day) {
      out.t.push(series.t[i]);
      out.v.push(series.v[i]);
    }
  }
  return out;
}

export interface PriceInput {
  series: Series;
  status: SeriesStatus;
}
export interface DirectionalInput {
  ab: Series;
  ba: Series;
  statusAB: SeriesStatus;
  statusBA: SeriesStatus;
}

export interface MarketView {
  code: SeeCode;
  series: Series;
  stats: PriceStats;
  status: SeriesStatus | null;
  /** Mean net import over the focus window (MW); null unless every border is covered. */
  netImport: number | null;
  bordersCovered: number;
  bordersTotal: number;
}

export interface BorderView {
  border: SeeBorder;
  /** Physical net flow a -> b. */
  net: Series;
  flow: FlowStats;
  /** Scheduled commercial net exchange a -> b, when loaded. */
  scheduledNet: Series;
  scheduled: FlowStats;
  /** Price of b minus price of a; empty when either side has no price. */
  spread: Series;
  spreadStats: SpreadStats;
  alignment: FlowSpreadAlignment;
  /** Hourly |net flow| / NTC of the flow direction, when NTC is loaded. */
  utilisation: Series;
  meanUtilisation: number | null;
  statusAB: SeriesStatus | null;
  statusBA: SeriesStatus | null;
}

export interface Region {
  focus: Focus;
  markets: Record<SeeCode, MarketView>;
  borders: Record<string, BorderView>;
  /** Unweighted mean baseload of the core markets that have a price. */
  regionalBase: number | null;
  /** Largest absolute deviation of a core market's baseload from the regional mean. */
  baseSpan: number;
}

export function buildRegion(input: {
  prices: Partial<Record<SeeCode, PriceInput>>;
  physical: Record<string, DirectionalInput>;
  scheduled?: Record<string, DirectionalInput>;
  ntc?: Record<string, DirectionalInput>;
  focus: Focus;
}): Region {
  const { focus } = input;
  const priceSeries = {} as Record<SeeCode, Series>;
  for (const code of SEE_CODES) {
    priceSeries[code] = focusSeries(input.prices[code]?.series ?? EMPTY_SERIES, focus);
  }

  const borders: Record<string, BorderView> = {};
  for (const border of SEE_BORDERS) {
    const physical = input.physical[border.id];
    const net = physical
      ? netFlow(focusSeries(physical.ab, focus), focusSeries(physical.ba, focus))
      : EMPTY_SERIES;
    const sched = input.scheduled?.[border.id];
    const scheduledNet = sched
      ? netFlow(focusSeries(sched.ab, focus), focusSeries(sched.ba, focus))
      : EMPTY_SERIES;
    const spread = spreadSeries(priceSeries[border.a], priceSeries[border.b]);
    const ntc = input.ntc?.[border.id];
    const util = ntc
      ? utilisation(net, focusSeries(ntc.ab, focus), focusSeries(ntc.ba, focus))
      : EMPTY_SERIES;
    borders[border.id] = {
      border,
      net,
      flow: flowStats(net),
      scheduledNet,
      scheduled: flowStats(scheduledNet),
      spread,
      spreadStats: spreadStats(spread),
      alignment: flowSpreadAlignment(net, spread),
      utilisation: util,
      meanUtilisation: mean(util.v),
      statusAB: physical?.statusAB ?? null,
      statusBA: physical?.statusBA ?? null,
    };
  }

  const markets = {} as Record<SeeCode, MarketView>;
  for (const code of SEE_CODES) {
    const own = bordersOf(code);
    let covered = 0;
    let netImport = 0;
    for (const border of own) {
      const meanNet = borders[border.id].flow.meanNet;
      if (meanNet === null) continue;
      covered += 1;
      // Net is a -> b: an import for b, an export for a.
      netImport += border.b === code ? meanNet : -meanNet;
    }
    markets[code] = {
      code,
      series: priceSeries[code],
      stats: priceStats(priceSeries[code]),
      status: input.prices[code]?.status ?? null,
      // Connected markets have borders outside this registry, so no net position.
      netImport:
        SEE_MARKETS[code].tier === "core" && own.length > 0 && covered === own.length
          ? netImport
          : null,
      bordersCovered: covered,
      bordersTotal: own.length,
    };
  }

  const coreBases = SEE_CODES.filter((code) => SEE_MARKETS[code].tier === "core")
    .map((code) => markets[code].stats.base)
    .filter((value): value is number => value !== null);
  const regionalBase = mean(coreBases);
  const baseSpan =
    regionalBase === null
      ? 0
      : Math.max(0, ...coreBases.map((value) => Math.abs(value - regionalBase)));

  return { focus, markets, borders, regionalBase, baseSpan };
}

// --- Signals -----------------------------------------------------------------

export interface Signal {
  id: string;
  /** "watch" needs attention; "info" is context. */
  level: "watch" | "info";
  en: string;
  sr: string;
  market?: SeeCode;
  border?: string;
}

const one = (value: number) => value.toFixed(1);
const pct = (share: number) => `${Math.round(share * 100)}%`;

/**
 * Statements computed from the loaded observations by fixed rules. Each one carries the
 * numbers it is based on; none is a forecast or a recommendation.
 */
export function computeSignals(region: Region): Signal[] {
  const out: Signal[] = [];
  const priced = SEE_CODES.filter(
    (code) => SEE_MARKETS[code].tier === "core" && region.markets[code].stats.base !== null,
  ).sort((x, y) => region.markets[y].stats.base! - region.markets[x].stats.base!);

  if (priced.length >= 2) {
    const top = priced[0];
    const bottom = priced[priced.length - 1];
    const gap = region.markets[top].stats.base! - region.markets[bottom].stats.base!;
    out.push({
      id: "range",
      level: gap >= 15 ? "watch" : "info",
      market: top,
      en: `${SEE_MARKETS[top].short} is the dearest core market at ${one(region.markets[top].stats.base!)} €/MWh, ${one(gap)} above ${SEE_MARKETS[bottom].short}, the cheapest.`,
      sr: `${SEE_MARKETS[top].short} je najskuplje tržište sa ${one(region.markets[top].stats.base!)} €/MWh, ${one(gap)} iznad najjeftinijeg ${SEE_MARKETS[bottom].short}.`,
    });
  }

  const negatives = priced
    .filter((code) => region.markets[code].stats.negativeHours > 0)
    .sort((x, y) => region.markets[y].stats.negativeHours - region.markets[x].stats.negativeHours);
  if (negatives.length) {
    const list = negatives
      .slice(0, 4)
      .map((code) => `${SEE_MARKETS[code].short} ${region.markets[code].stats.negativeHours} h`)
      .join(", ");
    out.push({
      id: "negative",
      level: "watch",
      market: negatives[0],
      en: `Negative day-ahead prices: ${list}.`,
      sr: `Negativne day-ahead cene: ${list}.`,
    });
  }

  const views = Object.values(region.borders);

  const wide = views
    .filter((view) => view.spreadStats.hours >= 6 && Math.abs(view.spreadStats.mean ?? 0) >= 8)
    .sort((x, y) => Math.abs(y.spreadStats.mean!) - Math.abs(x.spreadStats.mean!))
    .slice(0, 3);
  for (const view of wide) {
    const s = view.spreadStats.mean!;
    const dear = s > 0 ? view.border.b : view.border.a;
    const cheap = s > 0 ? view.border.a : view.border.b;
    out.push({
      id: `spread-${view.border.id}`,
      level: "watch",
      border: view.border.id,
      en: `${SEE_MARKETS[cheap].short} → ${SEE_MARKETS[dear].short} mean spread ${one(Math.abs(s))} €/MWh over ${view.spreadStats.hours} h.`,
      sr: `${SEE_MARKETS[cheap].short} → ${SEE_MARKETS[dear].short} prosečan spread ${one(Math.abs(s))} €/MWh tokom ${view.spreadStats.hours} h.`,
    });
  }

  const split = views
    .filter(
      (view) =>
        view.border.allocation === "implicit" &&
        view.spreadStats.hours >= 6 &&
        (view.spreadStats.splitShare ?? 0) >= 0.5,
    )
    .sort((x, y) => y.spreadStats.splitShare! - x.spreadStats.splitShare!)
    .slice(0, 2);
  for (const view of split) {
    out.push({
      id: `split-${view.border.id}`,
      level: "info",
      border: view.border.id,
      en: `${SEE_MARKETS[view.border.a].short}–${SEE_MARKETS[view.border.b].short} prices split in ${pct(view.spreadStats.splitShare!)} of hours: the coupled border was binding.`,
      sr: `${SEE_MARKETS[view.border.a].short}–${SEE_MARKETS[view.border.b].short} cene razdvojene u ${pct(view.spreadStats.splitShare!)} sati: spojena granica je bila ograničavajuća.`,
    });
  }

  const against = views
    .filter((view) => view.alignment.hours >= 6 && (view.alignment.againstSpread ?? 0) >= 0.3)
    .sort((x, y) => y.alignment.againstSpread! - x.alignment.againstSpread!)
    .slice(0, 2);
  for (const view of against) {
    out.push({
      id: `against-${view.border.id}`,
      level: "info",
      border: view.border.id,
      en: `${SEE_MARKETS[view.border.a].short}–${SEE_MARKETS[view.border.b].short} physical flow ran towards the cheaper zone in ${pct(view.alignment.againstSpread!)} of hours.`,
      sr: `${SEE_MARKETS[view.border.a].short}–${SEE_MARKETS[view.border.b].short} fizički tok je išao ka jeftinijoj zoni u ${pct(view.alignment.againstSpread!)} sati.`,
    });
  }

  return out;
}

/** Market-time delivery days between two ISO dates, inclusive. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = Date.parse(`${to}T12:00:00Z`);
  for (let t = Date.parse(`${from}T12:00:00Z`); t <= end && out.length < 800; t += 86400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
