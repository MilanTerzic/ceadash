
ALTER TABLE public.news_items ADD COLUMN created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
DROP POLICY IF EXISTS "authenticated insert news" ON public.news_items;
CREATE POLICY "authenticated insert own news" ON public.news_items
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);
