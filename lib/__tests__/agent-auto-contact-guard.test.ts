import { describe, expect, it } from "vitest";
import {
  canAgentAutoContactLead,
  evaluateCanAgentAutoContactLeadSnapshot,
} from "@/lib/server/agent-auto-contact-guard";
import type { MetaFormAuthRule } from "@/lib/server/meta-form-authorization";

const PAGE = "107104725336342";
const AUTHORIZED_FORM = "1297080185846833";
const OTHER_FORM = "1319582566784094";
const AGENT = "ag-max-vendas";
const CONNECTION = "connection-1";

function rule(overrides: Partial<MetaFormAuthRule> = {}): MetaFormAuthRule {
  return {
    id: "rule-1",
    page_id: PAGE,
    use_all_forms: false,
    included_form_ids: [AUTHORIZED_FORM],
    excluded_form_ids: [],
    distribution_type: "automation_agent",
    agent_ids: [AGENT],
    order_index: 0,
    ...overrides,
  };
}

describe("agent auto contact guard", () => {
  it("allows an explicitly authorized Meta form", () => {
    const result = evaluateCanAgentAutoContactLeadSnapshot({
      agentActive: true,
      agentId: AGENT,
      leadSource: "lead_ads",
      triggerSource: "meta_lead_ingest",
      pageId: PAGE,
      formId: AUTHORIZED_FORM,
      rules: [rule()],
    });

    expect(result.ok).toBe(true);
  });

  it("blocks Meta form not explicitly authorized for the agent", () => {
    const result = evaluateCanAgentAutoContactLeadSnapshot({
      agentActive: true,
      agentId: AGENT,
      leadSource: "lead_ads",
      triggerSource: "meta_lead_ingest",
      pageId: PAGE,
      formId: OTHER_FORM,
      rules: [rule()],
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "blocked_unauthorized_form",
      formId: OTHER_FORM,
    });
  });

  it("blocks follow-up for a Lead Ads lead when the form was later unmarked", () => {
    const result = evaluateCanAgentAutoContactLeadSnapshot({
      agentActive: true,
      agentId: AGENT,
      leadSource: "lead_ads",
      triggerSource: "follow_up_job",
      pageId: PAGE,
      formId: OTHER_FORM,
      rules: [rule()],
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("blocked_unauthorized_form");
  });

  it("blocks campaign_agent_id reuse without current form authorization", () => {
    const result = evaluateCanAgentAutoContactLeadSnapshot({
      agentActive: true,
      agentId: AGENT,
      leadSource: "lead_ads",
      triggerSource: "evolution_agent_resolve_campaign",
      pageId: PAGE,
      formId: OTHER_FORM,
      rules: [rule()],
    });

    expect(result.ok).toBe(false);
  });

  it("blocks all automatic contact when the agent is inactive", () => {
    const result = evaluateCanAgentAutoContactLeadSnapshot({
      agentActive: false,
      agentId: AGENT,
      leadSource: "lead_ads",
      triggerSource: "meta_lead_ingest",
      pageId: PAGE,
      formId: AUTHORIZED_FORM,
      rules: [rule()],
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("agent_inactive");
  });

  it("does not block organic follow-up without Meta lead context", () => {
    const result = evaluateCanAgentAutoContactLeadSnapshot({
      agentActive: true,
      agentId: AGENT,
      leadSource: "whatsapp",
      triggerSource: "follow_up_job",
      rules: [],
    });

    expect(result.ok).toBe(true);
  });

  it("blocks direct WhatsApp automation without an explicit organic rule", async () => {
    const sb = fakeGuardSupabase({ organicRules: [] });

    const result = await canAgentAutoContactLead({
      sb,
      tenantId: "tenant-1",
      agentId: AGENT,
      leadId: "lead-1",
      phone: "5562999999999@s.whatsapp.net",
      triggerSource: "follow_up_job",
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("blocked_no_direct_whatsapp_rule");
  });

  it("allows direct WhatsApp automation with an explicit organic rule", async () => {
    const sb = fakeGuardSupabase({
      organicRules: [
        {
          id: "organic-rule",
          distribution_type: "automation_agent",
          agent_ids: [AGENT],
          order_index: 0,
          connection_id: CONNECTION,
        },
      ],
    });

    const result = await canAgentAutoContactLead({
      sb,
      tenantId: "tenant-1",
      agentId: AGENT,
      leadId: "lead-1",
      phone: "5562999999999@s.whatsapp.net",
      connectionId: CONNECTION,
      triggerSource: "evolution_inbound_auto_reply",
    });

    expect(result.ok).toBe(true);
  });
});

function fakeGuardSupabase(params: {
  organicRules: Array<{
    id: string;
    distribution_type: string;
    agent_ids: string[];
    order_index: number;
    connection_id?: string | null;
  }>;
}) {
  return {
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () =>
          Promise.resolve({
            data: table === "lead_distribution_rules" ? params.organicRules : [],
            error: null,
          }),
        maybeSingle: () => {
          if (table === "tenant_agents") {
            return Promise.resolve({
              data: { active: true, metadata: { status: "ativo" } },
              error: null,
            });
          }
          if (table === "leads") {
            return Promise.resolve({
              data: {
                id: "lead-1",
                source: "whatsapp",
                phone: "5562999999999",
                profile_metadata: {},
              },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  } as never;
}
