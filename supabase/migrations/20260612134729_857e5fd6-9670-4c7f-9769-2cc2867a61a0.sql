
CREATE TABLE public.weekly_report_used_news (
  url TEXT PRIMARY KEY,
  title TEXT,
  used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  week_iso TEXT NOT NULL
);
GRANT SELECT ON public.weekly_report_used_news TO authenticated;
GRANT ALL ON public.weekly_report_used_news TO service_role;
ALTER TABLE public.weekly_report_used_news ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can read used news" ON public.weekly_report_used_news FOR SELECT TO authenticated USING (true);
