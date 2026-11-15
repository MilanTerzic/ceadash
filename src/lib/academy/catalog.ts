// Power Academy catalogue: pure data handling, no framework imports.
//
// Episodes live in public/academy/catalog.json. Adding an episode is a data change:
// append an entry there, put the files where it says, deploy. See docs/ACADEMY.md.

export type Lang = "en" | "sr";
/** Plain string (used for every language) or per-language text. */
export type Localized = string | { en: string; sr?: string };

export interface AcademyCategory {
  id: string;
  title: Localized;
  description?: Localized;
  order: number;
}

export interface SubtitleTrack {
  lang: string;
  label: string;
  src: string;
  default?: boolean;
}

export interface AcademyEpisode {
  slug: string;
  /** Order within the category. */
  number: number;
  category: string;
  title: Localized;
  summary: Localized;
  description: Localized;
  /** Absolute URL, root-relative path, or a path under `mediaBase`. */
  video: string;
  poster?: string;
  durationSeconds?: number;
  subtitles: SubtitleTrack[];
  /** Dashboard topics this episode explains; drives the contextual links on analytics pages. */
  topics: string[];
  /** Shown as "Start here" on pages whose topic has no dedicated episode yet. */
  foundational: boolean;
  level: "beginner" | "intermediate" | "advanced";
  /** Workspace ids from the navigation to link to from the episode page. */
  related: string[];
  draft: boolean;
  /** Provenance of the file, kept for the maintainers; never rendered. */
  source?: { type: string; reference?: string };
}

export interface AcademyCatalog {
  mediaBase: string;
  categories: AcademyCategory[];
  episodes: AcademyEpisode[];
  /** Entries that failed validation, with the reason. */
  rejected: Array<{ index: number; slug?: string; reason: string }>;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LEVELS = ["beginner", "intermediate", "advanced"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

function localized(value: unknown): Localized | null {
  if (nonEmpty(value)) return value.trim();
  if (isRecord(value) && nonEmpty(value.en)) {
    return { en: value.en.trim(), sr: nonEmpty(value.sr) ? value.sr.trim() : undefined };
  }
  return null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(nonEmpty).map((item) => item.trim()) : [];
}

export function localize(value: Localized | undefined, lang: Lang): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return lang === "sr" && value.sr ? value.sr : value.en;
}

/** Absolute URLs and root-relative paths are used as written; others sit under `mediaBase`. */
export function resolveMedia(path: string | undefined, mediaBase: string): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path) || path.startsWith("/")) return path;
  const base = mediaBase.replace(/\/+$/, "");
  return base ? `${base}/${path.replace(/^\/+/, "")}` : `/${path}`;
}

function parseSubtitles(value: unknown): SubtitleTrack[] {
  if (!Array.isArray(value)) return [];
  const tracks: SubtitleTrack[] = [];
  for (const item of value) {
    if (!isRecord(item) || !nonEmpty(item.src) || !nonEmpty(item.lang)) continue;
    tracks.push({
      lang: item.lang.trim(),
      label: nonEmpty(item.label) ? item.label.trim() : item.lang.trim(),
      src: item.src.trim(),
      default: item.default === true,
    });
  }
  return tracks;
}

function parseEpisode(raw: unknown): { episode?: AcademyEpisode; reason?: string } {
  if (!isRecord(raw)) return { reason: "not an object" };
  if (!nonEmpty(raw.slug) || !SLUG_RE.test(raw.slug)) {
    return { reason: "slug must be lowercase letters, digits and hyphens" };
  }
  const title = localized(raw.title);
  const description = localized(raw.description);
  if (!title) return { reason: "title is required" };
  if (!description) return { reason: "description is required" };
  if (!nonEmpty(raw.category)) return { reason: "category is required" };
  if (!nonEmpty(raw.video)) return { reason: "video is required" };
  const number = typeof raw.number === "number" && Number.isFinite(raw.number) ? raw.number : 0;
  const duration =
    typeof raw.durationSeconds === "number" && raw.durationSeconds > 0
      ? raw.durationSeconds
      : undefined;
  const level = LEVELS.find((item) => item === raw.level) ?? "beginner";
  const source =
    isRecord(raw.source) && nonEmpty(raw.source.type)
      ? {
          type: raw.source.type,
          reference: nonEmpty(raw.source.reference) ? raw.source.reference : undefined,
        }
      : undefined;
  return {
    episode: {
      slug: raw.slug,
      number,
      category: raw.category.trim(),
      title,
      summary: localized(raw.summary) ?? description,
      description,
      video: raw.video.trim(),
      poster: nonEmpty(raw.poster) ? raw.poster.trim() : undefined,
      durationSeconds: duration,
      subtitles: parseSubtitles(raw.subtitles),
      topics: stringList(raw.topics),
      foundational: raw.foundational === true,
      level,
      related: stringList(raw.related),
      draft: raw.draft === true,
      source,
    },
  };
}

