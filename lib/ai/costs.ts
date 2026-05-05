import type { AiProvider } from "@/lib/ai/types";

export type AiModelPricing = {
  provider: AiProvider;
  model: string;
  inputPer1kUsd: number;
  outputPer1kUsd: number;
};

const MODEL_PRICING_USD: Record<string, AiModelPricing> = {
  "gpt-4o-mini": {
    provider: "openai",
    model: "gpt-4o-mini",
    inputPer1kUsd: 0.00015,
    outputPer1kUsd: 0.0006,
  },
  "gpt-4o": {
    provider: "openai",
    model: "gpt-4o",
    inputPer1kUsd: 0.005,
    outputPer1kUsd: 0.015,
  },
};

export function getModelPricing(provider: AiProvider, model: string): AiModelPricing {
  const normalized = model.trim().toLowerCase();
  const pricing = MODEL_PRICING_USD[normalized];
  if (pricing && pricing.provider === provider) return pricing;
  return MODEL_PRICING_USD["gpt-4o-mini"];
}

export function estimateCostUsd(params: {
  provider: AiProvider;
  model: string;
  inputTokens: number;
  outputTokens: number;
}): number {
  const pricing = getModelPricing(params.provider, params.model);
  const inCost = (Math.max(0, params.inputTokens) / 1000) * pricing.inputPer1kUsd;
  const outCost = (Math.max(0, params.outputTokens) / 1000) * pricing.outputPer1kUsd;
  return Math.round((inCost + outCost) * 1_000_000) / 1_000_000;
}
