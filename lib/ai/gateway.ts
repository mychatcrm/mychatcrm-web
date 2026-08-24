import { estimateCostUsd } from "@/lib/ai/costs";
import {
  getTenantSpend,
  getUsageLimitForTenant,
  logAiUsage,
  upsertDailyAggregate,
} from "@/lib/ai/tracking-store";
import type { AiGenerateInput, AiGenerateResult, AiGenerateSuccess, AiMessage, AiRole } from "@/lib/ai/types";
import { resolveOpenAiApiKey } from "@/lib/ai/openai-api-key";
import { integrationLog } from "@/lib/integrations/logger";
import {
  budgetAiMessagesForModel,
  resolveAiRequestModel,
} from "@/lib/ai/context-budget";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 25_000;
/** Tentativas totais (1 original + 2 repetições) para falhas transitórias. */
const MAX_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 700;
const MAX_RETRY_DELAY_MS = 4_000;

function normalizeTemperature(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.4;
  return Math.min(1, Math.max(0.01, n));
}

function sanitizeMessages(messages: AiMessage[]): AiMessage[] {
  const validRoles = new Set<AiRole>(["system", "user", "assistant"]);
  return messages.filter(
    (message) =>
      validRoles.has(message.role) &&
      typeof message.content === "string" &&
      message.content.trim().length > 0,
  );
}

function extractProviderMessage(data: unknown): string {
  const d = data as { choices?: Array<{ message?: { content?: string } }> };
  return d?.choices?.[0]?.message?.content?.trim() ?? "";
}

function extractProviderRefusal(data: unknown): string | null {
  const d = data as { choices?: Array<{ message?: { refusal?: string | null } }> };
  const refusal = d?.choices?.[0]?.message?.refusal;
  return typeof refusal === "string" && refusal.trim() ? refusal.trim() : null;
}

type ProviderError = {
  /** `insufficient_quota`, `rate_limit_exceeded`, `invalid_api_key`… */
  code: string | null;
  type: string | null;
  message: string | null;
};

/**
 * Motivo real da recusa, como a OpenAI o devolve.
 *
 * Sem isto, um 429 por FALTA DE CRÉDITO (`insufficient_quota`) e um 429 por
 * EXCESSO DE CHAMADAS (`rate_limit_exceeded`) ficavam indistinguíveis no log —
 * problemas diferentes, com soluções opostas: um se resolve no faturamento da
 * OpenAI, o outro esperando ou reduzindo o ritmo. Guardar só "OPENAI_429"
 * deixava o diagnóstico impossível sem acesso ao painel da OpenAI.
 */
function extractProviderError(data: unknown): ProviderError {
  const err = (data as { error?: { code?: unknown; type?: unknown; message?: unknown } })?.error;
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  return { code: str(err?.code), type: str(err?.type), message: str(err?.message) };
}

/** Linha única e legível para o log de uso (campo sanitizado, 240 chars). */
function describeProviderError(status: number, error: ProviderError): string {
  const label = error.code ?? error.type;
  const head = label ? `OPENAI_${status} ${label}` : `OPENAI_${status}`;
  return error.message ? `${head}: ${error.message}` : head;
}

/**
 * Vale a pena tentar de novo?
 *
 * `insufficient_quota` é estado de faturamento: repetir só gasta tempo e falha
 * igual. Excesso de chamadas e instabilidade do provedor, sim — normalmente
 * passam em segundos.
 */
function isRetryableFailure(status: number, error: ProviderError): boolean {
  if (status === 429) return error.code !== "insufficient_quota";
  return status === 500 || status === 502 || status === 503 || status === 504;
}

function retryDelayMs(attempt: number, retryAfterHeader: string | null): number {
  const parsed = Number.parseFloat(retryAfterHeader ?? "");
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(parsed * 1_000, MAX_RETRY_DELAY_MS);
  }
  return Math.min(BASE_RETRY_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
}

