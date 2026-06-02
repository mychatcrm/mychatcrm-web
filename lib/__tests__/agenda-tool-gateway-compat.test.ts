/**
 * Testa backward-compatibility do gateway:
 * quando tools=undefined o body deve ser idêntico ao comportamento atual (sem tools, sem tool_choice).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock das dependências do gateway antes do import
vi.mock("@/lib/ai/openai-api-key", () => ({ resolveOpenAiApiKey: vi.fn().mockResolvedValue("sk-test") }));
vi.mock("@/lib/ai/tracking-store", () => ({
  logAiUsage: vi.fn().mockResolvedValue(undefined),
  upsertDailyAggregate: vi.fn().mockResolvedValue(undefined),
  getUsageLimitForTenant: vi.fn().mockResolvedValue(null),
  getTenantSpend: vi.fn().mockResolvedValue({ dailyUsd: 0, monthlyUsd: 0 }),
}));
vi.mock("@/lib/ai/costs", () => ({ estimateCostUsd: vi.fn().mockReturnValue(0.001) }));
vi.mock("@/lib/integrations/logger", () => ({ integrationLog: vi.fn() }));

import { generateAIResponse } from "@/lib/ai/gateway";

describe("gateway backward-compat: tools=undefined", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => "req-123" },
      json: async () => ({
        choices: [{ message: { content: "Olá!" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    }));
  });

  it("não inclui 'tools' nem 'tool_choice' no body quando tools=undefined", async () => {
    await generateAIResponse({
      tenantId: "t1",
      agentId: "a1",
      feature: "agent_chat",
      messages: [{ role: "user", content: "oi" }],
      // tools NÃO passado
    });

    const [_url, fetchInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(fetchInit.body as string);
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
  });

  it("retorna text corretamente quando tools=undefined e finish_reason=stop", async () => {
    const result = await generateAIResponse({
      tenantId: "t1",
      agentId: "a1",
      feature: "agent_chat",
      messages: [{ role: "user", content: "oi" }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe("Olá!");
      expect(result.tool_calls).toBeUndefined();
    }
  });
});
