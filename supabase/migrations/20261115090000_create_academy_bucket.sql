-- Public storage bucket for Power Academy videos.
--
-- Videos are large and must outlive any single deployment, so they live in Storage and are
-- served from its public CDN URL (see "mediaBase" in public/academy/catalog.json).
-- Files are uploaded by maintainers in the Supabase dashboard; the app only reads them.
-- Public buckets serve objects without row-level policies, so none are added here:
-- nobody can list or write through the public API.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'academy',
  'academy',
  true,
  524288000, -- 500 MB per file
  array['video/mp4', 'video/webm', 'text/vtt', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
