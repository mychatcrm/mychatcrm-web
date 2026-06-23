import type { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type MetaFormAuthorizationSource =
  | "rule"
  | "mapping_current"
  | "unauthorized_form"
  | "no_matching_rule"
  | "invalid_agent"
  | "none";

export type MetaFormAuthorizationResult = {
  authorized: boolean;
  agentId: string | null;
  ruleId: string | null;
  source: MetaFormAuthorizationSource;
  reason: string;
};

export type MetaFormCrmAllowanceResult = {
  allowed: boolean;
  ruleId: string | null;
  reason: string;
};

export type MetaFormAuthRule = {
  id: string;
  page_id: string | null;
  use_all_forms: boolean | null;
  included_form_ids: unknown;
  excluded_form_ids: unknown;
  distribution_type: string;
  agent_ids: unknown;
  order_index?: number;
};

export type MetaFormTenantAuthRule = MetaFormAuthRule & {
  tenant_id: string;
};

export type MetaFormTenantResolutionResult =
  | {
      status: "resolved";
      tenantId: string;
      ruleId: string;
      reason: "active_rule_explicit_form";
    }
  | {
      status: "not_found";
      tenantIds: string[];
      reason: "missing_form_id" | "form_not_registered_in_lead_rules" | "rules_query_failed";
    }
  | {
      status: "ambiguous";
      tenantIds: string[];
      ruleIds: string[];
      reason: "ambiguous_meta_page_form_tenant";
    };

const AUTOMATION_DISTRIBUTION_TYPES = new Set([
  "automation_agent",
  "specific_agents",
  "round_robin",
]);

export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function ruleMatchesExplicitForm(rule: MetaFormAuthRule, formId: string, pageId: string): boolean {
  if (rule.page_id && rule.page_id !== pageId) return false;
  if (rule.use_all_forms === true) return false;
  const included = stringArray(rule.included_form_ids);
  return included.includes(formId);
}

export function metaRuleExplicitlyAuthorizesAgent(params: {
  rule: MetaFormAuthRule;
  formId: string;
  pageId: string;
  agentId: string;
}): boolean {
  return (
    ruleMatchesExplicitForm(params.rule, params.formId.trim(), params.pageId.trim()) &&
    AUTOMATION_DISTRIBUTION_TYPES.has(params.rule.distribution_type) &&
    stringArray(params.rule.agent_ids).includes(params.agentId.trim())
  );
}

function pickAgentFromRule(
  rule: MetaFormAuthRule,
  preferredAgentId?: string | null,
): string | null {
  const agentIds = stringArray(rule.agent_ids);
  if (agentIds.length === 0) return null;
  if (preferredAgentId) {
    return agentIds.includes(preferredAgentId) ? preferredAgentId : null;
  }
  return agentIds[0] ?? null;
}

export function resolveMetaTenantFromExplicitFormRulesSnapshot(params: {
  pageId: string;
  formId: string;
  rules: MetaFormTenantAuthRule[];
  candidateTenantIds?: string[];
}): MetaFormTenantResolutionResult {
  const formId = params.formId.trim();
  const pageId = params.pageId.trim();
  const candidateTenantIds = Array.from(
    new Set((params.candidateTenantIds ?? []).map((id) => id.trim()).filter(Boolean)),
  );

  if (!formId) {
    return {
      status: "not_found",
      tenantIds: candidateTenantIds,
      reason: "missing_form_id",
    };
  }

  const matches = params.rules
    .filter((rule) => rule.tenant_id.trim().length > 0)
    .filter((rule) => rule.page_id === pageId)
    .filter((rule) => ruleMatchesExplicitForm(rule, formId, pageId))
    .sort((a, b) => (a.order_index ?? 999) - (b.order_index ?? 999));

  if (matches.length === 0) {
    return {
      status: "not_found",
      tenantIds: candidateTenantIds,
      reason: "form_not_registered_in_lead_rules",
    };
  }

  const tenantIds = Array.from(new Set(matches.map((rule) => rule.tenant_id.trim())));
  if (tenantIds.length > 1) {
    return {
      status: "ambiguous",
      tenantIds,
      ruleIds: matches.map((rule) => rule.id),
      reason: "ambiguous_meta_page_form_tenant",
    };
  }

  const match = matches[0];
  return {
    status: "resolved",
    tenantId: match.tenant_id.trim(),
    ruleId: match.id,
    reason: "active_rule_explicit_form",
  };
}

/**
 * CRM gate: formulário precisa estar em regra meta_form ativa com included_form_ids explícito.
 * Não usa mapeamento, use_all_forms, default_agent_id nem fallbacks de tenant.
 */
export function evaluateMetaFormAllowedForCrmFromSnapshot(params: {
  pageId: string;
  formId: string;
  rules: MetaFormAuthRule[];
}): MetaFormCrmAllowanceResult {
  const formId = params.formId.trim();
  const pageId = params.pageId.trim();

  if (!formId) {
    return { allowed: false, ruleId: null, reason: "missing_form_id" };
  }

  const sortedRules = [...params.rules].sort(
    (a, b) => (a.order_index ?? 999) - (b.order_index ?? 999),
  );

  for (const rule of sortedRules) {
    if (!ruleMatchesExplicitForm(rule, formId, pageId)) continue;
    return {
      allowed: true,
      ruleId: rule.id,
      reason: "active_rule_explicit_form",
    };
  }

  return {
    allowed: false,
    ruleId: null,
    reason: "form_not_registered_in_lead_rules",
  };
}

export async function isMetaFormAllowedForCrm(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  pageId: string;
  formId: string;
}): Promise<MetaFormCrmAllowanceResult> {
  const rules = await loadActiveMetaFormRules(params.sb, params.tenantId);
  return evaluateMetaFormAllowedForCrmFromSnapshot({
    pageId: params.pageId,
    formId: params.formId,
    rules,
  });
}

