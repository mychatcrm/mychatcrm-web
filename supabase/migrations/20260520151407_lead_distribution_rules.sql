CREATE TABLE IF NOT EXISTS lead_distribution_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  name text NOT NULL,
  source text NOT NULL,
  order_index integer NOT NULL DEFAULT 999,
  active boolean NOT NULL DEFAULT true,
  redistribution boolean NOT NULL DEFAULT false,
  distribution_type text NOT NULL,
  agent_ids jsonb NOT NULL DEFAULT '[]',
  employee_ids jsonb NOT NULL DEFAULT '[]',
  mappings jsonb NOT NULL DEFAULT '[]',
  page_label text,
  page_id text,
  use_all_forms boolean DEFAULT true,
  excluded_form_ids jsonb DEFAULT '[]',
  included_form_ids jsonb DEFAULT '[]',
  conversion_send_enabled boolean DEFAULT false,
  conversion_pixel_id text,
  conversion_api_secret text,
  redistribution_config jsonb DEFAULT '{}',
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_distribution_rules_tenant
  ON lead_distribution_rules(tenant_id);

CREATE INDEX IF NOT EXISTS idx_lead_distribution_rules_order
  ON lead_distribution_rules(tenant_id, order_index);

ALTER TABLE lead_distribution_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON lead_distribution_rules;
CREATE POLICY "tenant_isolation" ON lead_distribution_rules
  USING (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lead_distribution_rules TO service_role;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS rule_id uuid REFERENCES lead_distribution_rules(id);
