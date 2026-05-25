import { describe, expect, it, vi } from "vitest";
import {
  buildNewLeadCrmFields,
  CRM_KANBAN_STATUS_NOVO,
  promoteLeadToContatoOnAgentEngagement,
} from "@/lib/server/crm-lead-lifecycle";

describe("buildNewLeadCrmFields", () => {
  it("novo lead entra com status novo", () => {
    expect(buildNewLeadCrmFields()).toEqual({ status: CRM_KANBAN_STATUS_NOVO });
  });

  it("preserva funil quando informado", () => {
    expect(buildNewLeadCrmFields("funil-vendas")).toEqual({
      status: CRM_KANBAN_STATUS_NOVO,
      crm_funnel_id: "funil-vendas",
    });
  });
});

describe("promoteLeadToContatoOnAgentEngagement", () => {
  it("ignora leadId vazio", async () => {
    const from = vi.fn();
    const ok = await promoteLeadToContatoOnAgentEngagement({
      sb: { from } as never,
      tenantId: "t1",
      leadId: null,
    });
    expect(ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });
});
