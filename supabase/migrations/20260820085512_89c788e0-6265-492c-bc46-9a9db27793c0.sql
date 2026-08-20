DROP POLICY IF EXISTS "Anyone authenticated can read used news" ON public.weekly_report_used_news;
REVOKE SELECT ON public.weekly_report_used_news FROM authenticated;
GRANT ALL ON public.weekly_report_used_news TO service_role;