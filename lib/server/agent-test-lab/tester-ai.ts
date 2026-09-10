import "server-only";
import { generateAIResponse } from "@/lib/ai/gateway";
import type { LabScenarioV1 } from "@/lib/agent-test-lab/contracts";
import { buildLabTesterMessages, sanitiseLabTesterMessage } from "@/lib/agent-test-lab/tester-policy";
import { withLabAiBudget } from "./ai-budget";

/**
 * Produces the lead's next message. A failure here ends the conversation instead of
 * inventing one, because a made-up message would be attributed to the test.
 */
export async function nextLabTesterMessage(params: {
  labTenantId: string; labAgentId: string; model?: string | null;
  scenario: LabScenarioV1; transcript: { direction: "tester" | "agent"; content: string | null }[];
  remaining: number;
  runId: string; claim: string; ordinal: number;
}): Promise<string | null> {
  if (params.remaining <= 0) return null;
  if (!params.model?.trim()) throw new Error("lab_tester_model_required");
  if (!Number.isInteger(params.ordinal) || params.ordinal < 0) throw new Error("lab_tester_ordinal_invalid");
  const result = await withLabAiBudget({ runId: params.runId, claim: params.claim,
    operation: `tester:${params.ordinal}`, category: "tester_ai" }, () => generateAIResponse({
    // Billed to the laboratory tenant, never to the customer being tested.
    tenantId: params.labTenantId, agentId: params.labAgentId, feature: "admin_tool",
    model: params.model!, temperature: 0.8,
    messages: buildLabTesterMessages(params),
    metadata: { scope: "agent_test_lab_tester" },
  }));
  if (!result.ok) throw new Error("lab_tester_generation_failed");
  if (!result.text.trim()) throw new Error("lab_tester_empty_response");
  return sanitiseLabTesterMessage(result.text).text;
}
