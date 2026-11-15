import { useQuery } from "@tanstack/react-query";

import { parseCatalog, type AcademyCatalog } from "./catalog";

export const CATALOG_URL = "/academy/catalog.json";

async function loadCatalog(): Promise<AcademyCatalog> {
  const response = await fetch(CATALOG_URL, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`catalog ${response.status}`);
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("text/html")) throw new Error("catalog not found");
  const catalog = parseCatalog(await response.json());
  for (const item of catalog.rejected) {
    console.warn(`[academy] skipped catalog entry ${item.slug ?? item.index}: ${item.reason}`);
  }
  return catalog;
}

/** The catalogue is a static file, so it is fetched once and refreshed on a long interval. */
export function useAcademyCatalog() {
  return useQuery({
    queryKey: ["academy", "catalog"],
    queryFn: loadCatalog,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

/** Subtitle files that really exist. A missing file is skipped, never offered as an empty track. */
export function useAvailableSubtitles(tracks: Array<{ src: string }>) {
  const key = tracks.map((track) => track.src).join("|");
  return useQuery({
    queryKey: ["academy", "subtitles", key],
    enabled: tracks.length > 0,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const found = await Promise.all(
        tracks.map(async (track) => {
          try {
            const response = await fetch(track.src);
            if (!response.ok) return false;
            // A missing file can fall back to an HTML page; a real caption file starts with WEBVTT.
            return (await response.text()).trimStart().startsWith("WEBVTT");
          } catch {
            return false;
          }
        }),
      );
      return tracks.filter((_, index) => found[index]).map((track) => track.src);
    },
  });
}
