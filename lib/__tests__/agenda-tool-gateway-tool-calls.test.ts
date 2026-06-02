/**
 * Testa que o gateway detecta finish_reason='tool_calls' e retorna AiToolCall[] corretamente.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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
import { AGENDA_TOOL_DEFINITIONS } from "@/lib/server/agenda-tool-definitions";

const TOOL_CALLS_RESPONSE = {
  choices: [{
    finish_reason: "tool_calls",
    message: {
      content: null,
      tool_calls: [{
        id: "call_abc123",
        type: "function",
        function: { name: "consultar_agendamentos", arguments: "{}" },
      }],
    },
  }],
  usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
};

describe("gateway: tool_calls detection", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: async () => TOOL_CALLS_RESPONSE,
    }));
  });

  it("inclui tools no body quando passadas", async () => {
    await generateAIResponse({
      tenantId: "t1",
      agentId: "a1",
      feature: "agent_chat",
      messages: [{ role: "user", content: "quando é meu agendamento?" }],
      tools: AGENDA_TOOL_DEFINITIONS,
    });

    const [_url, fetchInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(fetchInit.body as string);
    expect(body.tools).toBeDefined();
    expect(body.tool_choice).toBe("auto");
  });

  it("retorna tool_calls quando finish_reason=tool_calls", async () => {
    const result = await generateAIResponse({
      tenantId: "t1",
      agentId: "a1",
      feature: "agent_chat",
      messages: [{ role: "user", content: "quando é meu agendamento?" }],
      tools: AGENDA_TOOL_DEFINITIONS,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tool_calls).toHaveLength(1);
      expect(result.tool_calls![0].function.name).toBe("consultar_agendamentos");
      expect(result.text).toBe("");
    }
  });
});
