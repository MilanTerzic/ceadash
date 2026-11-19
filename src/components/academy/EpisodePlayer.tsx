import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, RotateCcw, TriangleAlert } from "lucide-react";

import { useAvailableSubtitles } from "@/lib/academy/use-academy";
import {
  localize,
  resolveMedia,
  videoMimeType,
  type AcademyEpisode,
  type SubtitleTrack,
} from "@/lib/academy/catalog";
import { useAcademyProgress } from "@/lib/academy/progress";
import { useLang } from "@/lib/i18n";

const SAVE_EVERY_MS = 4000;

function clock(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Native HTML5 player: the browser's own controls, captions menu, picture-in-picture and
 * fullscreen. This component adds resume, a missing-file state and the up-next hand-off.
 */
export function EpisodePlayer({
  episode,
  mediaBase,
  next,
}: {
  episode: AcademyEpisode;
  mediaBase: string;
  next: AcademyEpisode | null;
}) {
  const { t, lang } = useLang();
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSaved = useRef(0);
  const { progress, record, clear } = useAcademyProgress();
  const [failed, setFailed] = useState(false);
  const [ended, setEnded] = useState(false);
  const [resumedAt, setResumedAt] = useState<number | null>(null);

  const serbian = lang === "sr" && Boolean(episode.videoSr);
  const src = resolveMedia(serbian ? episode.videoSr : episode.video, mediaBase) ?? "";
  const poster = resolveMedia(serbian && episode.posterSr ? episode.posterSr : episode.poster, mediaBase);
  const tracks = episode.subtitles.map((track) => ({
    ...track,
    src: resolveMedia(track.src, mediaBase) ?? track.src,
  }));
  const available = useAvailableSubtitles(tracks).data ?? [];
  const shownTracks: SubtitleTrack[] = tracks.filter((track) => available.includes(track.src));

  // A different episode starts with a clean player state.
  useEffect(() => {
    setFailed(false);
    setEnded(false);
    setResumedAt(null);
    lastSaved.current = 0;
  }, [episode.slug, src]);

  // Keep the last position when leaving mid-video.
  useEffect(() => {
    const video = videoRef.current;
    return () => {
      if (video && video.duration > 0 && !video.ended) {
        record(episode.slug, video.currentTime, video.duration);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode.slug]);

  const saved = progress[episode.slug];

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-black shadow-[var(--shadow-pop,0_12px_40px_-12px_rgba(0,0,0,0.6))]">
      <div className="relative aspect-video w-full bg-black">
        {failed ? (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-cover bg-center p-6 text-center"
            style={
              poster
                ? {
                    backgroundImage: `linear-gradient(rgba(8,10,12,.82), rgba(8,10,12,.82)), url(${poster})`,
                  }
                : undefined
            }
            role="status"
          >
            <TriangleAlert className="h-7 w-7 text-warning" aria-hidden />
            <p className="font-display text-base font-semibold text-white">
              {t(
                "This episode's video is not available yet",
                "Video ove epizode još nije dostupan",
              )}
            </p>
            <p className="max-w-md text-xs leading-relaxed text-white/70">
              {t(
                "The catalogue lists the episode, but the video file could not be loaded. It may not have been uploaded yet.",
                "Katalog navodi epizodu, ali video fajl nije mogao da se učita. Moguće da još nije otpremljen.",
              )}
            </p>
          </div>
        ) : (
          <video
            ref={videoRef}
            key={`${episode.slug}-${serbian ? "sr" : "en"}`}
            className="absolute inset-0 h-full w-full bg-black"
            controls
            playsInline
            preload="metadata"
            crossOrigin="anonymous"
            poster={poster}
            aria-label={localize(episode.title, lang)}
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              const at = saved?.t ?? 0;
              if (at > 5 && video.duration - at > 10) {
                video.currentTime = at;
                setResumedAt(at);
              }
            }}
            onTimeUpdate={(event) => {
              const video = event.currentTarget;
              const now = Date.now();
              if (now - lastSaved.current > SAVE_EVERY_MS && video.duration > 0) {
                lastSaved.current = now;
                record(episode.slug, video.currentTime, video.duration);
              }
            }}
            onPlay={() => setEnded(false)}
            onEnded={(event) => {
              record(
                episode.slug,
                event.currentTarget.duration,
                event.currentTarget.duration,
                true,
              );
              setEnded(true);
            }}
          >
            <source src={src} type={videoMimeType(src)} onError={() => setFailed(true)} />
            {shownTracks.map((track) => (
              <track
                key={track.src}
                kind="subtitles"
                src={track.src}
                srcLang={track.lang}
                label={track.label}
                default={track.default}
              />
            ))}
          </video>
        )}

        {ended && !failed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80 p-6 text-center backdrop-blur-sm">
            <p className="eyebrow !text-white/60">{t("Episode complete", "Epizoda završena")}</p>
            {next ? (
              <>
                <p className="max-w-lg font-display text-lg font-semibold text-white">
                  {t("Up next: ", "Sledeće: ")}
                  {localize(next.title, lang)}
                </p>
                <Link
                  to="/dashboard/academy/$slug"
                  params={{ slug: next.slug }}
                  className="inline-flex h-9 items-center gap-2 rounded-sm bg-brand px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
                >
                  {t("Play next episode", "Pusti sledeću epizodu")}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </>
            ) : (
              <p className="max-w-md text-sm text-white/75">
                {t("You have reached the latest episode.", "Stigli ste do poslednje epizode.")}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                const video = videoRef.current;
                if (!video) return;
                video.currentTime = 0;
                void video.play();
              }}
              className="inline-flex items-center gap-1.5 text-xs text-white/70 hover:text-white"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              {t("Watch again", "Pogledaj ponovo")}
            </button>
          </div>
        )}
      </div>

      {resumedAt !== null && !failed && !ended && (
        <div className="flex items-center justify-between gap-3 border-t border-white/10 bg-[#0d1013] px-3 py-1.5 text-xs text-white/70">
          <span>
            {t("Resumed from ", "Nastavljeno od ")}
            <span className="num text-white">{clock(resumedAt)}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              const video = videoRef.current;
              if (video) video.currentTime = 0;
              clear(episode.slug);
              setResumedAt(null);
            }}
            className="text-brand hover:underline"
          >
            {t("Start over", "Počni ispočetka")}
          </button>
        </div>
      )}
    </div>
  );
}
