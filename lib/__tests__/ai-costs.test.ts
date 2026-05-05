import { describe, expect, it } from "vitest";
import { estimateCostUsd, getModelPricing } from "@/lib/ai/costs";

describe("ai/costs", () => {
  it("resolves known model pricing", () => {
    const pricing = getModelPricing("openai", "gpt-4o-mini");
    expect(pricing.inputPer1kUsd).toBe(0.00015);
    expect(pricing.outputPer1kUsd).toBe(0.0006);
  });

  it("falls back to default pricing for unknown model", () => {
    const pricing = getModelPricing("openai", "unknown-model");
    expect(pricing.model).toBe("gpt-4o-mini");
  });

  it("estimates request cost from input and output tokens", () => {
    const cost = estimateCostUsd({
      provider: "openai",
      model: "gpt-4o-mini",
      inputTokens: 5000,
      outputTokens: 2500,
    });
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeCloseTo(0.00225, 6);
  });
});
