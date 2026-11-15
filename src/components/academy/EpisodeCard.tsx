import { Link } from "@tanstack/react-router";
import { CheckCircle2, GraduationCap, Play } from "lucide-react";

import {
  formatDuration,
  localize,
  resolveMedia,
  type AcademyCategory,
  type AcademyEpisode,
} from "@/lib/academy/catalog";
import { watchedFraction, type EpisodeProgress } from "@/lib/academy/progress";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Poster, or a branded tile when an episode has none. */
export function Poster({
  episode,
  mediaBase,
  className,
}: {
  episode: AcademyEpisode;
  mediaBase: string;
  className?: string;
}) {
  const { lang } = useLang();
  const poster = resolveMedia(episode.poster, mediaBase);
  return (
    <div className={cn("relative aspect-video w-full overflow-hidden bg-surface-2", className)}>
      {poster ? (
        <img
          src={poster}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface-2 to-surface p-4 text-center">
          <span className="font-display text-sm font-semibold text-ink-2">
            {localize(episode.title, lang)}
          </span>
        </div>
      )}
      <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/25">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white opacity-90 ring-1 ring-white/30 backdrop-blur-sm transition-transform group-hover:scale-110">
          <Play className="h-4 w-4 translate-x-px fill-current" aria-hidden />
        </span>
      </span>
    </div>
  );
}

export function EpisodeCard({
  episode,
  category,
  mediaBase,
  progress,
  number,
}: {
  episode: AcademyEpisode;
  category?: AcademyCategory;
  mediaBase: string;
  progress?: EpisodeProgress;
  number: number;
}) {
  const { t, lang } = useLang();
  const fraction = watchedFraction(progress);
  const duration = formatDuration(episode.durationSeconds);
  return (
    <Link
      to="/dashboard/academy/$slug"
      params={{ slug: episode.slug }}
      className="group flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-surface transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lg"
    >
      <div className="relative">
        <Poster episode={episode} mediaBase={mediaBase} />
        {fraction > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50" aria-hidden>
            <div className="h-full bg-brand" style={{ width: `${Math.round(fraction * 100)}%` }} />
          </div>
        )}
        {duration && (
          <span className="num absolute bottom-2 right-2 rounded-sm bg-black/70 px-1.5 py-0.5 text-[11px] text-white">
            {duration}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="eyebrow !text-[10px]">
            {t("Episode", "Epizoda")} {number}
          </span>
          {category && <span className="truncate">· {localize(category.title, lang)}</span>}
          {progress?.done && (
            <CheckCircle2
              className="ml-auto h-3.5 w-3.5 shrink-0 text-positive"
              aria-label={t("Watched", "Pogledano")}
            />
          )}
        </div>
        <h3 className="font-display text-[15px] font-semibold leading-snug text-foreground">
          {localize(episode.title, lang)}
        </h3>
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {localize(episode.summary, lang)}
        </p>
      </div>
    </Link>
  );
}

export function AcademyMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-sm bg-brand/15 text-brand",
        className,
      )}
    >
      <GraduationCap className="h-4 w-4" aria-hidden />
    </span>
  );
}
