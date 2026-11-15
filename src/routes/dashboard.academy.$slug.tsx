import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Captions, CheckCircle2, Clock, Signal } from "lucide-react";

import { EpisodePlayer } from "@/components/academy/EpisodePlayer";
import { Poster } from "@/components/academy/EpisodeCard";
import { DataState, Panel } from "@/components/cea/primitives";
import {
  findEpisode,
  resolveMedia,
  formatDuration,
  isPlayable,
  libraryNumber,
  localize,
  nextEpisode,
  previousEpisode,
} from "@/lib/academy/catalog";
import { useAcademyProgress } from "@/lib/academy/progress";
import { useAcademyCatalog, useAvailableSubtitles } from "@/lib/academy/use-academy";
import { useLang } from "@/lib/i18n";

export const Route = createFileRoute("/dashboard/academy/$slug")({
  head: () => ({ meta: [{ title: "Power Academy — CEA Power Intelligence" }] }),
  component: AcademyEpisodePage,
});

const LEVELS = {
  beginner: { en: "Beginner", sr: "Početni" },
  intermediate: { en: "Intermediate", sr: "Srednji" },
  advanced: { en: "Advanced", sr: "Napredni" },
} as const;

function AcademyEpisodePage() {
  const { slug } = Route.useParams();
  const { t, lang } = useLang();
  const query = useAcademyCatalog();
  const { progress } = useAcademyProgress();
  const catalog = query.data;
  const current = catalog ? findEpisode(catalog, slug) : undefined;
  // Only captions whose files exist are advertised.
  const captionSources = (current?.subtitles ?? []).map((track) => ({
    ...track,
    src: resolveMedia(track.src, catalog?.mediaBase ?? "") ?? track.src,
  }));
  const availableCaptions = useAvailableSubtitles(captionSources).data ?? [];
  const captionLabels = captionSources
    .filter((track) => availableCaptions.includes(track.src))
    .map((track) => track.label);

  if (query.isLoading) return <DataState loading height={320} />;
  if (!catalog || query.isError) {
    return (
      <DataState
        state="error"
        height={320}
        title={t("Could not load the episode.", "Epizoda nije mogla da se učita.")}
      >
        <Link to="/dashboard/academy" className="text-brand hover:underline">
          {t("Back to Power Academy", "Nazad na Power Academy")}
        </Link>
      </DataState>
    );
  }

  const episode = findEpisode(catalog, slug);
  if (!episode) {
    return (
      <DataState
        state="empty"
        height={320}
        title={t("Episode not found", "Epizoda nije pronađena")}
      >
        <Link to="/dashboard/academy" className="text-brand hover:underline">
          {t("Back to Power Academy", "Nazad na Power Academy")}
        </Link>
      </DataState>
    );
  }

  const next = nextEpisode(catalog, episode.slug);
  const previous = previousEpisode(catalog, episode.slug);
  const category = catalog.categories.find((item) => item.id === episode.category);
  const sameCategory = catalog.episodes.filter((item) => item.category === episode.category);
  const duration = formatDuration(episode.durationSeconds);
  const number = libraryNumber(catalog, episode.slug);

  return (
    <div className="space-y-5">
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-2 text-xs text-muted-foreground"
      >
        <Link
          to="/dashboard/academy"
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Power Academy
        </Link>
        {category && <span>/ {localize(category.title, lang)}</span>}
      </nav>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          {isPlayable(episode) ? (
            <EpisodePlayer episode={episode} mediaBase={catalog.mediaBase} next={next} />
          ) : (
            <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-gradient-to-br from-surface-2 to-background">
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
                <p className="eyebrow !text-brand">{t("Coming soon", "Uskoro")}</p>
                <p className="max-w-md font-display text-lg font-semibold text-white">
                  {t("This episode is in production", "Ova epizoda je u produkciji")}
                </p>
                <p className="max-w-md text-xs leading-relaxed text-white/70">
                  {t(
                    "The video has not been published yet. The summary below says what it will cover.",
                    "Video još nije objavljen. Rezime ispod kaže šta će epizoda pokriti.",
                  )}
                </p>
              </div>
            </div>
          )}

          <header className="space-y-3">
            <p className="eyebrow !text-brand">
              {t("Episode", "Epizoda")} {number}
            </p>
            <h1 className="font-display text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
              {localize(episode.title, lang)}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Signal className="h-3.5 w-3.5" aria-hidden />
                {localize(LEVELS[episode.level], lang)}
              </span>
              {duration && (
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" aria-hidden />
                  <span className="num">{duration}</span>
                </span>
              )}
              {captionLabels.length > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <Captions className="h-3.5 w-3.5" aria-hidden />
                  {captionLabels.join(", ")}
                </span>
              )}
              {progress[episode.slug]?.done && (
                <span className="inline-flex items-center gap-1.5 text-positive">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                  {t("Watched", "Pogledano")}
                </span>
              )}
            </div>
            <p className="max-w-3xl whitespace-pre-line text-[15px] leading-relaxed text-ink-2">
              {localize(episode.description, lang)}
            </p>
          </header>

          {episode.learn.length > 0 && (
            <section aria-labelledby="learn-heading" className="space-y-2.5">
              <h2 id="learn-heading" className="eyebrow">
                {isPlayable(episode)
                  ? t("What you will learn", "Šta ćete naučiti")
                  : t("What it will cover", "Šta će pokriti")}
              </h2>
              <ul className="grid gap-2 sm:grid-cols-2">
                {episode.learn.map((point, index) => (
                  <li
                    key={index}
                    className="flex gap-2.5 rounded-md border border-border bg-surface px-3 py-2.5 text-[13px] leading-snug text-ink-2"
                  >
                    <span className="num mt-px shrink-0 text-brand">{index + 1}</span>
                    {localize(point, lang)}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {episode.sources.length > 0 && (
            <section aria-labelledby="sources-heading" className="space-y-2">
              <h2 id="sources-heading" className="eyebrow">
                {t("Sources", "Izvori")}
              </h2>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {episode.sources.map((source) => (
                  <li key={source.url}>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      {source.label}
                    </a>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-muted-foreground">
                {t(
                  "All figures in the examples are illustrative, not market quotations.",
                  "Sve vrednosti u primerima su ilustrativne, nisu tržišni kotiranja.",
                )}
              </p>
            </section>
          )}

          <div className="flex flex-wrap items-stretch gap-3">
            {previous && (
              <Link
                to="/dashboard/academy/$slug"
                params={{ slug: previous.slug }}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-md border border-border bg-surface px-4 py-3 transition-colors hover:border-border-strong sm:flex-none sm:basis-64"
              >
                <ArrowLeft className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0">
                  <span className="eyebrow !text-[10px]">{t("Previous", "Prethodna")}</span>
                  <span className="block truncate text-sm font-medium">
                    {localize(previous.title, lang)}
                  </span>
                </span>
              </Link>
            )}
            {next ? (
              <Link
                to="/dashboard/academy/$slug"
                params={{ slug: next.slug }}
                className="group flex min-w-0 flex-[2] items-center justify-between gap-3 rounded-md border border-brand/50 bg-brand/10 px-4 py-3 transition-colors hover:bg-brand/15"
              >
                <span className="min-w-0">
                  <span className="eyebrow !text-[10px] !text-brand">
                    {t("Next episode", "Sledeća epizoda")}
                  </span>
                  <span className="block truncate text-sm font-semibold">
                    {localize(next.title, lang)}
                  </span>
                </span>
                <ArrowRight
                  className="h-4 w-4 shrink-0 text-brand transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            ) : (
              <div className="flex min-w-0 flex-[2] items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
                {t(
                  "This is the latest episode. More are on the way.",
                  "Ovo je najnovija epizoda. Uskoro stižu nove.",
                )}
                <Link to="/dashboard/academy" className="shrink-0 text-brand hover:underline">
                  {t("All episodes", "Sve epizode")}
                </Link>
              </div>
            )}
          </div>
        </div>

        <aside className="min-w-0 space-y-4">
          {sameCategory.length > 1 && (
            <Panel
              title={
                category
                  ? localize(category.title, lang)
                  : t("In this category", "U ovoj kategoriji")
              }
            >
              <ul className="grid gap-2">
                {sameCategory.map((item) => (
                  <li key={item.slug}>
                    <Link
                      to="/dashboard/academy/$slug"
                      params={{ slug: item.slug }}
                      aria-current={item.slug === episode.slug ? "page" : undefined}
                      className="group flex items-center gap-3 rounded-sm p-1 transition-colors hover:bg-surface-2 aria-[current=page]:bg-surface-2"
                    >
                      <Poster
                        episode={item}
                        mediaBase={catalog.mediaBase}
                        soon={!isPlayable(item)}
                        showTitle={false}
                        className="w-24 shrink-0 rounded-sm"
                      />
                      <span className="min-w-0 text-[13px] font-medium leading-snug">
                        {localize(item.title, lang)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}
