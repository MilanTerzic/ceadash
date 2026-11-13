// Turns the regional model into what the map draws for each layer. Every layer states
// its own meaning in `legend`; a market or border without a value on the layer is
// returned as empty rather than drawn with a guess.
import type { Series } from "@/lib/see/analytics";
import { divergingColor, genGroup, sequentialColor } from "@/lib/see/colors";
import { fmt, fmtMW, fmtPrice, fmtSigned } from "@/lib/see/format";
import type { Region } from "@/lib/see/region";
import { SEE_BORDERS, SEE_CODES, SEE_MARKETS, type SeeCode } from "@/lib/see/registry";
import type { CapacityAuction, MarketFundamentals } from "@/lib/see/see.functions";
import type { MapLink, MapNode } from "./SeeMap";

export type LayerId =
  | "price"
  | "flow"
  | "scheduled"
  | "spread"
  | "utilisation"
  | "capacity"
  | "mix";

export const LAYERS: Array<{
  id: LayerId;
  en: string;
  sr: string;
  titleEn: string;
  titleSr: string;
}> = [
  {
    id: "price",
    en: "Prices",
    sr: "Cene",
    titleEn: "Day-ahead baseload by market",
    titleSr: "Day-ahead baseload po tržištu",
  },
  {
    id: "flow",
    en: "Physical flows",
    sr: "Fizički tokovi",
    titleEn: "Measured cross-border physical flows",
    titleSr: "Izmereni prekogranični fizički tokovi",
  },
  {
    id: "scheduled",
    en: "Schedules",
    sr: "Rasporedi",
    titleEn: "Scheduled commercial exchanges",
    titleSr: "Planirane komercijalne razmene",
  },
  {
    id: "spread",
    en: "Spreads",
    sr: "Spreadovi",
    titleEn: "Day-ahead price difference across each border",
    titleSr: "Razlika day-ahead cena preko svake granice",
  },
  {
    id: "utilisation",
    en: "Utilisation",
    sr: "Iskorišćenost",
    titleEn: "Physical flow as a share of day-ahead NTC",
    titleSr: "Fizički tok kao udeo day-ahead NTC",
  },
  {
    id: "capacity",
    en: "Capacity price",
    sr: "Cena kapaciteta",
    titleEn: "Daily explicit capacity auction prices",
    titleSr: "Cene dnevnih eksplicitnih aukcija kapaciteta",
  },
  {
    id: "mix",
    en: "Generation",
    sr: "Proizvodnja",
    titleEn: "Wind and solar share of generation",
    titleSr: "Udeo vetra i sunca u proizvodnji",
  },
];

export interface LayerView {
  nodes: Partial<Record<SeeCode, MapNode>>;
  links: Record<string, MapLink>;
  countryFill: Record<string, string>;
  legend: { en: string; sr: string };
  /** What the node figure is, for the map caption. */
  nodeMeaning: { en: string; sr: string };
}

/** Line width for a flow in MW: square-root scale so small flows stay visible. */
function flowWidth(mw: number): number {
  return 1.25 + 4.75 * Math.sqrt(Math.min(1, Math.abs(mw) / 1500));
}

/** Sequential colour for a line: starts a third up the ramp so weak links stay visible. */
function linkRamp(share: number): string {
  return sequentialColor(0.3 + 0.7 * Math.min(1, Math.max(0, share)));
}

function strength(value: number | null, reference: number | null, span: number): number {
  if (value === null || reference === null || !(span > 0)) return 0;
  return Math.min(1, Math.abs(value - reference) / span);
}

/** Wind + solar share of total generation over the focus hours present in the data. */
export function resShare(
  generation: Record<string, Series>,
  hours: Set<number> | null,
): number | null {
  let res = 0;
  let total = 0;
  for (const [type, series] of Object.entries(generation)) {
    const group = genGroup(type);
    for (let i = 0; i < series.t.length; i++) {
      if (hours && !hours.has(series.t[i])) continue;
      total += series.v[i];
      if (group === "wind" || group === "solar") res += series.v[i];
    }
  }
  return total > 0 ? res / total : null;
}