/**
 * Pure evaluation for tests and ingest — no DB fallbacks.
 */
export function evaluateMetaFormAuthorizationFromSnapshot(params: {
  pageId: string;
  formId: string;
  agentId?: string | null;
  rules: MetaFormAuthRule[];
}): MetaFormAuthorizationResult {
  const formId = params.formId.trim();
  const pageId = params.pageId.trim();
  const preferredAgentId = params.agentId?.trim() || null;

  if (!formId) {
    return {
      authorized: false,
      agentId: null,
      ruleId: null,
      source: "no_matching_rule",
      reason: "missing_form_id",
    };
  }

  const sortedRules = [...params.rules].sort(
    (a, b) => (a.order_index ?? 999) - (b.order_index ?? 999),
  );

  for (const rule of sortedRules) {
    if (!ruleMatchesExplicitForm(rule, formId, pageId)) continue;
    if (!AUTOMATION_DISTRIBUTION_TYPES.has(rule.distribution_type)) continue;

    const picked = pickAgentFromRule(rule, preferredAgentId);
    if (preferredAgentId && !picked) {
      return {
        authorized: false,
        agentId: null,
        ruleId: rule.id,
        source: "unauthorized_form",
        reason: "form_not_authorized_for_agent",
      };
    }
    if (picked) {
      return {
        authorized: true,
        agentId: picked,
        ruleId: rule.id,
        source: "rule",
        reason: "active_rule_explicit_form",
      };
    }
  }

  if (preferredAgentId) {
    return {
      authorized: false,
      agentId: null,
      ruleId: null,
      source: "unauthorized_form",
      reason: "form_not_authorized_for_agent",
    };
  }

  return {
    authorized: false,
    agentId: null,
    ruleId: null,
    source: "no_matching_rule",
    reason: "no_active_rule_for_form",
  };
}

export async function loadActiveMetaFormRules(
  sb: SupabaseServiceClient,
  tenantId: string,
): Promise<MetaFormAuthRule[]> {
  const { data, error } = await sb
    .from("lead_distribution_rules")
    .select(
      "id, page_id, use_all_forms, included_form_ids, excluded_form_ids, distribution_type, agent_ids, order_index",
    )
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .eq("source", "meta_form")
    .order("order_index", { ascending: true });

  if (error) {
    console.warn("[meta-form-auth] rules_query_failed", { tenant_id: tenantId, error: error.message });
    return [];
  }
  return (data ?? []) as MetaFormAuthRule[];
}

