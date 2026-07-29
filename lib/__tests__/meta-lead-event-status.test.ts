import { describe, expect, it } from "vitest";
import { bucketMetaLeadEventStep } from "@/lib/meta-lead-event-status";
import { META_LEAD_EVENT_STEPS } from "@/lib/server/meta-lead-events-db";

describe("bucketMetaLeadEventStep", () => {
  it("buckets every META_LEAD_EVENT_STEPS value (pipeline + manual-assignment steps)", () => {
    const expected: Record<string, "erro" | "ok" | "novo" | "sem_regra"> = {
      lead_received: "novo",
      meta_tenant_resolved_by_form_rule: "novo",
      graph_data_fetched: "novo",
      graph_fetch_failed: "erro",
      skipped_no_tenant: "erro",
      skipped_no_phone: "erro",
      crm_lead_created: "novo",
      crm_lead_updated: "novo",
      crm_attribution_committed: "novo",
      crm_attribution_failed: "erro",
      crm_lead_failed: "erro",
      form_fields_saved: "novo",
      agent_resolved: "novo",
      skipped_no_agent: "erro",
      skipped_no_evolution: "erro",
      conversation_state_created: "novo",
      ai_response_generated: "novo",
      whatsapp_sent: "ok",
      whatsapp_failed: "erro",
      skipped_duplicate: "ok",
      skipped_initial_outreach: "erro",
      skipped_human_attending: "ok",
      blocked_unauthorized_form: "erro",
      blocked_form_not_registered_in_lead_rules: "sem_regra",
      blocked_ambiguous_meta_page_form_tenant: "erro",
      blocked_missing_meta_connection_for_resolved_tenant: "erro",
      blocked_lead_quota_exhausted: "erro",
      blocked_lead_quota_unavailable: "erro",
      blocked_historical_lead: "erro",
      automation_blocked_by_journey: "erro",
      automation_blocked_agent_missing_instructions: "erro",
      manual_assigned_to_agent: "ok",
      manual_assignment_failed: "erro",
      manual_assigned_to_human: "ok",
      skipped_selected_connection_unavailable: "erro",
      selected_connection_reconciled: "novo",
      cloud_to_evolution_fallback: "novo",
    };

    for (const step of META_LEAD_EVENT_STEPS) {
      expect(bucketMetaLeadEventStep(step)).toBe(expected[step]);
    }
    expect(Object.keys(expected).sort()).toEqual([...META_LEAD_EVENT_STEPS].sort());
  });

  it("defaults unknown steps to novo (fail-open toward visible/processing, never silently erro)", () => {
    expect(bucketMetaLeadEventStep("some_future_step_not_yet_mapped")).toBe("novo");
  });
});
