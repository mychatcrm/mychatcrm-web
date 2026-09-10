import { describe, expect, it } from "vitest";
import { labAggregateVerdict, labSafetyChecks, requireCertifiedLabCapability } from "@/lib/agent-test-lab/safety-policy";
import type { LabRunRequestV1 } from "@/lib/agent-test-lab/contracts";
const request = (over: Partial<LabRunRequestV1> = {}): LabRunRequestV1 => ({
  mode: "manual", profile: "short", limits: { maxMessages: 6, maxMinutes: 20, budgetBrl: 5 },
  targetKind: "copy", tenantId: "tenant", agentId: "agent", ruleId: null, connectionId: null,
  channel: "evolution", formId: null, testerModel: null, allowedEffects: [], originalConfirmed: false,
  reuseTestContext: false, scenario: { version: 1, name: "Controlled", goal: "Reply", language: "en",
    steps: [{ kind: "text", text: "Hello", expected: { type: "reply" } }] }, ...over,
});
describe("laboratory certification gates", () => {
  it("does not confuse an internal suite with a real run", () => {
    expect(labSafetyChecks(request({ mode: "internal" }))).toEqual([]);
    expect(labSafetyChecks(request()).every(check => check.ok)).toBe(true);
  });
  it.each(["simulation", "autonomous"] as const)("blocks unmetered %s", mode => {
    expect(labSafetyChecks(request({ mode })).find(check => check.code === "paid_lab_execution_pending")?.ok).toBe(false);
  });
  it("does not equate a checkbox with validated billing isolation", () => {
    expect(labSafetyChecks(request({ targetKind: "original", originalConfirmed: true })).some(check => !check.ok)).toBe(true);
  });
  it("does not pretend a WhatsApp message is a Meta form event", () => {
    expect(labSafetyChecks(request({ formId: "123" })).some(check => !check.ok)).toBe(true);
  });
  it("accepts durable media and wait steps without charging waits as messages", () => {
    const input = request({ mode: "scripted" });
    input.scenario.steps.push({ kind: "wait", waitSeconds: 10, expected: { type: "reply" } });
    input.scenario.steps.push({ kind: "image", assetId: "controlled-asset", expected: { type: "reply" } });
    input.limits.maxMessages = 2;
    expect(labSafetyChecks(input).every(check => check.ok)).toBe(true);
    input.scenario.steps[1].waitSeconds = 1200;
    expect(labSafetyChecks(input).find(check => check.code === "script_waits_fit_deadline")?.ok).toBe(false);
  });
  it("refuses scripts that cannot fit their approved limits", () => {
    const input = request({ mode: "scripted" });
    input.limits.maxMessages = 1;
    input.scenario.steps.push(input.scenario.steps[0]);
    expect(labSafetyChecks(input).some(check => !check.ok)).toBe(true);
  });
  it("never approves only the completed prefix of a script", () => {
    expect(labAggregateVerdict(["passed"], 3, 1)).toBe("not_executed");
    expect(labAggregateVerdict(["passed", "not_executed"], 2, 2)).toBe("not_executed");
    expect(labAggregateVerdict(["passed", "inconclusive"], 2, 2)).toBe("inconclusive");
    expect(labAggregateVerdict(["passed", "failed"], 2, 2)).toBe("failed");
    expect(labAggregateVerdict(["passed", "expected_block"], 2, 2)).toBe("passed");
  });
  it.each(["paid_lab_execution", "cleanup_ownership"] as const)("requires certification for %s", capability => {
    expect(() => requireCertifiedLabCapability(capability)).toThrow(`${capability}_pending`);
  });
});
