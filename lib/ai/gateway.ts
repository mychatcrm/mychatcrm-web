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

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_MESSAGES = 32;
const MAX_MESSAGE_CONTENT = 8_000;

function normalizeTemperature(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.4;
  return Math.min(1, Math.max(0.01, n));
}

function sanitizeMessages(messages: AiMessage[]): AiMessage[] {
  const validRoles = new Set<AiRole>(["system", "user", "assistant"]);
  const normalized: AiMessage[] = [];
  for (const m of messages) {
    if (!validRoles.has(m.role)) continue;
    const content = (m.content ?? "").slice(0, MAX_MESSAGE_CONTENT).trim();
    if (!content) continue;
    normalized.push({ role: m.role, content });
  }
  const firstSystem = normalized.find((x) => x.role === "system") ?? null;
  const nonSystem = normalized.filter((x) => x.role !== "system");
  const maxRest = firstSystem ? MAX_MESSAGES - 1 : MAX_MESSAGES;
  const rest = nonSystem.slice(-maxRest);
  return firstSystem ? [firstSystem, ...rest] : rest;
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
  const apiKey = await resolveOpenAiApiKey();
  const model = input.model?.trim() || process.env.OPENAI_CHAT_MODEL?.trim() || DEFAULT_MODEL;
  const started = Date.now();
  const safeMessages = sanitizeMessages(input.messages);

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

  if (!input.tenantId || !input.agentId || safeMessages.length === 0) {
    return { ok: false, code: "INVALID_INPUT", provider: "openai", model };
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: normalizeTemperature(input.temperature),
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
      }),
    });
    const providerRequestId = response.headers.get("x-request-id") ?? undefined;
    const json = await response.json().catch(() => ({}));
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
      const code = response.status === 401 || response.status === 403
        ? "UPSTREAM_AUTH"
        : response.status === 429
          ? "UPSTREAM_RATE_LIMIT"
          : "UPSTREAM_ERROR";
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
        errorMessage: `OPENAI_${response.status}`,
      });
      return { ok: false, code, detail: `OPENAI_${response.status}`, provider: "openai", model, latencyMs };
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
