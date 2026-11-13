// Single source of truth for the Southeast European markets, their bidding zones and
// the interconnections between them. Every workspace reads markets and borders from here.
//
// Market facts (TSO, exchange, coupling status) describe the structure as of the
// registry's review date. They are configuration, not a live feed: the Data status page
// probes each zone against ENTSO-E at runtime, and a zone that returns nothing is shown
// as unavailable, never filled in.
import type { ZoneCode } from "../markets";
import type { PriceMarketCode } from "../price-markets";

export const REGISTRY_REVIEWED = "2026-11";

export type SeeCode =
  | "RS"
  | "BA"
  | "ME"
  | "MK"
  | "AL"
  | "XK"
  | "HR"
  | "SI"
  | "BG"
  | "RO"
  | "GR"
  | "HU"
  | "AT"
  | "IT_NORD"
  | "IT_CSUD"
  | "IT_SUD"
  | "TR"
  | "SK"
  | "UA"
  | "MD";

export type MarketTier = "core" | "connected";
export type Coupling = "SDAC" | "regional" | "isolated" | "none";

export interface SeeMarket {
  code: SeeCode;
  /** Short label for dense UI: tape, map nodes, table headers. */
  short: string;
  name: string;
  nameSr: string;
  /** ISO alpha-2 of the country polygon the zone belongs to on the map. */
  country: string;
  tier: MarketTier;
  tso: string;
  /** Day-ahead market operator, or null where no organised day-ahead market exists. */
  exchange: string | null;
  coupling: Coupling;
  /** Key into the day-ahead price registry; null when no day-ahead price is expected. */
  price: PriceMarketCode | null;
  /** Key into the ENTSO-E zone registry used for flows, load and generation. */
  zone: ZoneCode;
  note?: string;
}

const m = (market: SeeMarket) => market;

