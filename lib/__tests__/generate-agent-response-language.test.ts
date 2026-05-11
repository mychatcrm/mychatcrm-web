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
  getInferenceProfileByTenantAgent: vi.fn(async () => null),
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
      "CRITICAL INSTRUCTION - LANGUAGE: The user's message is in English. You MUST respond EXCLUSIVELY in English. Do not use any other language. This is mandatory and overrides everything else.",
    );
  });
});