export function buildLayer(
  layer: LayerId,
  region: Region,
  extras: {
    capacity: Record<string, { ab: CapacityAuction; ba: CapacityAuction }>;
    fundamentals: Partial<Record<SeeCode, MarketFundamentals>>;
  },
): LayerView {
  const nodes: Partial<Record<SeeCode, MapNode>> = {};
  const links: Record<string, MapLink> = {};
  const countryFill: Record<string, string> = {};
  const span = Math.max(8, region.baseSpan);
  const ref = region.regionalBase;

  const priceNodes = (fillPolygons: boolean) => {
    for (const code of SEE_CODES) {
      const market = SEE_MARKETS[code];
      const base = region.markets[code].stats.base;
      if (market.price === null || base === null) {
        nodes[code] = { value: "—", empty: true };
        continue;
      }
      const fill = divergingColor(base, ref, span);
      const s = strength(base, ref, span);
      nodes[code] = { value: fmtPrice(base), fill, ink: s > 0.55 ? "#ffffff" : undefined };
      // One zone per country: colour the country too. Italy has several zones.
      if (fillPolygons && market.country !== "IT" && market.tier === "core") {
        countryFill[market.country] = `color-mix(in oklab, ${fill} 55%, var(--map-land-core))`;
      }
    }
  };

  const faintLinks = () => {
    for (const border of SEE_BORDERS)
      links[border.id] = { width: 1, color: "", direction: 0, empty: true };
  };

  const netNodes = (source: "flow" | "scheduled") => {
    for (const code of SEE_CODES) {
      if (source === "flow") {
        const net = region.markets[code].netImport;
        nodes[code] = net === null ? { value: "—", empty: true } : { value: fmtSigned(net, 0) };
        continue;
      }
      // Scheduled net position, from the same borders.
      if (SEE_MARKETS[code].tier !== "core") {
        nodes[code] = { value: "—", empty: true };
        continue;
      }
      let covered = 0;
      let total = 0;
      let sum = 0;
      for (const border of SEE_BORDERS) {
        if (border.a !== code && border.b !== code) continue;
        total += 1;
        const meanNet = region.borders[border.id].scheduled.meanNet;
        if (meanNet === null) continue;
        covered += 1;
        sum += border.b === code ? meanNet : -meanNet;
      }
      nodes[code] =
        total > 0 && covered === total ? { value: fmtSigned(sum, 0) } : { value: "—", empty: true };
    }
  };

  switch (layer) {
    case "price": {
      priceNodes(true);
      faintLinks();
      return {
        nodes,
        links,
        countryFill,
        nodeMeaning: { en: "Baseload, €/MWh", sr: "Baseload, €/MWh" },
        legend: {
          en: `Blue is cheaper and red dearer than the regional mean (${fmtPrice(ref)} €/MWh); full colour at ±${fmt(span, 0)}.`,
          sr: `Plavo je jeftinije, a crveno skuplje od regionalnog proseka (${fmtPrice(ref)} €/MWh); puna boja na ±${fmt(span, 0)}.`,
        },
      };
    }
    case "flow":
    case "scheduled": {
      netNodes(layer);
      for (const border of SEE_BORDERS) {
        const stats =
          layer === "flow" ? region.borders[border.id].flow : region.borders[border.id].scheduled;
        if (stats.meanNet === null) {
          links[border.id] = { width: 1, color: "", direction: 0, empty: true };
          continue;
        }
        links[border.id] = {
          width: flowWidth(stats.meanNet),
          color: layer === "flow" ? "var(--flow)" : "var(--series-7)",
          direction: stats.meanNet > 0 ? 1 : stats.meanNet < 0 ? -1 : 0,
          label: fmtMW(Math.abs(stats.meanNet)),
          animated: layer === "flow",
          dashed: layer === "scheduled",
        };
      }
      return {
        nodes,
        links,
        countryFill,
        nodeMeaning: {
          en: "Net position, MW (+ import, − export)",
          sr: "Neto pozicija, MW (+ uvoz, − izvoz)",
        },
        legend:
          layer === "flow"
            ? {
                en: "Mean measured physical flow, MW. Arrow shows the net direction; width grows with size. A market's net position appears only when all its borders reported.",
                sr: "Prosečan izmereni fizički tok, MW. Strelica pokazuje neto smer; debljina raste sa veličinom. Neto pozicija se prikazuje samo kada su sve granice izvestile.",
              }
            : {
                en: "Mean scheduled commercial exchange, MW: what was traded across the border, not what physically flowed.",
                sr: "Prosečna planirana komercijalna razmena, MW: ono što je trgovano preko granice, ne ono što je fizički teklo.",
              },
      };
    }
    case "spread": {
      priceNodes(false);
      for (const border of SEE_BORDERS) {
        const s = region.borders[border.id].spreadStats.mean;
        if (s === null) {
          links[border.id] = { width: 1, color: "", direction: 0, empty: true };
          continue;
        }
        links[border.id] = {
          width: 3.5,
          color: linkRamp(Math.abs(s) / 25),
          direction: Math.abs(s) < 0.05 ? 0 : s > 0 ? 1 : -1,
          label: fmt(Math.abs(s), 1),
        };
      }
      return {
        nodes,
        links,
        countryFill,
        nodeMeaning: { en: "Baseload, €/MWh", sr: "Baseload, €/MWh" },
        legend: {
          en: "Mean day-ahead price difference, €/MWh. Arrow points to the dearer market; a stronger colour is a wider spread (full at 25). Indicative, not an executable margin.",
          sr: "Prosečna razlika day-ahead cena, €/MWh. Strelica pokazuje skuplje tržište; jača boja znači veći spread (puna na 25). Indikativno, nije ostvariva marža.",
        },
      };
    }
    case "utilisation": {
      netNodes("flow");
      for (const border of SEE_BORDERS) {
        const view = region.borders[border.id];
        if (view.meanUtilisation === null) {
          links[border.id] = { width: 1, color: "", direction: 0, empty: true };
          continue;
        }
        const net = view.flow.meanNet ?? 0;
        links[border.id] = {
          width: 4,
          color: linkRamp(view.meanUtilisation),
          direction: net > 0 ? 1 : net < 0 ? -1 : 0,
          label: `${fmt(view.meanUtilisation * 100, 0)}%`,
        };
      }
      return {
        nodes,
        links,
        countryFill,
        nodeMeaning: {
          en: "Net position, MW (+ import, − export)",
          sr: "Neto pozicija, MW (+ uvoz, − izvoz)",
        },
        legend: {
          en: "Mean of hourly |physical flow| ÷ day-ahead forecast NTC in the flow direction. Borders without a published NTC are not rated. Physical flow can exceed NTC because of loop flows.",
          sr: "Prosek satnog |fizički tok| ÷ day-ahead prognoziran NTC u smeru toka. Granice bez objavljenog NTC nisu ocenjene. Fizički tok može premašiti NTC zbog kružnih tokova.",
        },
      };
    }
    case "capacity": {
      priceNodes(false);
      for (const border of SEE_BORDERS) {
        const auction = extras.capacity[border.id];
        const ab = auction?.ab.price ?? null;
        const ba = auction?.ba.price ?? null;
        if (border.allocation === "implicit" || (ab === null && ba === null)) {
          links[border.id] = { width: 1, color: "", direction: 0, empty: true };
          continue;
        }
        const forward = (ab ?? -Infinity) >= (ba ?? -Infinity);
        const price = forward ? ab! : ba!;
        links[border.id] = {
          width: 3.5,
          color: linkRamp(price / 20),
          direction: forward ? 1 : -1,
          label: fmt(price, 2),
        };
      }
      return {
        nodes,
        links,
        countryFill,
        nodeMeaning: { en: "Baseload, €/MWh", sr: "Baseload, €/MWh" },
        legend: {
          en: "Daily explicit auction price for the dearer direction, €/MWh of transfer right (last day of the period). Coupled borders have no capacity price: capacity is allocated with the energy.",
          sr: "Cena dnevne eksplicitne aukcije za skuplji smer, €/MWh prenosnog prava (poslednji dan perioda). Spojene granice nemaju cenu kapaciteta: kapacitet se dodeljuje sa energijom.",
        },
      };
    }
    case "mix": {
      for (const code of SEE_CODES) {
        const fundamentals = extras.fundamentals[code];
        const hours = region.focus.mode === "day" ? new Set(region.markets[code].series.t) : null;
        const share = fundamentals
          ? resShare(fundamentals.generation, hours && hours.size ? hours : null)
          : null;
        nodes[code] =
          share === null
            ? { value: "—", empty: true }
            : {
                value: `${fmt(share * 100, 0)}%`,
                fill: sequentialColor(Math.min(1, share / 0.6)),
                ink: share / 0.6 > 0.4 ? "#ffffff" : undefined,
              };
      }
      faintLinks();
      return {
        nodes,
        links,
        countryFill,
        nodeMeaning: {
          en: "Wind + solar share of generation",
          sr: "Udeo vetra i sunca u proizvodnji",
        },
        legend: {
          en: "Wind and solar as a share of reported actual generation (full colour at 60%). Open a market for its full mix.",
          sr: "Vetar i sunce kao udeo prijavljene ostvarene proizvodnje (puna boja na 60%). Otvorite tržište za ceo miks.",
        },
      };
    }
  }
}
