-- Allow deleting lead_distribution_rules without FK violations on leads.
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_rule_id_fkey;
ALTER TABLE leads
  ADD CONSTRAINT leads_rule_id_fkey
  FOREIGN KEY (rule_id) REFERENCES lead_distribution_rules(id) ON DELETE SET NULL;

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_campaign_rule_id_fkey;
ALTER TABLE leads
  ADD CONSTRAINT leads_campaign_rule_id_fkey
  FOREIGN KEY (campaign_rule_id) REFERENCES lead_distribution_rules(id) ON DELETE SET NULL;