export const SEE_MARKETS: Record<SeeCode, SeeMarket> = {
  RS: m({
    code: "RS",
    short: "RS",
    name: "Serbia",
    nameSr: "Srbija",
    country: "RS",
    tier: "core",
    tso: "EMS",
    exchange: "SEEPEX",
    coupling: "isolated",
    price: "RS",
    zone: "RS",
  }),
  HU: m({
    code: "HU",
    short: "HU",
    name: "Hungary",
    nameSr: "Mađarska",
    country: "HU",
    tier: "core",
    tso: "MAVIR",
    exchange: "HUPX",
    coupling: "SDAC",
    price: "HU",
    zone: "HU",
  }),
  RO: m({
    code: "RO",
    short: "RO",
    name: "Romania",
    nameSr: "Rumunija",
    country: "RO",
    tier: "core",
    tso: "Transelectrica",
    exchange: "OPCOM",
    coupling: "SDAC",
    price: "RO",
    zone: "RO",
  }),
  BG: m({
    code: "BG",
    short: "BG",
    name: "Bulgaria",
    nameSr: "Bugarska",
    country: "BG",
    tier: "core",
    tso: "ESO",
    exchange: "IBEX",
    coupling: "SDAC",
    price: "BG",
    zone: "BG",
  }),
  GR: m({
    code: "GR",
    short: "GR",
    name: "Greece",
    nameSr: "Grčka",
    country: "GR",
    tier: "core",
    tso: "IPTO (ADMIE)",
    exchange: "HEnEx",
    coupling: "SDAC",
    price: "GR",
    zone: "GR",
  }),
  HR: m({
    code: "HR",
    short: "HR",
    name: "Croatia",
    nameSr: "Hrvatska",
    country: "HR",
    tier: "core",
    tso: "HOPS",
    exchange: "CROPEX",
    coupling: "SDAC",
    price: "HR",
    zone: "HR",
  }),
  SI: m({
    code: "SI",
    short: "SI",
    name: "Slovenia",
    nameSr: "Slovenija",
    country: "SI",
    tier: "core",
    tso: "ELES",
    exchange: "BSP SouthPool",
    coupling: "SDAC",
    price: "SI",
    zone: "SI",
  }),
  BA: m({
    code: "BA",
    short: "BA",
    name: "Bosnia and Herzegovina",
    nameSr: "Bosna i Hercegovina",
    country: "BA",
    tier: "core",
    tso: "NOSBiH",
    exchange: null,
    coupling: "none",
    price: null,
    zone: "BA",
    note: "No organised day-ahead market; no day-ahead price is published.",
  }),
  ME: m({
    code: "ME",
    short: "ME",
    name: "Montenegro",
    nameSr: "Crna Gora",
    country: "ME",
    tier: "core",
    tso: "CGES",
    exchange: "MEPX (BELEN)",
    coupling: "isolated",
    price: "ME",
    zone: "ME",
  }),
  MK: m({
    code: "MK",
    short: "MK",
    name: "North Macedonia",
    nameSr: "Severna Makedonija",
    country: "MK",
    tier: "core",
    tso: "MEPSO",
    exchange: "MEMO",
    coupling: "isolated",
    price: "MK",
    zone: "MK",
  }),
  AL: m({
    code: "AL",
    short: "AL",
    name: "Albania",
    nameSr: "Albanija",
    country: "AL",
    tier: "core",
    tso: "OST",
    exchange: "ALPEX",
    coupling: "regional",
    price: "AL",
    zone: "AL",
    note: "Coupled with the Kosovo* zone through ALPEX.",
  }),
  XK: m({
    code: "XK",
    short: "XK",
    name: "Kosovo*",
    nameSr: "Kosovo*",
    country: "XK",
    tier: "core",
    tso: "KOSTT",
    exchange: "ALPEX",
    coupling: "regional",
    price: "XK",
    zone: "XK",
    note: "Coupled with Albania through ALPEX. * Designation without prejudice to positions on status, in line with UNSCR 1244/1999 and the ICJ opinion.",
  }),
  AT: m({
    code: "AT",
    short: "AT",
    name: "Austria",
    nameSr: "Austrija",
    country: "AT",
    tier: "connected",
    tso: "APG",
    exchange: "EPEX SPOT / EXAA",
    coupling: "SDAC",
    price: "AT",
    zone: "AT",
  }),
  IT_NORD: m({
    code: "IT_NORD",
    short: "IT-N",
    name: "Italy North",
    nameSr: "Italija Sever",
    country: "IT",
    tier: "connected",
    tso: "Terna",
    exchange: "GME",
    coupling: "SDAC",
    price: "IT_NORD",
    zone: "IT_NORD",
  }),
  IT_CSUD: m({
    code: "IT_CSUD",
    short: "IT-CS",
    name: "Italy Centre-South",
    nameSr: "Italija Centar-Jug",
    country: "IT",
    tier: "connected",
    tso: "Terna",
    exchange: "GME",
    coupling: "SDAC",
    price: "IT_CSUD",
    zone: "IT_CSUD",
  }),
  IT_SUD: m({
    code: "IT_SUD",
    short: "IT-S",
    name: "Italy South",
    nameSr: "Italija Jug",
    country: "IT",
    tier: "connected",
    tso: "Terna",
    exchange: "GME",
    coupling: "SDAC",
    price: null,
    zone: "IT_SUD",
    note: "Shown for the Greece–Italy cable; its price is not tracked.",
  }),
  TR: m({
    code: "TR",
    short: "TR",
    name: "Türkiye",
    nameSr: "Turska",
    country: "TR",
    tier: "connected",
    tso: "TEİAŞ",
    exchange: "EPİAŞ",
    coupling: "isolated",
    price: null,
    zone: "TR",
    note: "Market clears in TRY and is not published on the same day-ahead feed; flows only.",
  }),
  SK: m({
    code: "SK",
    short: "SK",
    name: "Slovakia",
    nameSr: "Slovačka",
    country: "SK",
    tier: "connected",
    tso: "SEPS",
    exchange: "OKTE",
    coupling: "SDAC",
    price: null,
    zone: "SK",
    note: "Flows only.",
  }),
  UA: m({
    code: "UA",
    short: "UA",
    name: "Ukraine",
    nameSr: "Ukrajina",
    country: "UA",
    tier: "connected",
    tso: "Ukrenergo",
    exchange: "Market Operator",
    coupling: "isolated",
    price: null,
    zone: "UA",
    note: "Flows only.",
  }),
  MD: m({
    code: "MD",
    short: "MD",
    name: "Moldova",
    nameSr: "Moldavija",
    country: "MD",
    tier: "connected",
    tso: "Moldelectrica",
    exchange: null,
    coupling: "none",
    price: null,
    zone: "MD",
    note: "Flows only.",
  }),
};

