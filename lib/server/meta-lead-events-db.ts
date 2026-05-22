import type { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export const META_LEAD_EVENT_STEPS = [
  "lead_received",
  "graph_data_fetched",
  "graph_fetch_failed",
  "skipped_no_tenant",
  "skipped_no_phone",
  "crm_lead_created",
  "crm_lead_updated",
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
    const { data: row } = await this.sb
      .from("meta_lead_events")
      .select("steps_log")
      .eq("id", this.eventId)
      .maybeSingle();
    const prev = Array.isArray(row?.steps_log) ? row.steps_log : [];
    const steps_log = [...prev, { step, at, ...(detail ? { detail } : {}) }];
    await this.sb
      .from("meta_lead_events")
      .update({
        current_step: step,
        steps_log,
        updated_at: at,
        ...(detail?.error_message && typeof detail.error_message === "string"
          ? { error_message: detail.error_message }
          : {}),
      })
      .eq("id", this.eventId);
  }

  async patch(fields: Record<string, unknown>): Promise<void> {
    if (this.disabled || !this.eventId) return;
    await this.sb
      .from("meta_lead_events")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", this.eventId);
  }
}
