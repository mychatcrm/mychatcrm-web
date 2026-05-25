import { describe, expect, it } from "vitest";
import {
  evaluateMetaFormAuthorizationFromSnapshot,
  unauthorizedUserMessage,
  type MetaFormAuthRule,
} from "@/lib/server/meta-form-authorization";

const PAGE = "107104725336342";
const FORM_AUTHORIZED = "1297080185846833";
const FORM_OTHER = "1319582566784094";
const AGENT = "ag-max-vendas";
const AGENT_OTHER = "ag-other";

function rule(overrides: Partial<MetaFormAuthRule> = {}): MetaFormAuthRule {
  return {
    id: "rule-1",
    page_id: PAGE,
    use_all_forms: false,
    included_form_ids: [FORM_AUTHORIZED],
    excluded_form_ids: [],
    distribution_type: "automation_agent",
    agent_ids: [AGENT],
    order_index: 0,
    ...overrides,
  };
}

describe("meta-form-authorization", () => {
  it("authorizes form with active explicit rule", () => {
    const result = evaluateMetaFormAuthorizationFromSnapshot({
      pageId: PAGE,
      formId: FORM_AUTHORIZED,
      rules: [rule()],
    });
    expect(result.authorized).toBe(true);
    expect(result.agentId).toBe(AGENT);
    expect(result.source).toBe("rule");
    expect(result.ruleId).toBe("rule-1");
  });

  it("does not authorize form without matching rule", () => {
    const result = evaluateMetaFormAuthorizationFromSnapshot({
      pageId: PAGE,
      formId: FORM_OTHER,
      rules: [rule()],
    });
    expect(result.authorized).toBe(false);
    expect(result.agentId).toBeNull();
    expect(result.source).toBe("no_matching_rule");
  });

  it("does not authorize form only connected on page (use_all_forms)", () => {
    const result = evaluateMetaFormAuthorizationFromSnapshot({
      pageId: PAGE,
      formId: FORM_OTHER,
      rules: [rule({ use_all_forms: true, included_form_ids: [] })],
    });
    expect(result.authorized).toBe(false);
    expect(result.source).toBe("no_matching_rule");
  });

  it("does not authorize via orphan mapping without active rule", () => {
    const result = evaluateMetaFormAuthorizationFromSnapshot({
      pageId: PAGE,
      formId: FORM_OTHER,
      rules: [],
    });
    expect(result.authorized).toBe(false);
    expect(result.source).toBe("no_matching_rule");
  });

  it("rejects wrong agent for authorized form", () => {
    const result = evaluateMetaFormAuthorizationFromSnapshot({
      pageId: PAGE,
      formId: FORM_AUTHORIZED,
      agentId: AGENT_OTHER,
      rules: [rule()],
    });
    expect(result.authorized).toBe(false);
    expect(result.source).toBe("unauthorized_form");
    expect(result.reason).toBe("form_not_authorized_for_agent");
  });

  it("does not authorize via default_agent_id or tenant fallbacks (snapshot has no fallback path)", () => {
    const result = evaluateMetaFormAuthorizationFromSnapshot({
      pageId: PAGE,
      formId: FORM_OTHER,
      rules: [],
      mappingAgentId: null,
    });
    expect(result.authorized).toBe(false);
    expect(result.agentId).toBeNull();
    expect(["no_matching_rule", "unauthorized_form"]).toContain(result.source);
  });

  it("returns user-facing message for unauthorized form", () => {
    expect(unauthorizedUserMessage("no_active_rule_for_form", "no_matching_rule")).toContain(
      "não vinculado",
    );
    expect(unauthorizedUserMessage("form_not_authorized_for_agent", "unauthorized_form")).toContain(
      "não autorizado para este agente",
    );
  });

  it("does not match rule when page_id differs", () => {
    const result = evaluateMetaFormAuthorizationFromSnapshot({
      pageId: "other-page",
      formId: FORM_AUTHORIZED,
      rules: [rule()],
    });
    expect(result.authorized).toBe(false);
  });

  it("after rule deleted (empty rules), form is not authorized for agent", () => {
    const result = evaluateMetaFormAuthorizationFromSnapshot({
      pageId: PAGE,
      formId: FORM_AUTHORIZED,
      rules: [],
    });
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe("no_active_rule_for_form");
  });
});
