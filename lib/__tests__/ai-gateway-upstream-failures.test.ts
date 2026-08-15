import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Falhas da OpenAI: distinguir o motivo e não desistir na primeira recusa.
 *
 * Incidente que originou estes testes: um lead recebeu a mensagem genérica de
 * fallback em vez da resposta do agente. O log dizia apenas "OPENAI_429" — que
 * é o MESMO código para "sem crédito" e para "chamadas demais", problemas com
 * soluções opostas. Sem o motivo real, o diagnóstico ficava impossível sem
 * abrir o painel da OpenAI.
 */

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

function openAiError(status: number, error: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json", "x-request-id": "req-err" },
  });
}

function okResponse(text: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    }),
    { status: 200, headers: { "Content-Type": "application/json", "x-request-id": "req-ok" } },
  );
}

const baseInput = {
  tenantId: "tenant-1",
  agentId: "agent-1",
  feature: "agent_chat" as const,
  messages: [{ role: "user" as const, content: "Oi" }],
};

/**
 * Avança as esperas entre tentativas sem dormir de verdade.
 *
 * 5s cobre a espera máxima acumulada e fica bem abaixo do timeout total de 25s
 * — avançar tudo dispararia também o abort e mascararia o que está sob teste.
 */
async function runWithRetries<T>(promise: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(5_000);
  return promise;
}

describe("gateway — motivo real da recusa da OpenAI", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("separa falta de crédito (429 insufficient_quota) de excesso de chamadas", async () => {
    fetchMock.mockResolvedValue(
      openAiError(429, {
        code: "insufficient_quota",
        type: "insufficient_quota",
        message: "You exceeded your current quota, please check your plan and billing details.",
      }),
    );

    const result = await generateAIResponse(baseInput);

    expect(result.ok).toBe(false);
    // Código próprio: é faturamento, não ritmo — a ação para resolver é outra.
    expect(result.ok === false && result.code).toBe("UPSTREAM_QUOTA");
    expect(result.ok === false && result.detail).toContain("insufficient_quota");
    expect(result.ok === false && result.detail).toContain("check your plan and billing");
    // Faturamento não melhora repetindo: uma tentativa só.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("grava o motivo real no log de uso, não só o status", async () => {
    fetchMock.mockResolvedValue(
      openAiError(429, {
        code: "insufficient_quota",
        type: "insufficient_quota",
        message: "You exceeded your current quota.",
      }),
    );

    await generateAIResponse(baseInput);

    expect(tracking.logAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "UPSTREAM_QUOTA",
        errorMessageSanitized: expect.stringContaining("insufficient_quota"),
      }),
    );
  });

  it("repete quando é excesso de chamadas e devolve a resposta boa", async () => {
    fetchMock
      .mockResolvedValueOnce(
        openAiError(429, { code: "rate_limit_exceeded", type: "requests", message: "Rate limit reached." }),
      )
      .mockResolvedValueOnce(okResponse("Olá! Como posso ajudar?"));

    const result = await runWithRetries(generateAIResponse(baseInput));

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.text).toBe("Olá! Como posso ajudar?");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("desiste depois do limite de tentativas, sem repetir para sempre", async () => {
    fetchMock.mockResolvedValue(
      openAiError(429, { code: "rate_limit_exceeded", type: "requests", message: "Rate limit reached." }),
    );

    const result = await runWithRetries(generateAIResponse(baseInput));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("UPSTREAM_RATE_LIMIT");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("repete instabilidade do provedor (5xx)", async () => {
    fetchMock
      .mockResolvedValueOnce(openAiError(503, { type: "server_error", message: "Service unavailable." }))
      .mockResolvedValueOnce(okResponse("Pronto."));

    const result = await runWithRetries(generateAIResponse(baseInput));

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("NÃO repete chave inválida — repetir nunca resolveria", async () => {
    fetchMock.mockResolvedValue(
      openAiError(401, { code: "invalid_api_key", type: "invalid_request_error", message: "Incorrect API key." }),
    );

    const result = await generateAIResponse(baseInput);

    expect(result.ok === false && result.code).toBe("UPSTREAM_AUTH");
    expect(result.ok === false && result.detail).toContain("invalid_api_key");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("erro sem corpo estruturado ainda identifica o status", async () => {
    fetchMock.mockResolvedValue(new Response("upstream exploded", { status: 500 }));

    const result = await runWithRetries(generateAIResponse(baseInput));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.detail).toContain("OPENAI_500");
  });
});
