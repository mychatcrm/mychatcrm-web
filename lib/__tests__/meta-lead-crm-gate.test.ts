import { describe, expect, it } from "vitest";
import {
  evaluateMetaFormAllowedForCrmFromSnapshot,
  evaluateMetaFormAuthorizationFromSnapshot,
  type MetaFormAuthRule,
} from "@/lib/server/meta-form-authorization";

const PAGE = "107104725336342";
const FORM_IN_RULES = "1297080185846833";
const FORM_OTHER = "1319582566784094";
const AGENT = "ag-max-vendas";

function rule(overrides: Partial<MetaFormAuthRule> = {}): MetaFormAuthRule {
  return {
    id: "rule-1",
    page_id: PAGE,
    use_all_forms: false,
    included_form_ids: [FORM_IN_RULES],
    excluded_form_ids: [],
    distribution_type: "automation_agent",
    agent_ids: [AGENT],
    order_index: 0,
    ...overrides,
  };
}

describe("Meta CRM gate (isMetaFormAllowedForCrm)", () => {
  it("allows CRM when form is in active explicit rule", () => {
    const result = evaluateMetaFormAllowedForCrmFromSnapshot({
      pageId: PAGE,
      formId: FORM_IN_RULES,
      rules: [rule()],
    });
    expect(result.allowed).toBe(true);
    expect(result.ruleId).toBe("rule-1");
  });

  it("blocks CRM when form is not in any rule", () => {
    const result = evaluateMetaFormAllowedForCrmFromSnapshot({
      pageId: PAGE,
      formId: FORM_OTHER,
      rules: [rule()],
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("form_not_registered_in_lead_rules");
  });

  it("blocks CRM for use_all_forms even if page matches", () => {
    const result = evaluateMetaFormAllowedForCrmFromSnapshot({
      pageId: PAGE,
      formId: FORM_OTHER,
      rules: [rule({ use_all_forms: true, included_form_ids: [FORM_OTHER] })],
    });
    expect(result.allowed).toBe(false);
  });

  it("allows CRM for rule without agent (manual CRM only)", () => {
    const result = evaluateMetaFormAllowedForCrmFromSnapshot({
      pageId: PAGE,
      formId: FORM_IN_RULES,
      rules: [rule({ agent_ids: [], distribution_type: "round_robin" })],
    });
    expect(result.allowed).toBe(true);
  });

  it("orphan mapping does not allow CRM or agent", () => {
    const crm = evaluateMetaFormAllowedForCrmFromSnapshot({
      pageId: PAGE,
      formId: FORM_OTHER,
      rules: [],
    });
    expect(crm.allowed).toBe(false);

    const agent = evaluateMetaFormAuthorizationFromSnapshot({
      pageId: PAGE,
      formId: FORM_OTHER,
      rules: [],
    });
    expect(agent.authorized).toBe(false);
  });
});

describe("Meta agent vs CRM separation", () => {
  it("form in rules + agent in rule → agent authorized for WhatsApp", () => {
    const agent = evaluateMetaFormAuthorizationFromSnapshot({
      pageId: PAGE,
      formId: FORM_IN_RULES,
      rules: [rule()],
    });
    expect(agent.authorized).toBe(true);
    expect(agent.agentId).toBe(AGENT);
  });

  it("form in rules without agent → CRM allowed, agent not authorized", () => {
    const crm = evaluateMetaFormAllowedForCrmFromSnapshot({
      pageId: PAGE,
      formId: FORM_IN_RULES,
      rules: [rule({ agent_ids: [] })],
    });
    const agent = evaluateMetaFormAuthorizationFromSnapshot({
      pageId: PAGE,
      formId: FORM_IN_RULES,
      rules: [rule({ agent_ids: [] })],
    });
    expect(crm.allowed).toBe(true);
    expect(agent.authorized).toBe(false);
  });

  it("form removed from rules → CRM blocked on next evaluation", () => {
    const crm = evaluateMetaFormAllowedForCrmFromSnapshot({
      pageId: PAGE,
      formId: FORM_IN_RULES,
      rules: [],
    });
    expect(crm.allowed).toBe(false);
  });

  it("default_agent_id path does not exist in snapshot (no authorization without rule)", () => {
    const agent = evaluateMetaFormAuthorizationFromSnapshot({
      pageId: PAGE,
      formId: FORM_OTHER,
      rules: [],
    });
    expect(agent.authorized).toBe(false);
    expect(agent.agentId).toBeNull();
  });
});
