import type { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export const META_LEAD_EVENT_STEPS = [
  "lead_received",
  "meta_tenant_resolved_by_form_rule",
  "graph_data_fetched",
  "graph_fetch_failed",
  "skipped_no_tenant",
  "skipped_no_phone",
  "crm_lead_created",
  "crm_lead_updated",
  "crm_attribution_committed",
  "crm_attribution_failed",
  "crm_lead_failed",
  "form_fields_saved",
  "agent_resolved",
  "skipped_no_agent",
  "skipped_no_evolution",
  "conversation_state_created",
  "ai_response_generated",
  "whatsapp_sent",
  "whatsapp_failed",
  "skipped_duplicate",
  "skipped_initial_outreach",
  "skipped_human_attending",
  "blocked_unauthorized_form",
  "blocked_form_not_registered_in_lead_rules",
  "blocked_ambiguous_meta_page_form_tenant",
  "blocked_missing_meta_connection_for_resolved_tenant",
  "blocked_lead_quota_exhausted",
  "blocked_lead_quota_unavailable",
  "blocked_historical_lead",
  "automation_blocked_by_journey",
  "automation_blocked_agent_missing_instructions",
  "manual_assigned_to_agent",
  "manual_assignment_failed",
  "manual_assigned_to_human",
  "skipped_selected_connection_unavailable",
  "selected_connection_reconciled",
  "cloud_to_evolution_fallback",
] as const;

export type MetaLeadEventStep = (typeof META_LEAD_EVENT_STEPS)[number];

export type MetaLeadEventRow = {
  id: string;
  tenant_id: string;
  leadgen_id: string;
  page_id: string;
  form_id: string | null;
  ad_id: string | null;
  adset_id: string | null;
  lead_id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  form_name: string | null;
  page_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_name: string | null;
  ad_name: string | null;
  agent_id: string | null;
  agent_resolution_source: string | null;
  crm_sync_status: string;
  whatsapp_status: string;
  current_step: string;
  steps_log: Array<{ step: string; at: string; detail?: Record<string, unknown> }>;
  form_fields: unknown;
  profile_metadata: unknown;
  raw_webhook: unknown;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01"]);

function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return Boolean(error?.code && MISSING_TABLE_CODES.has(error.code));
}

export class MetaLeadEventRecorder {
  private eventId: string | null = null;
  private disabled = false;

  constructor(
    private sb: SupabaseServiceClient,
    private base: {
      tenant_id: string;
      leadgen_id: string;
      page_id: string;
      form_id?: string | null;
      ad_id?: string | null;
      adset_id?: string | null;
      raw_webhook?: Record<string, unknown>;
    },
  ) {}

  /**
   * Anexa a um evento já existente (id conhecido) sem passar por init() — init()
   * faz upsert destrutivo (reseta steps_log/current_step/status), o que apagaria
   * o histórico de erro de um evento que já está em curso. Usado pela atribuição
   * manual (direcionar um lead em erro pra um agente/atendente) pra continuar
   * gravando no mesmo steps_log em vez de recomeçar do zero.
   */
  static attachExisting(sb: SupabaseServiceClient, eventId: string): MetaLeadEventRecorder {
    const recorder = new MetaLeadEventRecorder(sb, { tenant_id: "", leadgen_id: "", page_id: "" });
    recorder.eventId = eventId;
    return recorder;
  }

  async init(): Promise<void> {
    const now = new Date().toISOString();
    const { data, error } = await this.sb
      .from("meta_lead_events")
      .upsert(
        {
          tenant_id: this.base.tenant_id,
          leadgen_id: this.base.leadgen_id,
          page_id: this.base.page_id,
          form_id: this.base.form_id ?? null,
          ad_id: this.base.ad_id ?? null,
          adset_id: this.base.adset_id ?? null,
          raw_webhook: this.base.raw_webhook ?? null,
          current_step: "lead_received",
          crm_sync_status: "pending",
          whatsapp_status: "pending",
          steps_log: [{ step: "lead_received", at: now }],
          updated_at: now,
        },
        { onConflict: "tenant_id,leadgen_id" },
      )
      .select("id")
      .maybeSingle();

    if (error) {
      if (isMissingTable(error)) {
        this.disabled = true;
        return;
      }
      console.warn("[meta-lead-events] init failed", { error: error.message });
      this.disabled = true;
      return;
    }
    this.eventId = typeof data?.id === "string" ? data.id : null;
  }

  async step(step: MetaLeadEventStep, detail?: Record<string, unknown>): Promise<void> {
    if (this.disabled || !this.eventId) return;
    const at = new Date().toISOString();
    const { error } = await this.sb.rpc("append_meta_lead_event_step", {
      p_event_id: this.eventId,
      p_step: step,
      p_at: at,
      p_detail: detail ?? null,
    });
    if (error) {
      console.warn("[meta-lead-events] atomic step failed", {
        event_id: this.eventId,
        step,
        error: error.message,
      });
    }
  }

  async patch(fields: Record<string, unknown>): Promise<void> {
    if (this.disabled || !this.eventId) return;
    await this.sb
      .from("meta_lead_events")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", this.eventId);
  }
}
