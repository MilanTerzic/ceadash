
-- 1. Hourly market prices (SEEPEX day-ahead etc.)
CREATE TABLE public.market_prices_hourly (
  id BIGSERIAL PRIMARY KEY,
  datetime TIMESTAMPTZ NOT NULL,
  market TEXT NOT NULL DEFAULT 'SEEPEX_DA',
  price_eur_mwh NUMERIC NOT NULL,
  volume_mwh NUMERIC,
  source TEXT NOT NULL DEFAULT 'ENTSO-E',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (datetime, market)
);
CREATE INDEX idx_mph_datetime ON public.market_prices_hourly(datetime);
GRANT SELECT ON public.market_prices_hourly TO anon, authenticated;
GRANT ALL ON public.market_prices_hourly TO service_role;
ALTER TABLE public.market_prices_hourly ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read market prices" ON public.market_prices_hourly FOR SELECT USING (true);

-- 2. RES generation profiles (hourly, per MW installed)
CREATE TABLE public.res_generation_profiles (
  id BIGSERIAL PRIMARY KEY,
  datetime TIMESTAMPTZ NOT NULL,
  technology TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT 'RS',
  generation_mwh_per_mw NUMERIC NOT NULL,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (datetime, technology, location)
);
CREATE INDEX idx_rgp_datetime ON public.res_generation_profiles(datetime);
GRANT SELECT ON public.res_generation_profiles TO anon, authenticated;
GRANT ALL ON public.res_generation_profiles TO service_role;
ALTER TABLE public.res_generation_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read generation profiles" ON public.res_generation_profiles FOR SELECT USING (true);

-- 3. Aggregated capture price metrics
CREATE TABLE public.capture_price_metrics (
  id BIGSERIAL PRIMARY KEY,
  period DATE NOT NULL,
  technology TEXT NOT NULL,
  baseload_price NUMERIC NOT NULL,
  capture_price NUMERIC NOT NULL,
  capture_rate NUMERIC NOT NULL,
  negative_price_generation_share NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (period, technology)
);
GRANT SELECT ON public.capture_price_metrics TO anon, authenticated;
GRANT ALL ON public.capture_price_metrics TO service_role;
ALTER TABLE public.capture_price_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read capture metrics" ON public.capture_price_metrics FOR SELECT USING (true);

-- 4. News & policy items
CREATE TABLE public.news_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  original_url TEXT NOT NULL,
  summary_en TEXT,
  ai_generated BOOLEAN NOT NULL DEFAULT false,
  region TEXT NOT NULL DEFAULT 'Serbia',
  category TEXT NOT NULL DEFAULT 'Market',
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_news_date ON public.news_items(date DESC);
GRANT SELECT ON public.news_items TO anon, authenticated;
GRANT ALL ON public.news_items TO service_role;
ALTER TABLE public.news_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read news" ON public.news_items FOR SELECT USING (true);
CREATE POLICY "authenticated insert news" ON public.news_items FOR INSERT TO authenticated WITH CHECK (true);

-- 5. Saved calculator scenarios (per user)
CREATE TABLE public.calculator_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  scenario_name TEXT NOT NULL,
  location TEXT,
  capacity_mwp NUMERIC,
  capex_eur_kwp NUMERIC,
  opex_fixed NUMERIC,
  ppa_price NUMERIC,
  merchant_share NUMERIC,
  assumptions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  results_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calculator_scenarios TO authenticated;
GRANT ALL ON public.calculator_scenarios TO service_role;
ALTER TABLE public.calculator_scenarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner read scenarios" ON public.calculator_scenarios FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "owner insert scenarios" ON public.calculator_scenarios FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner update scenarios" ON public.calculator_scenarios FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner delete scenarios" ON public.calculator_scenarios FOR DELETE TO authenticated USING (auth.uid() = user_id);