export async function resolveMetaTenantFromExplicitFormRules(params: {
  sb: SupabaseServiceClient;
  pageId: string;
  formId: string;
  candidateTenantIds?: string[];
}): Promise<MetaFormTenantResolutionResult> {
  const pageId = params.pageId.trim();
  const { data, error } = await params.sb
    .from("lead_distribution_rules")
    .select(
      "id, tenant_id, page_id, use_all_forms, included_form_ids, excluded_form_ids, distribution_type, agent_ids, order_index",
    )
    .eq("active", true)
    .eq("source", "meta_form")
    .eq("page_id", pageId)
    .order("order_index", { ascending: true });

  if (error) {
    console.warn("[meta-form-auth] tenant_rules_query_failed", {
      page_id: pageId,
      error: error.message,
    });
    return {
      status: "not_found",
      tenantIds: params.candidateTenantIds ?? [],
      reason: "rules_query_failed",
    };
  }

  return resolveMetaTenantFromExplicitFormRulesSnapshot({
    pageId,
    formId: params.formId,
    rules: (data ?? []) as MetaFormTenantAuthRule[],
    candidateTenantIds: params.candidateTenantIds,
  });
}

async function pickRoundRobinAgent(
  sb: SupabaseServiceClient,
  tenantId: string,
  rule: MetaFormAuthRule,
  preferredAgentId?: string | null,
): Promise<string | null> {
  const agentIds = stringArray(rule.agent_ids);
  if (agentIds.length === 0) return null;
  if (agentIds.length === 1) return pickAgentFromRule(rule, preferredAgentId);
  if (preferredAgentId) return pickAgentFromRule(rule, preferredAgentId);

  const counts = await Promise.all(
    agentIds.map(async (aid) => {
      const { count } = await sb
        .from("leads")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("rule_id", rule.id)
        .eq("agent_id", aid);
      return { aid, count: count || 0 };
    }),
  );
  counts.sort((a, b) => a.count - b.count);
  return counts[0]?.aid ?? null;
}

/**
 * Resolves whether a Meta form may trigger automation for an agent (optional).
 */
export async function resolveMetaFormAuthorization(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  pageId: string;
  formId: string;
  agentId?: string | null;
}): Promise<MetaFormAuthorizationResult> {
  const formId = params.formId.trim();
  const pageId = params.pageId.trim();
  const rules = await loadActiveMetaFormRules(params.sb, params.tenantId);

  for (const rule of rules) {
    if (!ruleMatchesExplicitForm(rule, formId, pageId)) continue;
    if (!AUTOMATION_DISTRIBUTION_TYPES.has(rule.distribution_type)) continue;

    const picked =
      rule.distribution_type === "round_robin" && stringArray(rule.agent_ids).length > 1
        ? await pickRoundRobinAgent(params.sb, params.tenantId, rule, params.agentId)
        : pickAgentFromRule(rule, params.agentId);

    if (params.agentId?.trim() && !picked) {
      return {
        authorized: false,
        agentId: null,
        ruleId: rule.id,
        source: "unauthorized_form",
        reason: "form_not_authorized_for_agent",
      };
    }
    if (picked) {
      return {
        authorized: true,
        agentId: picked,
        ruleId: rule.id,
        source: "rule",
        reason: "active_rule_explicit_form",
      };
    }
  }

  return evaluateMetaFormAuthorizationFromSnapshot({
    pageId,
    formId,
    agentId: params.agentId,
    rules,
  });
}

/** @deprecated Prefer resolveMetaFormAuthorization — kept for explicit agent checks */
export async function isMetaFormAuthorizedForAgent(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  pageId: string;
  formId: string;
  agentId: string;
}): Promise<MetaFormAuthorizationResult> {
  return resolveMetaFormAuthorization({
    sb: params.sb,
    tenantId: params.tenantId,
    pageId: params.pageId,
    formId: params.formId,
    agentId: params.agentId,
  });
}

export async function isAnyAgentAuthorizedForMetaForm(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  pageId: string;
  formId: string;
}): Promise<boolean> {
  const result = await resolveMetaFormAuthorization(params);
  return result.authorized;
}

