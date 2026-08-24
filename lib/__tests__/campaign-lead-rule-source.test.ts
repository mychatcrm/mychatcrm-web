import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CAMPAIGN_WHATSAPP_SOURCE,
  sourceLabel,
} from "@/lib/lead-distribution-rules";
import {
  isValidLeadRuleSource,
  leadRuleClientToDbPayload,
} from "@/lib/server/lead-distribution-rules";

describe("regra explícita para campanhas WhatsApp", () => {
  it("aceita a origem universal e preserva agente, transporte e conexão exatos", () => {
    expect(isValidLeadRuleSource(CAMPAIGN_WHATSAPP_SOURCE)).toBe(true);
    expect(sourceLabel(CAMPAIGN_WHATSAPP_SOURCE)).toBe("Campanhas de WhatsApp");

    const payload = leadRuleClientToDbPayload(
      {
        name: "Campanhas da linha 2",
        source: CAMPAIGN_WHATSAPP_SOURCE,
        distributionType: "automation_agent",
        agentIds: ["agent-1"],
        transport: "evolution",
        connectionId: "connection-2",
      },
      "tenant-1",
    );

    expect(payload).toMatchObject({
      tenant_id: "tenant-1",
      source: "whatsapp_campaign",
      distribution_type: "automation_agent",
      agent_ids: ["agent-1"],
      transport: "evolution",
      connection_id: "connection-2",
    });
  });
});