/**
 * Validates the catalogue file. A malformed episode is dropped and reported in
 * `rejected`; the rest of the library still loads. Draft episodes are not listed.
 */
export function parseCatalog(raw: unknown): AcademyCatalog {
  const rejected: AcademyCatalog["rejected"] = [];
  const root = isRecord(raw) ? raw : {};
  const mediaBase = nonEmpty(root.mediaBase) ? root.mediaBase.trim() : "";

  const categories: AcademyCategory[] = [];
  const seenCategories = new Set<string>();
  for (const item of Array.isArray(root.categories) ? root.categories : []) {
    if (!isRecord(item) || !nonEmpty(item.id) || seenCategories.has(item.id)) continue;
    const title = localized(item.title);
    if (!title) continue;
    seenCategories.add(item.id);
    categories.push({
      id: item.id,
      title,
      description: localized(item.description) ?? undefined,
      order: typeof item.order === "number" ? item.order : categories.length + 1,
    });
  }

  const episodes: AcademyEpisode[] = [];
  const seenSlugs = new Set<string>();
  (Array.isArray(root.episodes) ? root.episodes : []).forEach((item, index) => {
    const { episode, reason } = parseEpisode(item);
    const slug = isRecord(item) && typeof item.slug === "string" ? item.slug : undefined;
    if (!episode) return void rejected.push({ index, slug, reason: reason ?? "invalid" });
    if (seenSlugs.has(episode.slug)) {
      return void rejected.push({ index, slug: episode.slug, reason: "duplicate slug" });
    }
    if (!seenCategories.has(episode.category)) {
      return void rejected.push({
        index,
        slug: episode.slug,
        reason: `unknown category "${episode.category}"`,
      });
    }
    seenSlugs.add(episode.slug);
    if (!episode.draft) episodes.push(episode);
  });

  return {
    mediaBase,
    categories: sortCategories(categories),
    episodes: sortEpisodes(episodes, categories),
    rejected,
  };
}

function sortCategories(categories: AcademyCategory[]) {
  return [...categories].sort((a, b) => a.order - b.order);
}

/** Library order: category order, then episode number, then title. */
export function sortEpisodes(episodes: AcademyEpisode[], categories: AcademyCategory[]) {
  const rank = new Map(sortCategories(categories).map((category, index) => [category.id, index]));
  return [...episodes].sort(
    (a, b) =>
      (rank.get(a.category) ?? 0) - (rank.get(b.category) ?? 0) ||
      a.number - b.number ||
      localize(a.title, "en").localeCompare(localize(b.title, "en")),
  );
}

export function findEpisode(catalog: AcademyCatalog, slug: string | undefined) {
  return catalog.episodes.find((episode) => episode.slug === slug);
}

/** The episode after this one in library order, or null at the end. */
export function nextEpisode(catalog: AcademyCatalog, slug: string): AcademyEpisode | null {
  const index = catalog.episodes.findIndex((episode) => episode.slug === slug);
  return index >= 0 ? (catalog.episodes[index + 1] ?? null) : null;
}

export function previousEpisode(catalog: AcademyCatalog, slug: string): AcademyEpisode | null {
  const index = catalog.episodes.findIndex((episode) => episode.slug === slug);
  return index > 0 ? catalog.episodes[index - 1] : null;
}

/** Position of an episode in the whole library, 1-based, for "Episode 3". */
export function libraryNumber(catalog: AcademyCatalog, slug: string): number {
  return catalog.episodes.findIndex((episode) => episode.slug === slug) + 1;
}

export interface TopicMatch {
  episodes: AcademyEpisode[];
  /** True when nothing covers the topic yet and foundational episodes are offered instead. */
  fallback: boolean;
}

/** Episodes for an analytics page: those tagged with its topics, else the foundational ones. */
export function episodesForTopics(catalog: AcademyCatalog, topics: string[]): TopicMatch {
  const wanted = new Set(topics);
  const direct = catalog.episodes.filter((episode) =>
    episode.topics.some((topic) => wanted.has(topic)),
  );
  if (direct.length) return { episodes: direct, fallback: false };
  return { episodes: catalog.episodes.filter((episode) => episode.foundational), fallback: true };
}

export function formatDuration(seconds: number | undefined): string | null {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, "0");
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${rest}`
    : `${minutes}:${rest}`;
}

export function videoMimeType(src: string): string | undefined {
  const clean = src.split(/[?#]/)[0].toLowerCase();
  if (clean.endsWith(".mp4") || clean.endsWith(".m4v")) return "video/mp4";
  if (clean.endsWith(".webm")) return "video/webm";
  if (clean.endsWith(".mov")) return "video/quicktime";
  return undefined;
}
