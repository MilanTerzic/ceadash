// Watch progress, kept in this browser only (the app has no accounts).
import { useCallback } from "react";

import { usePersistent } from "@/lib/see/store";

export interface EpisodeProgress {
  /** Seconds watched up to. */
  t: number;
  /** Length of the video when last played, seconds. */
  d: number;
  done: boolean;
  at: number;
}

type ProgressMap = Record<string, EpisodeProgress>;
const EMPTY: ProgressMap = {};

export const COMPLETE_AT = 0.95;

export function useAcademyProgress() {
  const [progress, setProgress] = usePersistent<ProgressMap>("academy.progress", EMPTY);
  const record = useCallback(
    (slug: string, t: number, d: number, finished = false) => {
      if (!Number.isFinite(t) || !Number.isFinite(d) || d <= 0) return;
      setProgress((prev) => ({
        ...prev,
        [slug]: {
          t: finished ? 0 : t,
          d,
          done: finished || prev[slug]?.done === true || t / d >= COMPLETE_AT,
          at: Date.now(),
        },
      }));
    },
    [setProgress],
  );
  const clear = useCallback(
    (slug: string) =>
      setProgress((prev) => {
        const { [slug]: _removed, ...rest } = prev;
        return rest;
      }),
    [setProgress],
  );
  return { progress, record, clear };
}

/** Fraction watched 0–1, for the thin bar on a card. */
export function watchedFraction(entry: EpisodeProgress | undefined): number {
  if (!entry) return 0;
  if (entry.done) return 1;
  return entry.d > 0 ? Math.min(1, entry.t / entry.d) : 0;
}
