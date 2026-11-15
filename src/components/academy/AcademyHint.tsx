import { Link } from "@tanstack/react-router";
import { ArrowRight, GraduationCap } from "lucide-react";

import { episodesForTopics, libraryNumber, localize } from "@/lib/academy/catalog";
import { useAcademyCatalog } from "@/lib/academy/use-academy";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * A slim "learn more" strip for analytics pages. Episodes tagged with one of `topics` are
 * offered; until one exists, the foundational episode is offered as "Start here".
 * Renders nothing while loading, on failure, or when the library is empty.
 */
export function AcademyHint({ topics, className }: { topics: string[]; className?: string }) {
  const { t, lang } = useLang();
  const catalog = useAcademyCatalog().data;
  if (!catalog) return null;
  const { episodes, fallback, upcoming } = episodesForTopics(catalog, topics);
  if (!episodes.length && !upcoming.length) return null;
  const shown = episodes.slice(0, 2);
  const soon = upcoming[0];

  return (
    <aside
      aria-label={t("Power Academy", "Power Academy")}
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border border-border bg-surface px-3 py-2",
        className,
      )}
    >
      <span className="flex items-center gap-2">
        <GraduationCap className="h-4 w-4 text-brand" aria-hidden />
        <span className="eyebrow !text-[10px]">
          {fallback
            ? t("Power Academy · Start here", "Power Academy · Počnite ovde")
            : "Power Academy"}
        </span>
      </span>
      {shown.map((episode) => (
        <Link
          key={episode.slug}
          to="/dashboard/academy/$slug"
          params={{ slug: episode.slug }}
          className="group inline-flex min-w-0 items-center gap-1.5 text-xs text-ink-2 hover:text-foreground"
        >
          <span className="num shrink-0 text-muted-foreground">
            {t("Ep.", "Ep.")} {libraryNumber(catalog, episode.slug)}
          </span>
          <span className="truncate font-medium">{localize(episode.title, lang)}</span>
          <ArrowRight
            className="h-3.5 w-3.5 shrink-0 text-brand transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </Link>
      ))}
      {soon && (
        <Link
          to="/dashboard/academy/$slug"
          params={{ slug: soon.slug }}
          className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <span className="rounded-sm border border-border px-1.5 py-px font-condensed text-[10px] font-semibold uppercase tracking-wider">
            {t("Soon", "Uskoro")}
          </span>
          <span className="truncate">{localize(soon.title, lang)}</span>
        </Link>
      )}
      <Link
        to="/dashboard/academy"
        className="ml-auto text-[11px] text-muted-foreground hover:text-foreground"
      >
        {t("All episodes", "Sve epizode")}
      </Link>
    </aside>
  );
}
