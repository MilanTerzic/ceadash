
CREATE TABLE IF NOT EXISTS public.cross_border_flows_hourly (
  id BIGSERIAL PRIMARY KEY,
  datetime TIMESTAMPTZ NOT NULL,
  from_zone TEXT NOT NULL,
  to_zone TEXT NOT NULL,
  flow_mw NUMERIC NOT NULL,
  source TEXT NOT NULL DEFAULT 'ENTSO-E',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (datetime, from_zone, to_zone)
);

GRANT SELECT ON public.cross_border_flows_hourly TO anon, authenticated;
GRANT ALL ON public.cross_border_flows_hourly TO service_role;

ALTER TABLE public.cross_border_flows_hourly ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read cross border flows"
  ON public.cross_border_flows_hourly FOR SELECT
  USING (true);

CREATE INDEX IF NOT EXISTS cbf_zone_time_idx
  ON public.cross_border_flows_hourly (from_zone, to_zone, datetime DESC);

-- Make market_prices_hourly upsertable by (datetime, market)
ALTER TABLE public.market_prices_hourly
  DROP CONSTRAINT IF EXISTS market_prices_hourly_datetime_market_key;
ALTER TABLE public.market_prices_hourly
  ADD CONSTRAINT market_prices_hourly_datetime_market_key
  UNIQUE (datetime, market);
