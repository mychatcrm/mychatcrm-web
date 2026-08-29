export type MetaLeadEventBucket = "erro" | "ok" | "novo" | "sem_regra";

/**
 * Formulário/página sem nenhuma regra ativa que autorize. Não é erro — é
 * comum ter campanha/formulário que o operador não quer automatizar de
 * propósito. Fica separado de "erro" pra não sujar a aba que sinaliza
 * problema real de configuração.
 */
export const META_LEAD_EVENT_NO_RULE_STEPS = new Set<string>([
  "blocked_form_not_registered_in_lead_rules",
]);

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
  "blocked_ambiguous_meta_page_form_tenant",
  "blocked_missing_meta_connection_for_resolved_tenant",
  "blocked_lead_quota_exhausted",
  "blocked_lead_quota_unavailable",
  "blocked_historical_lead",
  "automation_blocked_by_journey",
  "automation_blocked_agent_missing_instructions",
  "automation_blocked_ai_generation_failed",
  "skipped_selected_connection_unavailable",
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
  if (META_LEAD_EVENT_NO_RULE_STEPS.has(step)) return "sem_regra";
  if (META_LEAD_EVENT_ERROR_STEPS.has(step)) return "erro";
  if (META_LEAD_EVENT_OK_STEPS.has(step)) return "ok";
  return "novo";
}
