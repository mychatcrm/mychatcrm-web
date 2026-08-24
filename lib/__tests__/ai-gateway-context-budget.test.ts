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

import { budgetAiMessagesForModel } from "@/lib/ai/context-budget";
import { generateAIResponse } from "@/lib/ai/gateway";

describe("AI gateway context sovereignty", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a prompt larger than 8,000 characters byte for byte", async () => {
    const longPrompt = `  PROMPT-BEGIN\n${"á漢🙂 exact ".repeat(1_100)}\nPROMPT-END  `;
    expect(longPrompt.length).toBeGreaterThan(8_000);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" } }],
          usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await generateAIResponse({
      tenantId: "tenant-1",
      agentId: "agent-1",
      feature: "agent_chat",
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: longPrompt,
          retention: "required",
          source: "client_prompt",
        },
        { role: "user", content: "current", retention: "required", source: "current_message" },
      ],
    });

    expect(result.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages[0]).toEqual({ role: "system", content: longPrompt });
    expect(body.messages[0]!.content).toBe(longPrompt);
  });

  it("drops only optional old context and keeps required bytes intact", () => {
    const technical = "technical rules";
    const current = "current message must survive exactly";
    const result = budgetAiMessagesForModel({
      model: "gpt-4o-mini",
      contextWindowTokens: 320,
      outputReserveTokens: 100,
      messages: [
        { role: "system", content: technical, retention: "required", source: "technical_rules" },
        { role: "user", content: "old ".repeat(2_000), retention: "history" },
        { role: "assistant", content: "older ".repeat(2_000), retention: "history" },
        { role: "user", content: current, retention: "required", source: "current_message" },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.messages.map((message) => message.content)).toEqual([technical, current]);
    expect(result.dropped.history).toBe(2);
  });

  it("fails closed with visible measurements when mandatory content overflows", () => {
    const result = budgetAiMessagesForModel({
      model: "gpt-4o-mini",
      contextWindowTokens: 180,
      outputReserveTokens: 80,
      messages: [
        {
          role: "system",
          content: "mandatory prompt ".repeat(500),
          retention: "required",
          source: "client_prompt",
        },
        {
          role: "user",
          content: "mandatory current message",
          retention: "required",
          source: "current_message",
        },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      code: "agent_context_overflow",
      overflow: {
        model: "gpt-4o-mini",
        contextWindowTokens: 180,
        maxInputTokens: 100,
      },
    });
    if (!result.ok && result.code === "agent_context_overflow") {
      expect(result.overflow.requiredTokens).toBeGreaterThan(result.overflow.maxInputTokens);
      expect(result.overflow.overflowTokens).toBeGreaterThan(0);
      expect(result.overflow.correction).toContain("Required content was not truncated");
    }
  });

  it("fails closed for an unknown model instead of assuming a context window", () => {
    expect(
      budgetAiMessagesForModel({
        model: "vendor-unknown-model",
        messages: [{ role: "user", content: "hello" }],
      }),
    ).toEqual({
      ok: false,
      code: "unsupported_model_context_window",
      model: "vendor-unknown-model",
    });
  });
});
