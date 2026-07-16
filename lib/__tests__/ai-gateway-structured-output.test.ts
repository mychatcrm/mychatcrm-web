import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tracking = vi.hoisted(() => ({
  getUsageLimitForTenant: vi.fn(async () => null),
  getTenantSpend: vi.fn(async () => ({ dailyUsd: 0, monthlyUsd: 0 })),
  logAiUsage: vi.fn(async () => undefined),
  upsertDailyAggregate: vi.fn(async () => undefined),
}));

vi.mock("@/lib/ai/openai-api-key", () => ({
  resolveOpenAiApiKey: vi.fn(async () => "sk-test"),
}));
vi.mock("@/lib/ai/tracking-store", () => tracking);
vi.mock("@/lib/integrations/logger", () => ({ integrationLog: vi.fn() }));

import { generateAIResponse } from "@/lib/ai/gateway";
import { AGENT_TURN_RESPONSE_FORMAT } from "@/lib/ai/agent-turn-plan";

describe("AI gateway structured output", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the strict JSON Schema contract and parses the provider result", async () => {
    const providerPlan = {
      reply: "Vou verificar esse horário.",
      agenda: {
        action: "create",
        date: "20/07/2026",
        time: "14:00",
        location: null,
        eventId: null,
      },
    };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(providerPlan) } }],
      usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
    }), { status: 200, headers: { "Content-Type": "application/json", "x-request-id": "req-1" } }));

    const result = await generateAIResponse({
      tenantId: "tenant-1",
      agentId: "agent-1",
      feature: "agent_chat",
      messages: [{ role: "user", content: "Agende dia 20 às 14h" }],
      responseFormat: AGENT_TURN_RESPONSE_FORMAT,
    });

    expect(result).toMatchObject({ ok: true, structuredData: providerPlan });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "agent_turn",
        strict: true,
        schema: AGENT_TURN_RESPONSE_FORMAT.schema,
      },
    });
  });

  it("fails closed when a structured response is not valid JSON", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: "resposta livre" } }],
      usage: {},
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(generateAIResponse({
      tenantId: "tenant-1",
      agentId: "agent-1",
      feature: "agent_chat",
      messages: [{ role: "user", content: "Mensagem" }],
      responseFormat: AGENT_TURN_RESPONSE_FORMAT,
    })).resolves.toMatchObject({ ok: false, code: "INVALID_STRUCTURED_REPLY" });
  });
});
