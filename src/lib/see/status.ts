// One vocabulary for where a number came from, shared by server functions and UI.

export type Provenance =
  /** Fetched from the provider during this request. */
  | "live"
  /** Provider observation served from cache within its freshness window. */
  | "cache"
  /** Provider observation from cache, past its freshness window (provider unreachable). */
  | "stale"
  /** Generated development data. Never a market observation. */
  | "synthetic"
  /** The provider answered but has nothing for this request. */
  | "empty"
  /** Cannot be fetched: credentials or integration missing. */
  | "unavailable"
  /** The request failed. */
  | "error";

export interface SeriesStatus {
  state: Provenance;
  reason?: string;
  fetchedAt: string;
}

export interface FetchLike {
  source: "live" | "cache" | "demo" | "empty";
  reason?: string;
  fetched_at: string;
  stale?: boolean;
}

export function toStatus(result: FetchLike): SeriesStatus {
  const base = { reason: result.reason, fetchedAt: result.fetched_at };
  if (result.source === "demo") return { ...base, state: "synthetic" };
  if (result.source === "live") return { ...base, state: "live" };
  if (result.source === "cache") return { ...base, state: result.stale ? "stale" : "cache" };
  const reason = result.reason ?? "";
  if (/token/.test(reason)) return { ...base, state: "unavailable" };
  if (/no_data|no_load|no_generation/.test(reason)) return { ...base, state: "empty" };
  return { ...base, state: "error" };
}

export function failedStatus(reason: unknown): SeriesStatus {
  return {
    state: "error",
    reason: reason instanceof Error ? reason.message : "error",
    fetchedAt: new Date().toISOString(),
  };
}

const RANK: Record<Provenance, number> = {
  synthetic: 6,
  error: 5,
  unavailable: 4,
  stale: 3,
  empty: 2,
  cache: 1,
  live: 0,
};

/** The least trustworthy state in a set; used for a panel-level badge. */
export function worstState(states: Provenance[]): Provenance | null {
  if (!states.length) return null;
  return states.reduce((worst, state) => (RANK[state] > RANK[worst] ? state : worst));
}

export function hasData(state: Provenance): boolean {
  return state === "live" || state === "cache" || state === "stale" || state === "synthetic";
}

export function reasonText(reason: string | undefined, lang: "en" | "sr" = "en"): string {
  const r = reason ?? "";
  const pick = (en: string, sr: string) => (lang === "sr" ? sr : en);
  if (/token/.test(r))
    return pick(
      "ENTSO-E API token is not configured on the server.",
      "ENTSO-E API token nije podešen na serveru.",
    );
  if (/no_data|no_load|no_generation/.test(r))
    return pick(
      "The provider has not published data for this selection.",
      "Provajder nije objavio podatke za ovaj izbor.",
    );
  if (/timeout|abort/i.test(r))
    return pick("The provider did not answer in time.", "Provajder nije odgovorio na vreme.");
  if (/429|rate/i.test(r))
    return pick("The provider rate limit was reached.", "Dostignut je limit zahteva provajdera.");
  if (!r) return pick("No data.", "Nema podataka.");
  return pick(`Provider request failed (${r}).`, `Zahtev ka provajderu nije uspeo (${r}).`);
}
