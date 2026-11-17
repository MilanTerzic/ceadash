import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, Play } from "lucide-react";

import { AcademyMark } from "@/components/academy/EpisodeCard";
import { DataState } from "@/components/cea/primitives";
import { formatDuration, isPlayable, libraryNumber, localize } from "@/lib/academy/catalog";
import { useAcademyProgress } from "@/lib/academy/progress";
import { useAcademyCatalog } from "@/lib/academy/use-academy";
import { useLang } from "@/lib/i18n";

export const Route = createFileRoute("/dashboard/academy/")({
  head: () => ({
    meta: [
      { title: "Power Academy — CEA Power Intelligence" },
      {
        name: "description",
        content:
          "Short video lessons on how European electricity markets work: day-ahead, intraday, balancing, futures and cross-border trading.",
      },
    ],
  }),
  component: AcademyLibrary,
});

/** The library is one plain numbered list: episode number, name, length. */
function AcademyLibrary() {
  const { t, lang } = useLang();
  const query = useAcademyCatalog();
  const { progress } = useAcademyProgress();

  const catalog = query.data;
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

  const episodes = catalog.episodes.filter(isPlayable);

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <AcademyMark className="mt-1 h-9 w-9" />
        <div>
          <p className="eyebrow">Power Academy</p>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            {t("Episodes", "Epizode")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t(
              "Short video lessons that explain the markets behind the numbers in this dashboard.",
              "Kratke video lekcije koje objašnjavaju tržišta iza brojeva u ovom dashboardu.",
            )}
          </p>
        </div>
      </header>

      {episodes.length === 0 ? (
        <DataState
          state="empty"
          height={192}
          title={t("No episodes have been published yet.", "Još nema objavljenih epizoda.")}
        >
          {t("New lessons will appear here.", "Nove lekcije će se pojaviti ovde.")}
        </DataState>
      ) : (
        <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {episodes.map((episode) => {
            const duration = formatDuration(episode.durationSeconds);
            const watched = progress[episode.slug]?.done;
            return (
              <li key={episode.slug}>
                <Link
                  to="/dashboard/academy/$slug"
                  params={{ slug: episode.slug }}
                  className="group flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-surface-2"
                >
                  <span className="num w-8 shrink-0 text-sm font-semibold text-brand">
                    {libraryNumber(catalog, episode.slug)}
                  </span>
                  <span className="min-w-0 flex-1 font-display text-[15px] font-semibold leading-snug text-foreground">
                    {localize(episode.title, lang)}
                  </span>
                  {watched && (
                    <CheckCircle2
                      className="h-4 w-4 shrink-0 text-positive"
                      aria-label={t("Watched", "Pogledano")}
                    />
                  )}
                  {duration && (
                    <span className="num shrink-0 text-xs text-muted-foreground">{duration}</span>
                  )}
                  <Play
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                    aria-hidden
                  />
                </Link>
              </li>
            );
          })}
        </ol>
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
