import { describe, expect, it } from "vitest";
import {
  evaluateMetaFormAllowedForCrmFromSnapshot,
  evaluateMetaFormAuthorizationFromSnapshot,
  type MetaFormAuthRule,
  type MetaFormTenantAuthRule,
  resolveMetaTenantFromExplicitFormRulesSnapshot,
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

function tenantRule(overrides: Partial<MetaFormTenantAuthRule> = {}): MetaFormTenantAuthRule {
  return {
    ...rule(),
    tenant_id: "tenant-a",
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

  it("allows CRM for an all-forms rule on the exact page", () => {
    const result = evaluateMetaFormAllowedForCrmFromSnapshot({
      pageId: PAGE,
      formId: FORM_OTHER,
      rules: [rule({ use_all_forms: true, included_form_ids: [FORM_OTHER] })],
    });
    expect(result.allowed).toBe(true);
  });

  it("blocks an explicitly excluded form in an all-forms rule", () => {
    const result = evaluateMetaFormAllowedForCrmFromSnapshot({
      pageId: PAGE,
      formId: FORM_OTHER,
      rules: [
        rule({
          use_all_forms: true,
          included_form_ids: [],
          excluded_form_ids: [FORM_OTHER],
        }),
      ],
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

describe("Meta tenant resolution by page + form", () => {
  it("resolves the tenant that owns the explicit page/form rule even when the page has duplicate connections", () => {
    const result = resolveMetaTenantFromExplicitFormRulesSnapshot({
      pageId: PAGE,
      formId: FORM_IN_RULES,
      candidateTenantIds: ["tenant-old", "tenant-a"],
      rules: [
        tenantRule({ tenant_id: "tenant-a", id: "rule-current" }),
        tenantRule({
          tenant_id: "tenant-old",
          id: "rule-old-other-form",
          included_form_ids: [FORM_OTHER],
        }),
      ],
    });

    expect(result).toMatchObject({
      status: "resolved",
      tenantId: "tenant-a",
      ruleId: "rule-current",
    });
  });

  it("blocks when no active rule explicitly includes the incoming form", () => {
    const result = resolveMetaTenantFromExplicitFormRulesSnapshot({
      pageId: PAGE,
      formId: FORM_OTHER,
      candidateTenantIds: ["tenant-a", "tenant-b"],
      rules: [tenantRule({ tenant_id: "tenant-a" })],
    });

    expect(result).toMatchObject({
      status: "not_found",
      reason: "form_not_registered_in_lead_rules",
      tenantIds: ["tenant-a", "tenant-b"],
    });
  });

  it("blocks as ambiguous when multiple tenants authorize the same page/form", () => {
    const result = resolveMetaTenantFromExplicitFormRulesSnapshot({
      pageId: PAGE,
      formId: FORM_IN_RULES,
      candidateTenantIds: ["tenant-a", "tenant-b"],
      rules: [
        tenantRule({ tenant_id: "tenant-a", id: "rule-a" }),
        tenantRule({ tenant_id: "tenant-b", id: "rule-b" }),
      ],
    });

    expect(result).toMatchObject({
      status: "ambiguous",
      reason: "ambiguous_meta_page_form_tenant",
      tenantIds: ["tenant-a", "tenant-b"],
      ruleIds: ["rule-a", "rule-b"],
    });
  });

  it("uses an all-forms rule only for its exact tenant and page", () => {
    const result = resolveMetaTenantFromExplicitFormRulesSnapshot({
      pageId: PAGE,
      formId: FORM_IN_RULES,
      candidateTenantIds: ["tenant-a"],
      rules: [
        tenantRule({
          use_all_forms: true,
          included_form_ids: [FORM_IN_RULES],
        }),
      ],
    });

    expect(result).toMatchObject({
      status: "resolved",
      tenantId: "tenant-a",
    });
  });

  it("blocks all-forms as ambiguous when two tenants claim the same page", () => {
    const result = resolveMetaTenantFromExplicitFormRulesSnapshot({
      pageId: PAGE,
      formId: FORM_IN_RULES,
      candidateTenantIds: ["tenant-a", "tenant-b"],
      rules: [
        tenantRule({
          tenant_id: "tenant-a",
          id: "rule-a",
          use_all_forms: true,
          included_form_ids: [],
        }),
        tenantRule({
          tenant_id: "tenant-b",
          id: "rule-b",
          use_all_forms: true,
          included_form_ids: [],
        }),
      ],
    });

    expect(result).toMatchObject({
      status: "ambiguous",
      tenantIds: ["tenant-a", "tenant-b"],
    });
  });

  it("ignores rules from tenants that do not own a candidate page connection", () => {
    const result = resolveMetaTenantFromExplicitFormRulesSnapshot({
      pageId: PAGE,
      formId: FORM_IN_RULES,
      candidateTenantIds: ["tenant-owner"],
      rules: [
        tenantRule({
          tenant_id: "tenant-attacker",
          id: "rule-attacker",
          use_all_forms: true,
          included_form_ids: [],
        }),
      ],
    });

    expect(result).toMatchObject({
      status: "not_found",
      tenantIds: ["tenant-owner"],
      reason: "form_not_registered_in_lead_rules",
    });
  });
});
