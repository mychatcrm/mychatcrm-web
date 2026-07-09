export type MetaLeadEventBucket = "erro" | "ok" | "novo";

/** current_step é sempre a última etapa (MetaLeadEventRecorder.step sobrescreve a cada chamada). */
export const META_LEAD_EVENT_ERROR_STEPS = new Set<string>([
  "graph_fetch_failed",
  "skipped_no_tenant",
  "skipped_no_phone",
  "crm_lead_failed",
  "crm_attribution_failed",
  "skipped_no_agent",
  "skipped_no_evolution",
  "whatsapp_failed",
  "skipped_initial_outreach",
  "blocked_unauthorized_form",
  "blocked_form_not_registered_in_lead_rules",
  "blocked_ambiguous_meta_page_form_tenant",
  "blocked_missing_meta_connection_for_resolved_tenant",
  "blocked_historical_lead",
  "automation_blocked_by_journey",
  "manual_assignment_failed",
]);

export const META_LEAD_EVENT_OK_STEPS = new Set<string>([
  "whatsapp_sent",
  "skipped_duplicate",
  "skipped_human_attending",
  "manual_assigned_to_agent",
  "manual_assigned_to_human",
]);

export function bucketMetaLeadEventStep(step: string): MetaLeadEventBucket {
  if (META_LEAD_EVENT_ERROR_STEPS.has(step)) return "erro";
  if (META_LEAD_EVENT_OK_STEPS.has(step)) return "ok";
  return "novo";
}
