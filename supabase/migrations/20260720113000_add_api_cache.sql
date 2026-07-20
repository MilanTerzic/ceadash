create table if not exists public.api_cache (
  key text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  ttl_seconds integer not null default 1800 check (ttl_seconds > 0)
);

create index if not exists api_cache_fetched_at_idx
  on public.api_cache (fetched_at desc);

alter table public.api_cache enable row level security;

revoke all on public.api_cache from anon, authenticated;
grant all on public.api_cache to service_role;
