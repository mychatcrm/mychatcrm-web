-- Remove meta_form_agent_mapping rows not backed by an active explicit meta_form rule.
-- Logs rows before delete (visible in migration output via RAISE NOTICE).

DO $$
DECLARE
  rec RECORD;
  removed_count int := 0;
BEGIN
  FOR rec IN
    SELECT m.tenant_id, m.form_id, m.agent_id
    FROM public.meta_form_agent_mapping m
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.lead_distribution_rules r
      WHERE r.tenant_id = m.tenant_id
        AND r.source = 'meta_form'
        AND r.active = true
        AND COALESCE(r.use_all_forms, false) = false
        AND r.included_form_ids @> to_jsonb(m.form_id)
        AND r.agent_ids @> to_jsonb(m.agent_id)
    )
  LOOP
    RAISE NOTICE 'Removing orphan meta_form_agent_mapping tenant=% form=% agent=%',
      rec.tenant_id, rec.form_id, rec.agent_id;
    DELETE FROM public.meta_form_agent_mapping
    WHERE tenant_id = rec.tenant_id
      AND form_id = rec.form_id;
    removed_count := removed_count + 1;
  END LOOP;

  RAISE NOTICE 'meta_form_agent_mapping orphan cleanup complete: removed % row(s)', removed_count;
END $$;
