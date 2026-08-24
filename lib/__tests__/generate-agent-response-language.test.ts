import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiGenerateInput } from "@/lib/ai/types";

const generateAIResponseMock = vi.fn(async () => ({
  ok: true as const,
  text: "Sure, I can help.",
  provider: "openai" as const,
  model: "gpt-4o-mini",
  usage: { input: 0, output: 0, total: 0 },
  estimatedCostUsd: 0,
}));

vi.mock("@/lib/agents/inference-store", () => ({
  getInferenceProfileByTenantAgent: vi.fn(async () => ({
    tenantId: "tenant-test",
    agentId: "agent-test",
    displayName: "Configured agent",
    systemPrompt: "Follow the tenant configuration exactly.",
    model: null,
    metadata: {
      instructionMode: "pro",
      systemPrompt: "Follow the tenant configuration exactly.",
      idioma: "Automático",
    },
  })),
}));

vi.mock("@/lib/ai/gateway", () => ({
  generateAIResponse: (input: AiGenerateInput) => generateAIResponseMock(input),
}));

describe("generateAgentResponse language instruction", () => {
  beforeEach(() => {
    generateAIResponseMock.mockClear();
  });

  it("injects the detected language as the first system prompt line", async () => {
    const { generateAgentResponse } = await import("@/lib/ai/generate-agent-response");

    await generateAgentResponse({
      tenantId: "tenant-test",
      agentId: "ag-clara-comercial",
      feature: "agent_chat",
      messages: [{ role: "user", content: "Hello, I need help with my account today" }],
    });

    expect(generateAIResponseMock).toHaveBeenCalledOnce();
    const input = generateAIResponseMock.mock.calls[0]![0] as AiGenerateInput;
    const systemPrompt = input.messages[0]?.content ?? "";
    expect(systemPrompt.split("\n")[0]).toBe(
      'LANGUAGE POLICY: The latest user message is in BCP-47 language "en". Respond exclusively in that language for this turn.',
    );
  });
});
