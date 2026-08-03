import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeadDistributionRuleRow } from "@/lib/server/lead-distribution-rules";
import { stringArray } from "@/lib/server/meta-form-authorization";
import {
  ensureTenantPageLeadgenWebhookSubscription,
  type TenantPageLeadgenSubscriptionResult,
} from "@/lib/server/meta-page-webhook-subscribe";

export async function deleteMetaFormAgentMapping(
  sb: SupabaseClient,
  tenantId: string,
  formId: string,
): Promise<void> {
  const id = formId.trim();
  if (!id) return;
  const { error } = await sb
    .from("meta_form_agent_mapping")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("form_id", id);
  if (error) {
    console.warn("[lead-rules] meta_form_agent_mapping delete failed", {
      tenant_id: tenantId,
      form_id: id,
      error: error.message,
    });
  }
}

export async function deleteMetaFormMappingsForRule(
  sb: SupabaseClient,
  rule: Pick<LeadDistributionRuleRow, "tenant_id" | "included_form_ids" | "agent_ids">,
): Promise<void> {
  const tenantId = rule.tenant_id;
  const formIds = stringArray(rule.included_form_ids);
  const agentIds = new Set(stringArray(rule.agent_ids));
  if (formIds.length === 0 || agentIds.size === 0) return;

  for (const formId of formIds) {
    const { data: row } = await sb
      .from("meta_form_agent_mapping")
      .select("agent_id")
      .eq("tenant_id", tenantId)
      .eq("form_id", formId)
      .maybeSingle();
    if (row?.agent_id && agentIds.has(row.agent_id)) {
      await deleteMetaFormAgentMapping(sb, tenantId, formId);
    }
  }
}

/**
 * Removes mappings that are not backed by an active explicit meta_form rule (form_id + agent_id).
 */
export async function reconcileMetaFormMappingsWithRules(
  sb: SupabaseClient,
  tenantId: string,
): Promise<{ removedFormIds: string[] }> {
  const { data: rules, error: rulesError } = await sb
    .from("lead_distribution_rules")
    .select("included_form_ids, agent_ids, page_id, use_all_forms, distribution_type, active, source")
    .eq("tenant_id", tenantId)
    .eq("source", "meta_form")
    .eq("active", true);

  if (rulesError) {
    console.warn("[lead-rules] reconcile rules query failed", rulesError.message);
    return { removedFormIds: [] };
  }

  const authorized = new Set<string>();
  for (const rule of rules ?? []) {
    if (rule.use_all_forms === true) continue;
    const formIds = stringArray(rule.included_form_ids);
    const agentIds = stringArray(rule.agent_ids);
    for (const formId of formIds) {
      for (const agentId of agentIds) {
        authorized.add(`${formId}:${agentId}`);
      }
    }
  }

  const { data: mappings, error: mapError } = await sb
    .from("meta_form_agent_mapping")
    .select("form_id, agent_id")
    .eq("tenant_id", tenantId);

  if (mapError) {
    console.warn("[lead-rules] reconcile mappings query failed", mapError.message);
    return { removedFormIds: [] };
  }

  const removedFormIds: string[] = [];
  for (const row of mappings ?? []) {
    const formId = typeof row.form_id === "string" ? row.form_id : "";
    const agentId = typeof row.agent_id === "string" ? row.agent_id : "";
    if (!formId || !agentId) continue;
    if (authorized.has(`${formId}:${agentId}`)) continue;
    await deleteMetaFormAgentMapping(sb, tenantId, formId);
    removedFormIds.push(formId);
    console.info("[lead-rules] removed orphan meta_form_agent_mapping", {
      tenant_id: tenantId,
      form_id: formId,
      agent_id: agentId,
    });
  }

  return { removedFormIds };
}

export async function syncMetaFormAgentMappingForRule(
  sb: SupabaseClient,
  rule: LeadDistributionRuleRow,
): Promise<void> {
  if (rule.source !== "meta_form") return;
  if (rule.distribution_type !== "automation_agent" && rule.distribution_type !== "specific_agents") return;
  if (rule.use_all_forms === true) {
    console.warn("[lead-rules] use_all_forms sync skipped — explicit forms only", { rule_id: rule.id });
    return;
  }

  const [agentId] = stringArray(rule.agent_ids);
  if (!agentId) return;

  const tenantId = rule.tenant_id;
  const pageId = rule.page_id?.trim() || null;
  const formRows = stringArray(rule.included_form_ids).map((formId) => ({ form_id: formId }));

  if (!formRows.length) return;

  const rows = formRows.map((form) => ({
    tenant_id: tenantId,
    form_id: form.form_id,
    form_name: null as string | null,
    agent_id: agentId,
    page_id: pageId,
  }));

  const { error } = await sb.from("meta_form_agent_mapping").upsert(rows, { onConflict: "tenant_id,form_id" });
  if (error) {
    console.warn("[lead-rules] meta_form_agent_mapping sync failed", {
      tenant_id: tenantId,
      rule_id: rule.id,
      form_count: rows.length,
      error: error.message,
    });
  }

  await reconcileMetaFormMappingsWithRules(sb, tenantId);
}

export async function ensureMetaLeadWebhookSubscriptionForRule(
  sb: SupabaseClient,
  rule: LeadDistributionRuleRow,
): Promise<TenantPageLeadgenSubscriptionResult | null> {
  if (rule.source !== "meta_form") return null;
  if (rule.active === false) return null;
  const pageId = rule.page_id?.trim();
  if (!pageId) return null;

  const result = await ensureTenantPageLeadgenWebhookSubscription({
    sb,
    tenantId: rule.tenant_id,
    pageId,
  });

  const logPayload = {
    tenant_id: rule.tenant_id,
    rule_id: rule.id,
    page_id: result.pageId,
    page_name: result.pageName,
    was_subscribed: result.wasSubscribed,
    ok: result.ok,
    error: result.error,
  };
  if (result.ok) {
    console.info("[lead-rules] meta page leadgen webhook subscription ensured", logPayload);
  } else {
    console.warn("[lead-rules] meta page leadgen webhook subscription failed", logPayload);
  }

  return result;
}

/** Keeps the historical-lead boundary stable across unrelated rule edits. */
export async function syncMetaFormCaptureBoundariesForRule(
  sb: SupabaseClient,
  rule: LeadDistributionRuleRow,
): Promise<void> {
  const isActiveMetaRule = rule.source === "meta_form" && rule.active !== false;
  const { error } = await sb.rpc("sync_meta_form_capture_boundaries", {
    p_tenant_id: rule.tenant_id,
    p_rule_id: rule.id,
    p_page_id: rule.page_id?.trim() || null,
    p_form_ids: stringArray(rule.included_form_ids),
    p_use_all_forms: rule.use_all_forms === true,
    p_active: isActiveMetaRule,
  });
  if (error) throw new Error(`meta_capture_boundary_sync_failed:${error.message}`);
}
