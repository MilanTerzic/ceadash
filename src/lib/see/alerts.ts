// Alert rules and their evaluation against the regional model. Pure and unit-tested.
//
// Rules are checked in the browser against the data that is loaded. Nothing here runs on
// a server or sends a notification while the application is closed.
import type { Region } from "./region";
import { BORDER_BY_ID, SEE_MARKETS, type SeeCode } from "./registry";

export type AlertRule =
  | {
      id: string;
      kind: "price";
      market: SeeCode;
      /** "base": the day's baseload. "anyHour": any single hourly price. */
      basis: "base" | "anyHour";
      op: "above" | "below";
      value: number;
    }
  | {
      id: string;
      kind: "spread";
      border: string;
      /** The spread is measured as the other market's price minus this one. */
      from: SeeCode;
      value: number;
    }
  | { id: string; kind: "negative"; market: SeeCode; hours: number }
  | {
      id: string;
      kind: "counterflow";
      border: string;
      /** Share of hours, in [0, 1], with physical flow towards the cheaper zone. */
      share: number;
    };

export interface AlertResult {
  state: "triggered" | "clear" | "nodata";
  /** The observed figure the rule was compared with. */
  observed: number | null;
}

export function evaluateAlert(rule: AlertRule, region: Region): AlertResult {
  switch (rule.kind) {
    case "price": {
      const stats = region.markets[rule.market]?.stats;
      if (!stats || stats.hours === 0) return { state: "nodata", observed: null };
      const observed =
        rule.basis === "base" ? stats.base : rule.op === "above" ? stats.max : stats.min;
      if (observed === null) return { state: "nodata", observed: null };
      const hit = rule.op === "above" ? observed > rule.value : observed < rule.value;
      return { state: hit ? "triggered" : "clear", observed };
    }
    case "negative": {
      const stats = region.markets[rule.market]?.stats;
      if (!stats || stats.hours === 0) return { state: "nodata", observed: null };
      return {
        state: stats.negativeHours >= rule.hours ? "triggered" : "clear",
        observed: stats.negativeHours,
      };
    }
    case "spread": {
      const view = region.borders[rule.border];
      const mean = view?.spreadStats.mean ?? null;
      if (!view || mean === null) return { state: "nodata", observed: null };
      // The stored spread is b - a; flip it when the rule runs from b.
      const observed = rule.from === view.border.a ? mean : -mean;
      return { state: observed > rule.value ? "triggered" : "clear", observed };
    }
    case "counterflow": {
      const view = region.borders[rule.border];
      const share = view?.alignment.againstSpread ?? null;
      if (!view || share === null || view.alignment.hours === 0)
        return { state: "nodata", observed: null };
      return { state: share >= rule.share ? "triggered" : "clear", observed: share };
    }
  }
}

export function describeAlert(rule: AlertRule, lang: "en" | "sr"): string {
  const sr = lang === "sr";
  switch (rule.kind) {
    case "price": {
      const what =
        rule.basis === "base"
          ? sr
            ? "baseload"
            : "baseload"
          : sr
            ? "bilo koja satna cena"
            : "any hourly price";
      const op = rule.op === "above" ? (sr ? "iznad" : "above") : sr ? "ispod" : "below";
      return `${SEE_MARKETS[rule.market].short} ${what} ${op} ${rule.value} €/MWh`;
    }
    case "negative":
      return sr
        ? `${SEE_MARKETS[rule.market].short}: najmanje ${rule.hours} sati sa negativnom cenom`
        : `${SEE_MARKETS[rule.market].short}: at least ${rule.hours} negative-price hours`;
    case "spread": {
      const border = BORDER_BY_ID[rule.border];
      const to = border.a === rule.from ? border.b : border.a;
      return sr
        ? `Spread ${SEE_MARKETS[rule.from].short} → ${SEE_MARKETS[to].short} iznad ${rule.value} €/MWh (dnevni prosek)`
        : `Spread ${SEE_MARKETS[rule.from].short} → ${SEE_MARKETS[to].short} above ${rule.value} €/MWh (day mean)`;
    }
    case "counterflow": {
      const border = BORDER_BY_ID[rule.border];
      const pair = `${SEE_MARKETS[border.a].short}–${SEE_MARKETS[border.b].short}`;
      return sr
        ? `${pair}: tok ka jeftinijoj zoni u najmanje ${Math.round(rule.share * 100)}% sati`
        : `${pair}: flow towards the cheaper zone in at least ${Math.round(rule.share * 100)}% of hours`;
    }
  }
}

/** Drops rules that refer to markets or borders no longer in the registry. */
export function sanitizeRules(rules: unknown): AlertRule[] {
  if (!Array.isArray(rules)) return [];
  return rules.filter((rule): rule is AlertRule => {
    if (!rule || typeof rule !== "object" || typeof (rule as AlertRule).id !== "string")
      return false;
    const r = rule as AlertRule;
    if (r.kind === "price") return r.market in SEE_MARKETS && Number.isFinite(r.value);
    if (r.kind === "negative") return r.market in SEE_MARKETS && Number.isFinite(r.hours);
    if (r.kind === "spread")
      return r.border in BORDER_BY_ID && r.from in SEE_MARKETS && Number.isFinite(r.value);
    if (r.kind === "counterflow") return r.border in BORDER_BY_ID && Number.isFinite(r.share);
    return false;
  });
}
