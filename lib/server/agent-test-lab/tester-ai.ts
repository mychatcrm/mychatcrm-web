import "server-only";
import { generateAIResponse } from "@/lib/ai/gateway";
import type { LabScenarioV1 } from "@/lib/agent-test-lab/contracts";
import { buildLabTesterMessages, sanitiseLabTesterMessage } from "@/lib/agent-test-lab/tester-policy";

/**
 * Produces the lead's next message. A failure here ends the conversation instead of
 * inventing one, because a made-up message would be attributed to the test.
 */
export async function nextLabTesterMessage(params: {
  labTenantId: string; labAgentId: string; model?: string | null;
  scenario: LabScenarioV1; transcript: { direction: "tester" | "agent"; content: string | null }[];
  remaining: number;
}): Promise<string | null> {
  if (params.remaining <= 0) return null;
  const result = await generateAIResponse({
    // Billed to the laboratory tenant, never to the customer being tested.
    tenantId: params.labTenantId, agentId: params.labAgentId, feature: "admin_tool",
    model: params.model ?? undefined, temperature: 0.8,
    messages: buildLabTesterMessages(params),
    metadata: { scope: "agent_test_lab_tester" },
  });
  if (!result.ok) return null;
  return sanitiseLabTesterMessage(result.text).text;
}
