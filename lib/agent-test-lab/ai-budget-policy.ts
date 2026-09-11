import { getModelPricing } from "@/lib/ai/costs";
import { budgetAiMessagesForModel, resolveAiRequestModel } from "@/lib/ai/context-budget";
import type { AiGenerateInput, AiGenerateResult } from "@/lib/ai/types";

export const LAB_AI_BILLING_TENANT = "platform-agent-test-lab";
export const LAB_AI_MAX_ATTEMPTS = 3;
export function labAiBudgetQuote(input: AiGenerateInput, usdBrl: number) {
  if (!Number.isFinite(usdBrl) || usdBrl <= 0) throw new Error("lab_exchange_rate_invalid");
  const model = resolveAiRequestModel(input.model);
  const price = getModelPricing("openai", model);
  // The general billing catalogue has a legacy fallback. Never reserve using it.
  if (price.model !== model) throw new Error("lab_model_price_unknown");
  const budget = budgetAiMessagesForModel({ model, messages: input.messages, responseFormat: input.responseFormat });
  if (!budget.ok) throw new Error("lab_ai_context_invalid");
  const oneAttempt = (budget.inputTokens * price.inputPer1kUsd + budget.outputReserveTokens * price.outputPer1kUsd) / 1000;
  return { model, usdBrl, price, reservedBrl: Math.max(0.0001, Math.ceil(oneAttempt * usdBrl * LAB_AI_MAX_ATTEMPTS * 10000) / 10000) };
}

/** Uncertain transport/usage keeps the reservation. It is never silently free. */
export function labAiActualCost(result: AiGenerateResult, quote: ReturnType<typeof labAiBudgetQuote>): number | null {
  if (!result.ok && ["UNCONFIGURED", "INVALID_INPUT", "LIMIT_EXCEEDED", "AGENT_CONTEXT_OVERFLOW", "UPSTREAM_AUTH", "UPSTREAM_QUOTA"].includes(result.code)) return 0;
  const usage = result.usage;
  if (!usage || !Number.isSafeInteger(usage.inputTokens) || !Number.isSafeInteger(usage.outputTokens) ||
    Number(usage.inputTokens) < 0 || Number(usage.outputTokens) < 0 || Number(usage.inputTokens) + Number(usage.outputTokens) <= 0) return null;
  const usd = (Number(usage.inputTokens) * quote.price.inputPer1kUsd + Number(usage.outputTokens) * quote.price.outputPer1kUsd) / 1000;
  return Math.ceil(usd * quote.usdBrl * 10000) / 10000;
}
