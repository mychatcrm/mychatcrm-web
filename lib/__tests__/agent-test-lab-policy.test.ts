import { describe, expect, it } from "vitest";
import { parseLabLimits, parseLabRunRequest, parseLabScenario } from "@/lib/agent-test-lab/contracts";
import { assertLabUuid, labOnlyExpectsSilence, labPhoneJid, labReceiptDisposition, labRuleMatches } from "@/lib/agent-test-lab/policy";
import { acceptsLabInbound } from "@/lib/agent-test-lab/webhook-policy";
import { parseLabAssetMetadata, validateLabFileSignature } from "@/lib/agent-test-lab/assets";

const scenario = { version: 1, name: "Generic", goal: "Verify configured behavior", language: "en", steps: [{ kind: "text", text: "Hello", expected: { type: "reply" } }] };
const base = { mode: "manual", profile: "short", targetKind: "original", tenantId: "tenant-test", agentId: "agent-a", channel: "evolution",
  connectionId: "c1", ruleId: "r1", scenario, originalConfirmed: true, allowedEffects: [] };
describe("agent test lab contracts", () => {
  it("requires per-run original approval", () => {
    expect(() => parseLabRunRequest({ ...base, originalConfirmed: false })).toThrow("original_confirmation_required");
  });
  it("does not accept arbitrary actions or commands", () => {
    expect(() => parseLabRunRequest({ ...base, mode: "shell" })).toThrow("invalid_mode");
    expect(() => parseLabRunRequest({ ...base, allowedEffects: ["exec"] })).toThrow("invalid_effect");
  });
  it("requires choosing a model for tester AI", () => {
    expect(() => parseLabRunRequest({ ...base, mode: "autonomous" })).toThrow("tester_model_required");
  });
  it("fixed profiles cannot be overridden by a public budget", () => {
    expect(parseLabLimits("short", { budgetBrl: 100000 })).toEqual({ maxMessages: 6, maxMinutes: 20, budgetBrl: 5 });
  });
  it.each([Infinity, NaN, -1, 0, 1001])("rejects invalid budgets %s", budgetBrl => {
    expect(() => parseLabLimits("custom", { maxMessages: 6, maxMinutes: 20, budgetBrl })).toThrow();
  });
  it.each(["ar", "ja", "zh-Hant", "hi", "ru", "es-MX", "en-GB", "pt-BR"]) ("accepts configured BCP-47 %s", language => {
    expect(parseLabScenario({ ...scenario, language }).language).toBe(language);
  });
  it("preserves text, accents and different alphabets", () => {
    const value = "  ação / acão / 予約 / مرحبًا  ";
    expect(parseLabScenario({ ...scenario, steps: [{ kind: "text", text: value, expected: { type: "reply" } }] }).steps[0].text).toBe(value);
  });
  it("does not silently accelerate timers", () => {
    expect(parseLabScenario({ ...scenario, steps: [{ kind: "wait", waitSeconds: 86400, expected: { type: "reminder" } }] }).steps[0].waitSeconds).toBe(86400);
  });
});
describe("exact identity and rule boundaries", () => {
  it.each(["12345@lid", "123@g.us", "../admin", "", "0000000000", "https://x.test", "1e10"]) ("does not guess a phone from %s", value => expect(labPhoneJid(value)).toBeNull());
  it("preserves international provider identifiers", () => {
    for (const value of ["+1 (415) 555-0100", "+44 20 7946 0018", "+81 3 1234 5678", "+55 62 99999-9999"]) {
      expect(labPhoneJid(value)).toBe(`${value.replace(/[^0-9]/g, "")}@s.whatsapp.net`);
    }
  });
  it("does not authorize a rule of another channel, tenant connection or agent", () => {
    const input = parseLabRunRequest(base);
    const rule = { active: true, source: "whatsapp_organico", agent_ids: [input.agentId], transport: "evolution", connection_id: input.connectionId };
    expect(labRuleMatches(input, rule)).toBe(true);
    for (const mismatch of [{ transport: "cloud_api" }, { connection_id: "other" }, { active: false }, { agent_ids: ["other"] }, { agent_ids: [input.agentId, "other"] }]) {
      expect(labRuleMatches(input, { ...rule, ...mismatch })).toBe(false);
    }
  });
  it("respects included and excluded Meta forms", () => {
    const input = parseLabRunRequest({ ...base, formId: "f1" });
    const rule = { active: true, source: "meta_form", agent_ids: [input.agentId], transport: "evolution", connection_id: input.connectionId, included_form_ids: ["f1"] };
    expect(labRuleMatches(input, rule)).toBe(true);
    expect(labRuleMatches(input, { ...rule, excluded_form_ids: ["f1"], use_all_forms: true })).toBe(false);
    expect(labRuleMatches(input, { ...rule, included_form_ids: ["other"] })).toBe(false);
  });
  it("no-rule exception applies only to an entirely silent scenario", () => {
    const silent = { kind: "text", text: "Hi", expected: { type: "silence" } };
    expect(labOnlyExpectsSilence(parseLabRunRequest({ ...base, ruleId: null, scenario: { ...scenario, steps: [silent] } }))).toBe(true);
    expect(labOnlyExpectsSilence(parseLabRunRequest({ ...base, ruleId: null, scenario: { ...scenario, steps: [silent, ...scenario.steps] } }))).toBe(false);
  });
  it("unknown receipt cannot authorize resend", () => {
    expect(labReceiptDisposition(true, false)).toBe("inconclusive");
    expect(labReceiptDisposition(true, true)).toBe("confirmed");
    expect(labReceiptDisposition(false, false)).toBe("send");
  });
  it("UUID parser rejects injected resource paths", () => expect(() => assertLabUuid("../../delete-all")).toThrow());
});
describe("private webhook inbox", () => {
  const input = { fromMe: false, providerTime: "2026-09-09T12:01:00Z", remoteJid: "14155550100@s.whatsapp.net", targetJid: "14155550100@s.whatsapp.net",
    runCreatedAt: "2026-09-09T12:00:00Z", deadlineAt: "2026-09-09T12:20:00Z", now: Date.parse("2026-09-09T12:02:00Z") };
  it("accepts only evidence from the active authorized contact", () => expect(acceptsLabInbound(input)).toBe(true));
  it.each([{ fromMe: true }, { remoteJid: "442079460018@s.whatsapp.net" }, { providerTime: null }, { providerTime: "invalid" },
    { providerTime: "2026-09-08T12:00:00Z" }, { providerTime: "2026-09-10T12:00:00Z" }, { now: Date.parse("2026-09-10T12:00:00Z") }])("rejects history/unlisted contact/expired run %j", extra => expect(acceptsLabInbound({ ...input, ...extra })).toBe(false));
});
describe("controlled media", () => {
  it("caps uploads at 20 MB", () => {
    expect(() => parseLabAssetMetadata({ filename: "a.pdf", byteSize: 20971521, expectedFacts: [] })).toThrow();
    expect(parseLabAssetMetadata({ filename: "a.pdf", byteSize: 20971520, expectedFacts: [] }).kind).toBe("document");
  });
  it.each(["a.exe", "a.svg", "../a.pdf", "a.html", "a\u0000.pdf"]) ("rejects file %s", filename => expect(() => parseLabAssetMetadata({ filename, byteSize: 100, expectedFacts: [] })).toThrow());
  it("does not trust only MIME or extension", () => {
    expect(validateLabFileSignature(new TextEncoder().encode("MZ executable"), "pdf")).toBe(false);
    expect(validateLabFileSignature(new TextEncoder().encode("<script>alert(1)</script>"), "txt")).toBe(false);
    expect(validateLabFileSignature(new TextEncoder().encode("%PDF-1.7"), "pdf")).toBe(true);
  });
});
