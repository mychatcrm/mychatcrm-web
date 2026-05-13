import { describe, expect, it } from "vitest";
import {
  agentCrmDestinationDbFields,
  normalizeAgentCrmDestination,
  validateAgentCrmDestination,
} from "@/lib/agents/crm-destination";

describe("agent CRM lead destination", () => {
  it("clears destination fields when automatic movement is disabled", () => {
    expect(
      normalizeAgentCrmDestination({
        crmAutoMoveEnabled: false,
        crmTargetFunnelId: "funil-vendas",
        crmTargetColumnId: "proposta",
        crmTargetStatus: "proposta",
      }),
    ).toEqual({
      crmAutoMoveEnabled: false,
      crmTargetFunnelId: null,
      crmTargetColumnId: null,
      crmTargetStatus: null,
    });
  });

  it("requires funnel and column when automatic movement is enabled", () => {
    expect(validateAgentCrmDestination({ crmAutoMoveEnabled: true })).toBe(
      "Escolha um funil em «Destino do lead no CRM».",
    );

    expect(
      validateAgentCrmDestination({
        crmAutoMoveEnabled: true,
        crmTargetFunnelId: "funil-vendas",
      }),
    ).toBe("Escolha uma coluna em «Destino do lead no CRM».");
  });

  it("maps the selected column to the lead status stored by the CRM", () => {
    expect(
      agentCrmDestinationDbFields({
        crmAutoMoveEnabled: true,
        crmTargetFunnelId: "funil-vendas",
        crmTargetColumnId: "negociacao",
      }),
    ).toEqual({
      crm_auto_move_enabled: true,
      crm_target_funnel_id: "funil-vendas",
      crm_target_column_id: "negociacao",
      crm_target_status: "negociacao",
    });
  });
});
