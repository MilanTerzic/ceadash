CREATE TABLE public.api_cache (
  key text PRIMARY KEY,
  payload jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  ttl_seconds integer NOT NULL DEFAULT 3600
);

GRANT ALL ON public.api_cache TO service_role;

ALTER TABLE public.api_cache ENABLE ROW LEVEL SECURITY;