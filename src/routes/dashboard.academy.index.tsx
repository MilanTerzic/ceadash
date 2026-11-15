import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Play, Search } from "lucide-react";

import { AcademyMark, EpisodeCard, Poster } from "@/components/academy/EpisodeCard";
import { DataState } from "@/components/cea/primitives";
import { formatDuration, isPlayable, libraryNumber, localize } from "@/lib/academy/catalog";
import { useAcademyProgress, watchedFraction } from "@/lib/academy/progress";
import { useAcademyCatalog } from "@/lib/academy/use-academy";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/academy/")({
  head: () => ({
    meta: [
      { title: "Power Academy — CEA Power Intelligence" },
      {
        name: "description",
        content:
          "Short video lessons on how European electricity markets work: day-ahead, intraday, balancing, futures, PPAs and batteries.",
      },
    ],
  }),
  component: AcademyLibrary,
});

function AcademyLibrary() {
  const { t, lang } = useLang();
  const query = useAcademyCatalog();
  const { progress } = useAcademyProgress();
  const [category, setCategory] = useState<string>("all");
  const [search, setSearch] = useState("");

  const catalog = query.data;
  const categoryById = useMemo(
    () => new Map(catalog?.categories.map((item) => [item.id, item])),
    [catalog],
  );

  const visible = useMemo(() => {
    if (!catalog) return [];
    const needle = search.trim().toLowerCase();
    return catalog.episodes.filter((episode) => {
      if (category !== "all" && episode.category !== category) return false;
      if (!needle) return true;
      const text = [
        localize(episode.title, "en"),
        localize(episode.title, "sr"),
        localize(episode.summary, lang),
        ...episode.topics,
      ]
        .join(" ")
        .toLowerCase();
      return needle.split(/\s+/).every((word) => text.includes(word));
    });
  }, [catalog, category, search, lang]);

  // Featured: the episode being watched, else the first one not yet finished, else the first.
  const featured = useMemo(() => {
    const playable = catalog?.episodes.filter(isPlayable) ?? [];
    if (!playable.length) return null;
    const started = playable
      .filter((episode) => (progress[episode.slug]?.t ?? 0) > 5 && !progress[episode.slug]?.done)
      .sort((a, b) => (progress[b.slug]?.at ?? 0) - (progress[a.slug]?.at ?? 0))[0];
    return started ?? playable.find((episode) => !progress[episode.slug]?.done) ?? playable[0];
  }, [catalog, progress]);

  const usedCategories = useMemo(() => {
    if (!catalog) return [];
    const ids = new Set(catalog.episodes.map((episode) => episode.category));
    return catalog.categories.filter((item) => ids.has(item.id));
  }, [catalog]);

  const grouped = useMemo(() => {
    const groups = new Map<string, typeof visible>();
    for (const episode of visible) {
      groups.set(episode.category, [...(groups.get(episode.category) ?? []), episode]);
    }
    return catalog?.categories
      .filter((item) => groups.has(item.id))
      .map((item) => ({ category: item, episodes: groups.get(item.id)! }));
  }, [catalog, visible]);

  if (query.isLoading) {
    return <DataState loading height={256} />;
  }
  if (!catalog || query.isError) {
    return (
      <DataState
        state="error"
        height={256}
        title={t(
          "The Power Academy catalogue could not be loaded.",
          "Katalog Power Academy nije mogao da se učita.",
        )}
      >
        {t("Try again in a moment.", "Pokušajte ponovo za trenutak.")}
      </DataState>
    );
  }

  const available = catalog.episodes.filter(isPlayable).length;
  const upcoming = catalog.episodes.length - available;
  const featuredProgress = featured ? progress[featured.slug] : undefined;
  const featuredFraction = watchedFraction(featuredProgress);
  const resuming = featured && (featuredProgress?.t ?? 0) > 5 && !featuredProgress?.done;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-start gap-3">
          <AcademyMark className="mt-1 h-9 w-9" />
          <div>
            <p className="eyebrow">Power Academy</p>
            <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              {t("Learn how power markets work", "Naučite kako rade tržišta električne energije")}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {t(
                "Short video lessons that explain the markets behind the numbers in this dashboard.",
                "Kratke video lekcije koje objašnjavaju tržišta iza brojeva u ovom dashboardu.",
              )}
            </p>
          </div>
        </div>
        <p className="num text-xs text-muted-foreground">
          {available === 0
            ? `${upcoming} ${t("episodes coming soon", "epizoda uskoro")}`
            : `${available} ${available === 1 ? t("episode", "epizoda") : t("episodes", "epizoda")}${
                upcoming > 0 ? ` · ${upcoming} ${t("coming soon", "uskoro")}` : ""
              }`}
        </p>
      </header>

      {catalog.episodes.length === 0 ? (
        <DataState
          state="empty"
          height={192}
          title={t("No episodes have been published yet.", "Još nema objavljenih epizoda.")}
        >
          {t("New lessons will appear here.", "Nove lekcije će se pojaviti ovde.")}
        </DataState>
      ) : (
        <>
          {featured && (
            <Link
              to="/dashboard/academy/$slug"
              params={{ slug: featured.slug }}
              className="group grid overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-border-strong lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]"
            >
              <div className="relative">
                <Poster
                  episode={featured}
                  mediaBase={catalog.mediaBase}
                  className="lg:h-full lg:aspect-auto lg:min-h-72"
                />
                {featuredFraction > 0 && (
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50" aria-hidden>
                    <div
                      className="h-full bg-brand"
                      style={{ width: `${Math.round(featuredFraction * 100)}%` }}
                    />
                  </div>
                )}
              </div>
              <div className="flex flex-col justify-center gap-3 p-5 sm:p-7">
                <p className="eyebrow !text-brand">
                  {resuming
                    ? t("Continue watching", "Nastavite gledanje")
                    : t("Start here", "Počnite ovde")}
                  <span className="text-muted-foreground">
                    {" · "}
                    {t("Episode", "Epizoda")} {libraryNumber(catalog, featured.slug)}
                  </span>
                </p>
                <h2 className="font-display text-xl font-semibold leading-tight tracking-tight sm:text-2xl">
                  {localize(featured.title, lang)}
                </h2>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {localize(featured.summary, lang)}
                </p>
                <div className="mt-1 flex items-center gap-3">
                  <span className="inline-flex h-9 items-center gap-2 rounded-sm bg-brand px-4 text-sm font-semibold text-primary-foreground transition-opacity group-hover:opacity-90">
                    <Play className="h-3.5 w-3.5 fill-current" aria-hidden />
                    {resuming ? t("Resume", "Nastavi") : t("Watch now", "Gledaj")}
                  </span>
                  {formatDuration(featured.durationSeconds) && (
                    <span className="num text-xs text-muted-foreground">
                      {formatDuration(featured.durationSeconds)}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div
              className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]"
              role="group"
              aria-label={t("Categories", "Kategorije")}
            >
              {[
                { id: "all", label: t("All", "Sve") },
                ...usedCategories.map((item) => ({
                  id: item.id,
                  label: localize(item.title, lang),
                })),
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={category === item.id}
                  onClick={() => setCategory(item.id)}
                  className={cn(
                    "h-8 shrink-0 rounded-full border px-3.5 font-condensed text-[13px] font-medium tracking-wide transition-colors",
                    category === item.id
                      ? "border-brand bg-brand/10 text-foreground"
                      : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <label className="relative w-full sm:w-60">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("Search episodes", "Pretraži epizode")}
                aria-label={t("Search episodes", "Pretraži epizode")}
                className="h-8 w-full rounded-sm border border-input bg-background pl-8 pr-2 text-xs"
              />
            </label>
          </div>

          {visible.length === 0 ? (
            <DataState
              state="empty"
              height={160}
              title={t("No episodes match.", "Nijedna epizoda ne odgovara.")}
            >
              {t("Try another category or search term.", "Probajte drugu kategoriju ili pojam.")}
            </DataState>
          ) : (
            <div className="space-y-8">
              {grouped?.map(({ category: group, episodes }) => (
                <section key={group.id} aria-labelledby={`cat-${group.id}`}>
                  <div className="mb-3 flex items-baseline justify-between gap-3">
                    <div>
                      <h2 id={`cat-${group.id}`} className="font-display text-base font-semibold">
                        {localize(group.title, lang)}
                      </h2>
                      {group.description && (
                        <p className="text-xs text-muted-foreground">
                          {localize(group.description, lang)}
                        </p>
                      )}
                    </div>
                    <span className="num text-[11px] text-muted-foreground">{episodes.length}</span>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {episodes.map((episode) => (
                      <EpisodeCard
                        key={episode.slug}
                        episode={episode}
                        category={categoryById.get(episode.category)}
                        mediaBase={catalog.mediaBase}
                        progress={progress[episode.slug]}
                        number={libraryNumber(catalog, episode.slug)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <ArrowRight className="h-3 w-3" aria-hidden />
        {t(
          "Educational content, not trading or investment advice. Watch progress is saved in this browser only.",
          "Edukativni sadržaj, nije trgovački ni investicioni savet. Napredak gledanja se čuva samo u ovom pretraživaču.",
        )}
      </p>
    </div>
  );
}
