CREATE TABLE public.car_builds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid(),
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.car_builds TO authenticated;
GRANT ALL ON public.car_builds TO service_role;
ALTER TABLE public.car_builds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own builds select" ON public.car_builds FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own builds insert" ON public.car_builds FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own builds update" ON public.car_builds FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own builds delete" ON public.car_builds FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX car_builds_user_idx ON public.car_builds(user_id, created_at);