-- Uso mensal de leads atendidos por tenant (ciclo = mês civil UTC).
-- Acesso apenas via service_role a partir das Route Handlers Next (cookie de sessão verificado).

CREATE TABLE IF NOT EXISTS public.tenant_lead_usage (
  tenant_id   text NOT NULL,
  cycle_month date NOT NULL,
  used_count  integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  bonus_count integer NOT NULL DEFAULT 0 CHECK (bonus_count >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, cycle_month)
);

CREATE INDEX IF NOT EXISTS tenant_lead_usage_tenant_current_idx
  ON public.tenant_lead_usage (tenant_id, cycle_month DESC);

ALTER TABLE public.tenant_lead_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_lead_usage_service_role"
  ON public.tenant_lead_usage
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT ALL ON TABLE public.tenant_lead_usage TO service_role;

-- Incremento atómico (chamar só do backend com service_role).
CREATE OR REPLACE FUNCTION public.increment_tenant_lead_usage(
  p_tenant_id text,
  p_cycle_month date,
  p_delta integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_tenant_id IS NULL OR trim(p_tenant_id) = '' THEN
    RETURN;
  END IF;
  IF p_cycle_month IS NULL THEN
    RETURN;
  END IF;
  IF p_delta IS NULL OR p_delta < 1 THEN
    RETURN;
  END IF;

  INSERT INTO public.tenant_lead_usage (tenant_id, cycle_month, used_count, bonus_count)
  VALUES (p_tenant_id, p_cycle_month, p_delta, 0)
  ON CONFLICT (tenant_id, cycle_month)
  DO UPDATE SET
    used_count = public.tenant_lead_usage.used_count + EXCLUDED.used_count,
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.increment_tenant_lead_usage(text, date, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_tenant_lead_usage(text, date, integer) TO service_role;
