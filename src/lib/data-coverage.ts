export type CoverageSource = "entsoe" | "cache" | "none";

export type CoverageState =
  | "complete"
  | "partial"
  | "cached-complete"
  | "cached-partial"
  | "unavailable";

export function classifyCoverage(input: {
  source: CoverageSource;
  selectedFrom?: string;
  selectedTo?: string;
  availableFrom?: string;
  availableTo?: string;
  missingDays?: number;
  incompleteDays?: number;
  failedFetches?: number;
  capReached?: boolean;
}): CoverageState {
  if (input.source === "none") return "unavailable";

  const boundsIncomplete =
    !!input.selectedFrom &&
    !!input.selectedTo &&
    (!input.availableFrom ||
      !input.availableTo ||
      input.availableFrom > input.selectedFrom ||
      input.availableTo < input.selectedTo);

  const internalGap =
    (input.missingDays ?? 0) > 0 ||
    (input.incompleteDays ?? 0) > 0 ||
    (input.failedFetches ?? 0) > 0 ||
    input.capReached === true;

  const partial = boundsIncomplete || internalGap;
  if (input.source === "cache") return partial ? "cached-partial" : "cached-complete";
  return partial ? "partial" : "complete";
}

export function isCoveragePartial(state: CoverageState): boolean {
  return state === "partial" || state === "cached-partial";
}

export function isCoverageComplete(state: CoverageState): boolean {
  return state === "complete" || state === "cached-complete";
}
