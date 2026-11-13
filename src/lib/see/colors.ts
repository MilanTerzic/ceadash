// Colour helpers. Every colour is a design-system token; mixes are computed in CSS so
// both themes work without re-rendering.

export const SERIES_VARS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
  "var(--series-8)",
] as const;

/** A chart can identify at most this many series by colour; more must be faceted. */
export const MAX_SERIES = SERIES_VARS.length;

/**
 * Diverging fill for a value against a reference: blue below, red above, neutral at it.
 * `span` is the distance from the reference that maps to full saturation.
 */
export function divergingColor(
  value: number | null,
  reference: number | null,
  span: number,
): string {
  if (value === null || reference === null || !Number.isFinite(value) || !(span > 0)) {
    return "var(--surface-2)";
  }
  const x = Math.max(-1, Math.min(1, (value - reference) / span));
  const pct = Math.round(Math.abs(x) * 100);
  const pole = x >= 0 ? "var(--price-high)" : "var(--price-low)";
  return `color-mix(in oklab, ${pole} ${pct}%, var(--price-mid))`;
}

/** Sequential fill for a magnitude in [0, 1]. */
export function sequentialColor(share: number | null): string {
  if (share === null || !Number.isFinite(share)) return "var(--surface-2)";
  const x = Math.max(0, Math.min(1, share));
  if (x < 1 / 3) {
    return `color-mix(in oklab, var(--seq-2) ${Math.round(x * 300)}%, var(--seq-1))`;
  }
  if (x < 2 / 3) {
    return `color-mix(in oklab, var(--seq-3) ${Math.round((x - 1 / 3) * 300)}%, var(--seq-2))`;
  }
  return `color-mix(in oklab, var(--seq-4) ${Math.round((x - 2 / 3) * 300)}%, var(--seq-3))`;
}

/** Text colour that stays readable on a diverging or sequential fill. */
export function inkOn(strength: number): string {
  return strength > 0.55 ? "#ffffff" : "var(--foreground)";
}

// ENTSO-E production types folded into eight groups, one per categorical slot.
// Stack order follows slot order, which is the order the palette was validated in.
export type GenGroup =
  | "hydro"
  | "gas"
  | "wind"
  | "solar"
  | "biomass"
  | "nuclear"
  | "other"
  | "coal";

export const GEN_GROUPS: Array<{ key: GenGroup; en: string; sr: string; color: string }> = [
  { key: "hydro", en: "Hydro", sr: "Hidro", color: "var(--series-1)" },
  { key: "gas", en: "Gas", sr: "Gas", color: "var(--series-2)" },
  { key: "wind", en: "Wind", sr: "Vetar", color: "var(--series-3)" },
  { key: "solar", en: "Solar", sr: "Solar", color: "var(--series-4)" },
  {
    key: "biomass",
    en: "Biomass & other RES",
    sr: "Biomasa i ostali OIE",
    color: "var(--series-5)",
  },
  { key: "nuclear", en: "Nuclear", sr: "Nuklearna", color: "var(--series-6)" },
  { key: "other", en: "Other", sr: "Ostalo", color: "var(--series-7)" },
  { key: "coal", en: "Coal & lignite", sr: "Ugalj i lignit", color: "var(--series-8)" },
];

const PSR_GROUP: Record<string, GenGroup> = {
  B01: "biomass",
  B02: "coal",
  B03: "gas",
  B04: "gas",
  B05: "coal",
  B06: "other",
  B07: "coal",
  B08: "coal",
  B09: "biomass",
  B10: "hydro",
  B11: "hydro",
  B12: "hydro",
  B13: "biomass",
  B14: "nuclear",
  B15: "biomass",
  B16: "solar",
  B17: "biomass",
  B18: "wind",
  B19: "wind",
  B20: "other",
};

export function genGroup(psrType: string): GenGroup {
  return PSR_GROUP[psrType] ?? "other";
}
