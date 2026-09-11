import { beforeEach, describe, expect, it, vi } from "vitest";
import { invokeWithAiExecutionBudget, withAiExecutionBudget, aiExecutionDeadline } from "@/lib/ai/execution-budget";
import { LAB_AI_BILLING_TENANT, labAiBudgetQuote, labAiActualCost } from "@/lib/agent-test-lab/ai-budget-policy";
import type { AiGenerateInput, AiGenerateSuccess } from "@/lib/ai/types";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), row: null as Record<string, unknown> | null }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: () => ({ rpc: mocks.rpc, from: () => {
  const q = { select: () => q, eq: () => q, single: async () => ({ data: mocks.row, error: null }) }; return q;
} }) }));
import { withLabAiBudget } from "@/lib/server/agent-test-lab/ai-budget";
const id = "33333333-3333-4333-8333-333333333333", claim = "44444444-4444-4444-8444-444444444444";
const input: AiGenerateInput = { tenantId: "customer", agentId: "agent", feature: "agent_chat", model: "gpt-4o-mini", messages: [{ role: "user", content: "Hello" }] };
const success: AiGenerateSuccess = { ok: true, text: "Hello", model: "gpt-4o-mini", provider: "openai", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, latencyMs: 5, estimatedCostUsd: 0.000005 };
const scope = { runId: id, claim, operation: "simulation:0", category: "agent_ai" as const };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("AI_COST_USD_BRL_RATE", "5.5");
  mocks.row = { id, claim_token: claim, deadline_at: new Date(Date.now() + 60000).toISOString(), claim_expires_at: new Date(Date.now() + 60000).toISOString() };
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name.startsWith("reserve_") ? { ok: true } : true, error: null }));
});
describe("laboratory per-call AI budget", () => {
  it("leaves normal production calls byte-for-byte unchanged", async () => {
    const execute = vi.fn(async () => success);
    expect(await invokeWithAiExecutionBudget(input, execute)).toBe(success);
    expect(execute).toHaveBeenCalledExactlyOnceWith(input); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not accept the general catalogue's unknown-model price fallback", () => {
    expect(() => labAiBudgetQuote({ ...input, model: "gpt-4.1" }, 5)).toThrow("lab_model_price_unknown");
    expect(() => labAiBudgetQuote(input, NaN)).toThrow("lab_exchange_rate_invalid");
  });
  it("reserves before execution and settles without debiting the customer tenant", async () => {
    const execute = vi.fn(async (actual: AiGenerateInput) => {
      expect(mocks.rpc).toHaveBeenCalledTimes(1);
      expect(actual.tenantId).toBe(LAB_AI_BILLING_TENANT);
      expect(actual.messages).toBe(input.messages); expect(actual.agentId).toBe(input.agentId);
      return success;
    });
    await withLabAiBudget(scope, () => invokeWithAiExecutionBudget(input, execute));
    expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(["reserve_agent_test_lab_ai_cost_v3", "settle_agent_test_lab_cost_v1"]);
    expect(aiExecutionDeadline()).toBeUndefined();
  });
  it.each(["budget_exhausted", "claim_invalid", "operation_already_reserved"])("never calls the model after %s", async code => {
    mocks.rpc.mockResolvedValue({ data: { ok: false, code }, error: null }); const execute = vi.fn(async () => success);
    await expect(withLabAiBudget(scope, () => invokeWithAiExecutionBudget(input, execute))).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  it("keeps unknown transport cost reserved, preventing blind retries", async () => {
    await expect(withLabAiBudget(scope, () => invokeWithAiExecutionBudget(input, async () => ({ ok: false, code: "TIMEOUT" })))).rejects.toThrow("lab_ai_usage_unconfirmed");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("treats absent or impossible provider usage as unknown", () => {
    const quote = labAiBudgetQuote(input, 5.5);
    expect(labAiActualCost({ ...success, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }, quote)).toBeNull();
    expect(labAiActualCost({ ...success, usage: { inputTokens: -1, outputTokens: 10, totalTokens: 9 } }, quote)).toBeNull();
    expect(labAiActualCost({ ok: false, code: "UNCONFIGURED" }, quote)).toBe(0);
  });
  it("reports settlement failure instead of pretending the call was free", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ok: true }, error: null }).mockResolvedValueOnce({ data: false, error: null });
    await expect(withLabAiBudget(scope, () => invokeWithAiExecutionBudget(input, async () => success))).rejects.toThrow("lab_ai_cost_settlement_unconfirmed");
  });
  it("assigns stable distinct keys to nested generations within one turn", async () => {
    await withLabAiBudget(scope, async () => { await invokeWithAiExecutionBudget(input, async () => success); await invokeWithAiExecutionBudget(input, async () => success); });
    expect(mocks.rpc.mock.calls.filter(call => call[0].startsWith("reserve_")).map(call => call[1].p_key))
      .toEqual([`lab-ai:${id}:simulation:0:0`, `lab-ai:${id}:simulation:0:1`]);
  });
  it("isolates parallel scopes and rejects accidental nesting", async () => {
    const seen: number[] = [];
    await Promise.all([1, 2].map(deadline => withAiExecutionBudget({ deadline, invoke: async (_, execute) => execute(input) }, async () => {
      await Promise.resolve(); seen.push(aiExecutionDeadline()!);
      await expect(async () => withAiExecutionBudget({ deadline, invoke: async () => success }, async () => success)).rejects.toThrow("ai_budget_scope_nested");
    })));
    expect(seen.sort()).toEqual([1, 2]); expect(aiExecutionDeadline()).toBeUndefined();
  });
  it("does not accept stale or mismatched claims", async () => {
    mocks.row!.claim_token = id;
    await expect(withLabAiBudget(scope, async () => success)).rejects.toThrow("lab_ai_claim_invalid");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