export async function isAgentExplicitlyAuthorizedForMetaForm(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  pageId: string;
  formId: string;
  agentId: string;
}): Promise<MetaFormAuthorizationResult> {
  const formId = params.formId.trim();
  const pageId = params.pageId.trim();
  const agentId = params.agentId.trim();

  if (!formId) {
    return { authorized: false, agentId: null, ruleId: null, source: "no_matching_rule", reason: "missing_form_id" };
  }
  if (!agentId) {
    return { authorized: false, agentId: null, ruleId: null, source: "invalid_agent", reason: "empty_agent_id" };
  }

  const rules = await loadActiveMetaFormRules(params.sb, params.tenantId);
  const match = rules.find((rule) => metaRuleExplicitlyAuthorizesAgent({ rule, formId, pageId, agentId }));
  if (!match) {
    return {
      authorized: false,
      agentId: null,
      ruleId: null,
      source: "unauthorized_form",
      reason: "form_not_explicitly_authorized_for_agent",
    };
  }

  return {
    authorized: true,
    agentId,
    ruleId: match.id,
    source: "rule",
    reason: "active_rule_explicit_form",
  };
}

export function crmBlockedUserMessage(reason: string): string {
  if (reason === "form_not_registered_in_lead_rules") {
    return "Formulário não cadastrado nas regras de integração";
  }
  if (reason === "missing_form_id") {
    return "Lead sem form_id — não entra no CRM";
  }
  return "Formulário não permitido no CRM";
}

export function unauthorizedUserMessage(reason: string, source: MetaFormAuthorizationSource): string {
  if (reason === "form_not_authorized_for_agent") {
    return "Formulário não autorizado para este agente";
  }
  if (source === "unauthorized_form" && reason === "orphan_mapping_without_active_rule") {
    return "Formulário não vinculado a nenhum agente (mapeamento desatualizado)";
  }
  return "Formulário não vinculado a nenhum agente";
}

async function isUsableTenantAgent(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  agentId: string | null | undefined;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const id = params.agentId?.trim();
  if (!id) return { ok: false, reason: "empty_agent_id" };
  const { data, error } = await params.sb
    .from("tenant_agents")
    .select("agent_id, active, metadata")
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", id)
    .maybeSingle();
  if (error) return { ok: false, reason: error.message };
  if (!data) return { ok: false, reason: "agent_not_found" };
  if (data.active !== true) return { ok: false, reason: "agent_inactive" };
  const metadata =
    data.metadata && typeof data.metadata === "object"
      ? (data.metadata as Record<string, unknown>)
      : {};
  const status = typeof metadata.status === "string" ? metadata.status : "ativo";
  if (status === "inativo" || status === "pausado") return { ok: false, reason: `metadata_${status}` };
  return { ok: true };
}

export type MetaFormAgentResolution = {
  agentId: string | null;
  ruleId: string | null;
  source: MetaFormAuthorizationSource;
  reason: string;
  authorized: boolean;
  invalidAgentId: string | null;
};

/**
 * Authorize Meta form → agent and validate agent is active. No instance/tenant fallbacks.
 */
export async function resolveAuthorizedMetaLeadAgent(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  pageId: string;
  formId: string;
}): Promise<MetaFormAgentResolution> {
  const auth = await resolveMetaFormAuthorization({
    sb: params.sb,
    tenantId: params.tenantId,
    pageId: params.pageId,
    formId: params.formId,
  });

  if (!auth.authorized || !auth.agentId) {
    return {
      agentId: null,
      ruleId: auth.ruleId,
      source: auth.source,
      reason: auth.reason,
      authorized: false,
      invalidAgentId: null,
    };
  }

  const usable = await isUsableTenantAgent({
    sb: params.sb,
    tenantId: params.tenantId,
    agentId: auth.agentId,
  });
  if (!usable.ok) {
    return {
      agentId: null,
      ruleId: auth.ruleId,
      source: "invalid_agent",
      reason: usable.reason,
      authorized: false,
      invalidAgentId: auth.agentId,
    };
  }

  return {
    agentId: auth.agentId,
    ruleId: auth.ruleId,
    source: auth.source,
    reason: auth.reason,
    authorized: true,
    invalidAgentId: null,
  };
}
