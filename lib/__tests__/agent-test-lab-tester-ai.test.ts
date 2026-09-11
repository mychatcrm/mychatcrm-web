import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ generate: vi.fn(), budget: vi.fn() }));
vi.mock("@/lib/ai/gateway", () => ({ generateAIResponse: m.generate }));
vi.mock("@/lib/server/agent-test-lab/ai-budget", () => ({ withLabAiBudget: m.budget }));
import { nextLabTesterMessage } from "@/lib/server/agent-test-lab/tester-ai";
const input = { labTenantId: "tenant-lab-copy", labAgentId: "a", model: "gpt-4o-mini", remaining: 3,
  runId: "run", claim: "claim", ordinal: 0, transcript: [],
  scenario: { version: 1 as const, name: "Neutral", goal: "Ask a question", language: "en", steps: [] } };
beforeEach(() => { vi.resetAllMocks(); m.budget.mockImplementation((_p, task) => task()); m.generate.mockResolvedValue({ ok: true, text: "Hello" }); });
describe("metered tester AI", () => {
  it("uses the chosen model inside an ordinal-bound budget reservation", async () => {
    expect(await nextLabTesterMessage(input)).toBe("Hello");
    expect(m.budget).toHaveBeenCalledWith({ runId: "run", claim: "claim", operation: "tester:0", category: "tester_ai" }, expect.any(Function));
    expect(m.generate).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-4o-mini", tenantId: "tenant-lab-copy" }));
  });
  it("never calls AI after the limit", async () => {
    expect(await nextLabTesterMessage({ ...input, remaining: 0 })).toBeNull(); expect(m.budget).not.toHaveBeenCalled();
  });
  it("never chooses a model implicitly", async () => {
    await expect(nextLabTesterMessage({ ...input, model: null })).rejects.toThrow("lab_tester_model_required"); expect(m.generate).not.toHaveBeenCalled();
  });
  it("never calls AI when reserving the budget fails", async () => {
    m.budget.mockRejectedValue(new Error("lab_ai_budget_exhausted"));
    await expect(nextLabTesterMessage(input)).rejects.toThrow("lab_ai_budget_exhausted"); expect(m.generate).not.toHaveBeenCalled();
  });
  it.each([{ ok: false, code: "TIMEOUT" }, { ok: true, text: "" }])("does not report AI failure as a normal end of conversation", async result => {
    m.generate.mockResolvedValue(result); await expect(nextLabTesterMessage(input)).rejects.toThrow();
  });
  it("accepts only the explicit completion signal as a normal early stop", async () => {
    m.generate.mockResolvedValue({ ok: true, text: "ENCERRAR" }); expect(await nextLabTesterMessage(input)).toBeNull();
  });
});
