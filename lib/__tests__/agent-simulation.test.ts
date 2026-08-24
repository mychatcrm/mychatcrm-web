import { beforeEach, describe, expect, it, vi } from "vitest";

const generateAIResponseMock = vi.fn(async () => ({
  ok: true as const,
  text: "Resposta simulada",
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
  generateAIResponse: (input: unknown) => generateAIResponseMock(input),
}));

vi.mock("@/lib/server/conversation-memory", () => ({
  loadAgentRuntimeContext: vi.fn(async () => ({
    state: null,
    lead: null,
    summary: null,
    recentMessages: [],
    knowledgeSnippets: [],
    outboundMediaLines: [],
  })),
  conversationMessagesToAi: vi.fn(() => []),
}));

describe("generateAgentResponse simulation", () => {
  beforeEach(() => {
    generateAIResponseMock.mockClear();
  });

  it("marks metadata.simulation=true and does not require WhatsApp", async () => {
    const { generateAgentResponse } = await import("@/lib/ai/generate-agent-response");

    const result = await generateAgentResponse({
      tenantId: "tenant-test",
      agentId: "ag-clara-comercial",
      feature: "agent_completion",
      messages: [{ role: "user", content: "Teste" }],
      simulation: true,
    });

    expect(result.ok).toBe(true);
    expect(generateAIResponseMock).toHaveBeenCalledOnce();
    const input = generateAIResponseMock.mock.calls[0]![0] as { metadata?: { simulation?: boolean } };
    expect(input.metadata?.simulation).toBe(true);
  });
});