export const SEE_CODES = Object.keys(SEE_MARKETS) as SeeCode[];
export const CORE_CODES = SEE_CODES.filter((code) => SEE_MARKETS[code].tier === "core");
export const PRICED_CODES = SEE_CODES.filter((code) => SEE_MARKETS[code].price !== null);
export const CORE_PRICED_CODES = CORE_CODES.filter((code) => SEE_MARKETS[code].price !== null);

export function isSeeCode(value: unknown): value is SeeCode {
  return typeof value === "string" && value in SEE_MARKETS;
}

export type LinkType = "AC" | "HVDC";
/**
 * How day-ahead cross-zonal capacity reaches the market.
 * implicit: allocated inside single day-ahead coupling, no separate capacity price.
 * explicit: sold in capacity auctions (JAO, SEE CAO or the TSOs), with a capacity price.
 */
export type Allocation = "implicit" | "explicit";

export interface SeeBorder {
  /** Stable id "A-B" with the pair in registry order. */
  id: string;
  a: SeeCode;
  b: SeeCode;
  link: LinkType;
  allocation: Allocation;
  note?: string;
}

const border = (
  a: SeeCode,
  b: SeeCode,
  allocation: Allocation,
  link: LinkType = "AC",
  note?: string,
): SeeBorder => ({ id: `${a}-${b}`, a, b, link, allocation, note });

// Interconnections in commercial operation. A border is implicit only when both zones
// are in single day-ahead coupling; every border touching a non-coupled zone is explicit.
export const SEE_BORDERS: SeeBorder[] = [
  border("RS", "HU", "explicit"),
  border("RS", "RO", "explicit"),
  border("RS", "BG", "explicit"),
  border("RS", "MK", "explicit"),
  border("RS", "ME", "explicit"),
  border("RS", "BA", "explicit"),
  border("RS", "HR", "explicit"),
  border("RS", "XK", "explicit"),
  border("BA", "HR", "explicit"),
  border("BA", "ME", "explicit"),
  border("ME", "AL", "explicit"),
  border("ME", "XK", "explicit"),
  border("ME", "IT_CSUD", "explicit", "HVDC", "MONITA submarine cable"),
  border("AL", "XK", "explicit"),
  border("AL", "GR", "explicit"),
  border("MK", "XK", "explicit"),
  border("MK", "BG", "explicit"),
  border("MK", "GR", "explicit"),
  border("HR", "SI", "implicit"),
  border("HR", "HU", "implicit"),
  border("SI", "HU", "implicit"),
  border("SI", "AT", "implicit"),
  border("SI", "IT_NORD", "implicit"),
  border("HU", "AT", "implicit"),
  border("HU", "SK", "implicit"),
  border("HU", "RO", "implicit"),
  border("HU", "UA", "explicit"),
  border("RO", "BG", "implicit"),
  border("RO", "UA", "explicit"),
  border("RO", "MD", "explicit"),
  border("BG", "GR", "implicit"),
  border("BG", "TR", "explicit"),
  border("GR", "TR", "explicit"),
  border("GR", "IT_SUD", "implicit", "HVDC", "Greece–Italy submarine cable"),
];

export const BORDER_BY_ID: Record<string, SeeBorder> = Object.fromEntries(
  SEE_BORDERS.map((item) => [item.id, item]),
);

export function findBorder(x: SeeCode, y: SeeCode): SeeBorder | null {
  return BORDER_BY_ID[`${x}-${y}`] ?? BORDER_BY_ID[`${y}-${x}`] ?? null;
}

export function bordersOf(code: SeeCode): SeeBorder[] {
  return SEE_BORDERS.filter((item) => item.a === code || item.b === code);
}

export function neighboursOf(code: SeeCode): SeeCode[] {
  return bordersOf(code).map((item) => (item.a === code ? item.b : item.a));
}

/** Borders where both ends publish a day-ahead price, so a spread can be computed. */
export const SPREAD_BORDERS = SEE_BORDERS.filter(
  (item) => SEE_MARKETS[item.a].price !== null && SEE_MARKETS[item.b].price !== null,
);