function extractUsage(data: unknown): { input: number; output: number; total: number } {
  const d = data as {
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const input = Number(d?.usage?.prompt_tokens ?? 0);
  const output = Number(d?.usage?.completion_tokens ?? 0);
  const total = Number(d?.usage?.total_tokens ?? input + output);
  return {
    input: Number.isFinite(input) ? input : 0,
    output: Number.isFinite(output) ? output : 0,
    total: Number.isFinite(total) ? total : 0,
  };
}

async function checkTenantLimits(tenantId: string): Promise<{ ok: true } | { ok: false; detail: string }> {
  const limits = await getUsageLimitForTenant(tenantId);
  if (!limits) return { ok: true };
  const spend = await getTenantSpend({ tenantId });
  if (limits.dailyCostUsdHard !== null && spend.dailyUsd >= limits.dailyCostUsdHard) {
    return { ok: false, detail: "DAILY_LIMIT" };
  }
  if (limits.monthlyCostUsdHard !== null && spend.monthlyUsd >= limits.monthlyCostUsdHard) {
    return { ok: false, detail: "MONTHLY_LIMIT" };
  }
  return { ok: true };
}

async function persistTracking(params: {
  input: AiGenerateInput;
  status: "success" | "error" | "blocked" | "timeout";
  model: string;
  text: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  latencyMs: number | null;
  providerRequestId?: string;
  errorCode?: string;
  errorMessage?: string;
}) {
  await logAiUsage({
    tenantId: params.input.tenantId,
    customerId: params.input.customerId ?? null,
    agentId: params.input.agentId,
    feature: params.input.feature,
    provider: "openai",
    model: params.model,
    promptExcerpt: params.input.messages.find((m) => m.role === "user")?.content.slice(0, 500) ?? null,
    responseExcerpt: params.text ? params.text.slice(0, 500) : null,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    totalTokens: params.totalTokens,
    estimatedCostUsd: params.estimatedCostUsd,
    currency: "USD",
    status: params.status,
    errorCode: params.errorCode ?? null,
    errorMessageSanitized: params.errorMessage?.slice(0, 240) ?? null,
    providerRequestId: params.providerRequestId ?? null,
    latencyMs: params.latencyMs,
    metadata: params.input.metadata ?? null,
  });
  await upsertDailyAggregate({
    tenantId: params.input.tenantId,
    agentId: params.input.agentId,
    model: params.model,
    requestCount: 1,
    successCount: params.status === "success" ? 1 : 0,
    errorCount: params.status === "error" || params.status === "timeout" ? 1 : 0,
    blockedCount: params.status === "blocked" ? 1 : 0,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    totalTokens: params.totalTokens,
    estimatedCostUsd: params.estimatedCostUsd,
  });
}

export async function generateAIResponse(input: AiGenerateInput): Promise<AiGenerateResult> {
  const model = resolveAiRequestModel(input.model);
  const started = Date.now();
  const normalizedMessages = sanitizeMessages(input.messages);

  if (!input.tenantId || !input.agentId || normalizedMessages.length === 0) {
    return { ok: false, code: "INVALID_INPUT", provider: "openai", model };
  }

  const budget = budgetAiMessagesForModel({
    model,
    messages: normalizedMessages,
    responseFormat: input.responseFormat,
  });
  if (!budget.ok) {
    if (budget.code === "unsupported_model_context_window") {
      return {
        ok: false,
        code: "INVALID_INPUT",
        detail: `agent_model_context_window_unknown:${budget.model}`,
        provider: "openai",
        model,
      };
    }
    const detail = `agent_context_overflow:required_tokens=${budget.overflow.requiredTokens};max_input_tokens=${budget.overflow.maxInputTokens};overflow_tokens=${budget.overflow.overflowTokens}`;
    await persistTracking({
      input,
      status: "blocked",
      model,
      text: "",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      latencyMs: Date.now() - started,
      errorCode: "AGENT_CONTEXT_OVERFLOW",
      errorMessage: detail,
    });
    integrationLog("ai-gateway", "error", "agent context overflow", {
      model,
      required_tokens: budget.overflow.requiredTokens,
      max_input_tokens: budget.overflow.maxInputTokens,
      overflow_tokens: budget.overflow.overflowTokens,
    });
    return {
      ok: false,
      code: "AGENT_CONTEXT_OVERFLOW",
      detail,
      contextOverflow: budget.overflow,
      provider: "openai",
      model,
      latencyMs: Date.now() - started,
    };
  }
  const safeMessages = budget.messages;
  if (budget.dropped.history || budget.dropped.retrieval || budget.dropped.auxiliary) {
    integrationLog("ai-gateway", "info", "optional context reduced to model budget", {
      model,
      input_tokens: budget.inputTokens,
      max_input_tokens: budget.maxInputTokens,
      dropped_history: budget.dropped.history,
      dropped_retrieval: budget.dropped.retrieval,
      dropped_auxiliary: budget.dropped.auxiliary,
    });
  }

  const apiKey = await resolveOpenAiApiKey();

  if (!apiKey) {
    await persistTracking({
      input,
      status: "error",
      model,
      text: "",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      latencyMs: 0,
      errorCode: "UNCONFIGURED",
      errorMessage: "OpenAI API key ausente",
    });
    return { ok: false, code: "UNCONFIGURED", provider: "openai", model };
  }

  const limit = await checkTenantLimits(input.tenantId);
  if (!limit.ok) {
    await persistTracking({
      input,
      status: "blocked",
      model,
      text: "",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      latencyMs: Date.now() - started,
      errorCode: "LIMIT_EXCEEDED",
      errorMessage: limit.detail,
    });
    return { ok: false, code: "LIMIT_EXCEEDED", detail: limit.detail, provider: "openai", model };
  }

  const timeoutMs = Number(process.env.AI_REQUEST_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const totalBudgetMs = Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS;
  // Orçamento TOTAL, não por tentativa: com repetições, um teto por tentativa
  // deixaria a função rodar por múltiplos do timeout e estourar o limite do
  // serverless. Cada tentativa recebe só o tempo que ainda sobra.
  const deadline = started + totalBudgetMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), totalBudgetMs);

  const requestBody = JSON.stringify({
    model,
    temperature: normalizeTemperature(input.temperature),
    max_tokens: budget.outputReserveTokens,
    messages: safeMessages.map((m) => ({ role: m.role, content: m.content })),
    ...(input.responseFormat
      ? {
          response_format: {
            type: "json_schema",
            json_schema: {
              name: input.responseFormat.name,
              strict: true,
              schema: input.responseFormat.schema,
            },
          },
        }
      : {}),
  });

  try {
    let response: Response;
    let json: unknown;
    let attempt = 0;

    // Uma recusa transitória da OpenAI (excesso de chamadas, instabilidade) não
    // pode custar a PRIMEIRA impressão de um lead: sem repetir, o lead recebia
    // para sempre a mensagem genérica de fallback.
    for (;;) {
      attempt += 1;
      response = await fetch(OPENAI_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: requestBody,
      });
      json = await response.json().catch(() => ({}));

      if (response.ok || attempt >= MAX_ATTEMPTS) break;

      const failure = extractProviderError(json);
      if (!isRetryableFailure(response.status, failure)) break;

      const delayMs = retryDelayMs(attempt, response.headers.get("retry-after"));
      // Só espera se ainda houver tempo para a espera E para a tentativa seguinte.
      if (Date.now() + delayMs >= deadline) break;

      integrationLog("openai", "warn", "retrying transient failure", {
        attempt,
        status: response.status,
        provider_code: failure.code ?? failure.type ?? undefined,
        delay_ms: delayMs,
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const providerRequestId = response.headers.get("x-request-id") ?? undefined;
    const usage = extractUsage(json);
    const text = extractProviderMessage(json);
    const refusal = extractProviderRefusal(json);
    const estimatedCostUsd = estimateCostUsd({
      provider: "openai",
      model,
      inputTokens: usage.input,
      outputTokens: usage.output,
    });
    const latencyMs = Date.now() - started;

    if (!response.ok) {
      const failure = extractProviderError(json);
      // Falta de crédito devolve 429 igual a excesso de chamadas. Separar os
      // dois é o que permite agir: um é faturamento, o outro é ritmo.
      const code =
        response.status === 401 || response.status === 403
          ? "UPSTREAM_AUTH"
          : failure.code === "insufficient_quota"
            ? "UPSTREAM_QUOTA"
            : response.status === 429
              ? "UPSTREAM_RATE_LIMIT"
              : "UPSTREAM_ERROR";
      const detail = describeProviderError(response.status, failure);
      await persistTracking({
        input,
        status: "error",
        model,
        text: "",
        inputTokens: usage.input,
        outputTokens: usage.output,
        totalTokens: usage.total,
        estimatedCostUsd,
        latencyMs,
        providerRequestId,
        errorCode: code,
        errorMessage: detail,
      });
      // Também no log da Vercel: quando um cliente reclama, o motivo tem que
      // estar visível sem depender de consulta ao banco.
      integrationLog("openai", "error", "request failed", {
        status: response.status,
        code,
        provider_code: failure.code ?? undefined,
        provider_type: failure.type ?? undefined,
        provider_message: failure.message ?? undefined,
        attempts: attempt,
        provider_request_id: providerRequestId,
      });
      return { ok: false, code, detail, provider: "openai", model, latencyMs };
    }

    if (refusal) {
      await persistTracking({
        input,
        status: "blocked",
        model,
        text: "",
        inputTokens: usage.input,
        outputTokens: usage.output,
        totalTokens: usage.total,
        estimatedCostUsd,
        latencyMs,
        providerRequestId,
        errorCode: "REFUSED",
        errorMessage: refusal,
      });
      return { ok: false, code: "REFUSED", detail: refusal.slice(0, 120), provider: "openai", model, latencyMs };
    }

    if (!text) {
      await persistTracking({
        input,
        status: "error",
        model,
        text: "",
        inputTokens: usage.input,
        outputTokens: usage.output,
        totalTokens: usage.total,
        estimatedCostUsd,
        latencyMs,
        providerRequestId,
        errorCode: "EMPTY_REPLY",
        errorMessage: "Resposta vazia",
      });
      return { ok: false, code: "EMPTY_REPLY", provider: "openai", model, latencyMs };
    }

    let structuredData: unknown;
    if (input.responseFormat) {
      try {
        structuredData = JSON.parse(text);
      } catch {
        await persistTracking({
          input,
          status: "error",
          model,
          text,
          inputTokens: usage.input,
          outputTokens: usage.output,
          totalTokens: usage.total,
          estimatedCostUsd,
          latencyMs,
          providerRequestId,
          errorCode: "INVALID_STRUCTURED_REPLY",
          errorMessage: "Resposta estruturada inválida",
        });
        return {
          ok: false,
          code: "INVALID_STRUCTURED_REPLY",
          provider: "openai",
          model,
          latencyMs,
        };
      }
    }

    await persistTracking({
      input,
      status: "success",
      model,
      text,
      inputTokens: usage.input,
      outputTokens: usage.output,
      totalTokens: usage.total,
      estimatedCostUsd,
      latencyMs,
      providerRequestId,
    });

    const success: AiGenerateSuccess = {
      ok: true,
      text,
      provider: "openai",
      model,
      usage: {
        inputTokens: usage.input,
        outputTokens: usage.output,
        totalTokens: usage.total,
      },
      latencyMs,
      providerRequestId,
      estimatedCostUsd,
      structuredData,
    };
    return success;
  } catch (err) {
    const latencyMs = Date.now() - started;
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const code = err instanceof Error && err.name === "AbortError" ? "TIMEOUT" : "NETWORK";
    integrationLog("ai-gateway", "error", "Falha ao chamar OpenAI", { code, detail: msg.slice(0, 120) });
    await persistTracking({
      input,
      status: code === "TIMEOUT" ? "timeout" : "error",
      model,
      text: "",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      latencyMs,
      errorCode: code,
      errorMessage: msg,
    });
    return { ok: false, code, provider: "openai", model, latencyMs, detail: msg.slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}
