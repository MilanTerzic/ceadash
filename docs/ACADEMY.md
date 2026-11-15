# Power Academy

Video lessons inside the dashboard, at `/dashboard/academy`. Episodes are **data**: adding one
means editing `public/academy/catalog.json` and uploading files. No code changes, no new routes.

## Where things live

| What                             | Where                                      | Why                                         |
| -------------------------------- | ------------------------------------------ | ------------------------------------------- |
| Catalogue (categories, episodes) | `public/academy/catalog.json`              | Static file, ships with each deploy         |
| Posters                          | `public/academy/posters/`                  | Small, same-origin                          |
| Subtitles (`.vtt`)               | `public/academy/subtitles/`                | Small; same-origin avoids CORS on `<track>` |
| **Videos**                       | Supabase Storage bucket `academy` (public) | Large, permanent, served from the CDN       |

Videos are not kept in the repository. Static assets on the deploy target are limited to
25 MiB per file and a lesson video is usually larger, so they go in Storage. The bucket is created
by `supabase/migrations/20261115090000_create_academy_bucket.sql`; apply it once.
A video URL is `<mediaBase>/<video path>`, with `mediaBase` set at the top of the catalogue.

## Add an episode

1. Export the MP4 (H.264/AAC, 1080p or 720p) and the captions as WebVTT. A HeyGen share link
   (`app.heygen.com/videos/...`) is a page, not a file: use its **Download** button, and
   its caption export for the `.vtt`. Do not link the temporary signed URL it gives out; it expires.
2. Upload the video to the `academy` bucket, e.g. `videos/ep02-day-ahead-auction.mp4`
   (Supabase dashboard → Storage → academy). Put the poster and `.vtt` in `public/academy/`.
3. Append to `episodes` in `catalog.json`:

```json
{
  "slug": "day-ahead-auction",
  "number": 1,
  "category": "short-term-markets",
  "level": "beginner",
  "title": { "en": "How the day-ahead auction works", "sr": "Kako radi day-ahead aukcija" },
  "summary": { "en": "One or two sentences for the card.", "sr": "…" },
  "description": { "en": "The full description.", "sr": "…" },
  "video": "videos/ep02-day-ahead-auction.mp4",
  "poster": "/academy/posters/ep02.jpg",
  "durationSeconds": 412,
  "subtitles": [
    { "lang": "en", "label": "English", "src": "/academy/subtitles/ep02.en.vtt", "default": true }
  ],
  "topics": ["day-ahead"],
  "related": ["prices", "borders"]
}
```

4. Run `bun run check:academy`. It validates the catalogue with the same parser the app uses and
   lists missing files. Add `--strict` to fail on missing files, `--remote` to also check the CDN.
5. Deploy.

## Announce an episode before the video exists

Set `"status": "coming-soon"` and leave `video` out. The episode is listed with a "Coming soon"
badge and its page shows the description, `learn` key points and `sources`, with no player.
"Next episode" and the contextual links skip it, except for a small "Soon" pointer on the matching
analytics page. When the video is ready, upload it, add `video` (and `poster`, `subtitles`) and
remove the `status` line (or set `"published"`).

## Field reference

- `slug` unique, lowercase, hyphens. It is the URL: `/dashboard/academy/<slug>`.
- `category` must be an id from `categories`. A new category is just a new entry there.
- `number` orders episodes inside a category. Library order is category order, then number;
  "next episode" follows it across categories.
- `title`, `summary`, `description` are a string or `{ "en", "sr" }` (English is the fallback).
- `video`, `poster`, `subtitles[].src`: an absolute URL or a `/root-path` is used as written;
  anything else is resolved under `mediaBase`.
- `durationSeconds` is optional. Leave it out unless you know it; it is never guessed.
- `topics` drive the "Power Academy" strip on analytics pages (below). `foundational: true`
  offers the episode as "Start here" on pages whose topic has no episode yet.
- `related` lists workspace ids (`prices`, `borders`, `fundamentals`, `forwards`, `ppa`, `bess`, …
  see `src/components/shell/workspaces.ts`) shown as "Apply it in the dashboard".
- `status` is `"published"` (default) or `"coming-soon"`; see above.
- `learn` is a list of key points (string or `{ "en", "sr" }`) shown on the episode page.
- `sources` is a list of `{ "url", "label"? }` public references; the label defaults to the host.
- `draft: true` hides an episode while you prepare it.
- `source` records where the file came from. It is never displayed.

## Contextual links

`<AcademyHint topics={[...]} />` sits at the top of these pages:

| Page                          | Topics                             |
| ----------------------------- | ---------------------------------- |
| Price Analytics (day-ahead)   | `day-ahead`, `intraday`            |
| Forwards & Forecast (futures) | `futures`                          |
| PPA Studio                    | `ppa`, `balancing`                 |
| BESS Lab                      | `battery`, `intraday`, `balancing` |

It lists episodes tagged with any of the page's topics, otherwise the foundational episode. Tag a
new episode `["battery"]` and it appears on BESS Lab by itself. The platform has no intraday or
balancing page yet (those sources are not connected); tag episodes `intraday` / `balancing` and
place `<AcademyHint>` on those pages when they exist.

## Behaviour notes

- Native `<video controls>`: the browser's own play, seek, volume, captions, picture-in-picture and
  fullscreen controls. Captions are only offered when the `.vtt` file exists.
- Watch progress and resume position are stored in this browser only (no accounts).
- If a video cannot be loaded the player says so instead of showing an empty frame.
- Invalid catalogue entries are skipped (and logged) so one typo cannot hide the library.
- The dashboard has no sign-in, so the library is as public as the rest of the app. The Storage
  bucket is public: anyone with a video URL can fetch it.
