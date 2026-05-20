import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeadDistributionRuleRow } from "@/lib/server/lead-distribution-rules";

const GRAPH = "https://graph.facebook.com/v19.0";

type MetaLeadgenFormsResponse = {
  data?: Array<{ id?: string; name?: string }>;
  paging?: { next?: string };
};

async function listLeadgenForms(pageId: string, pageAccessToken: string): Promise<Array<{ id: string; name: string | null }>> {
  const forms: Array<{ id: string; name: string | null }> = [];
  let nextUrl: string | undefined = `${GRAPH}/${encodeURIComponent(pageId)}/leadgen_forms?fields=id,name&access_token=${encodeURIComponent(pageAccessToken)}`;

  while (nextUrl && forms.length < 500) {
    const res = await fetch(nextUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return forms;
    const data = (await res.json()) as MetaLeadgenFormsResponse;
    for (const form of data.data ?? []) {
      if (form.id) forms.push({ id: form.id, name: form.name ?? null });
    }
    nextUrl = data.paging?.next;
  }

  return forms;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

export async function syncMetaFormAgentMappingForRule(
  sb: SupabaseClient,
  rule: LeadDistributionRuleRow,
): Promise<void> {
  if (rule.source !== "meta_form") return;
  if (rule.distribution_type !== "automation_agent" && rule.distribution_type !== "specific_agents") return;

  const [agentId] = stringArray(rule.agent_ids);
  if (!agentId) return;

  const tenantId = rule.tenant_id;
  const pageId = rule.page_id?.trim() || null;
  let formRows: Array<{ form_id: string; form_name?: string | null }> = [];

  if (rule.use_all_forms === false) {
    formRows = stringArray(rule.included_form_ids).map((formId) => ({ form_id: formId }));
  } else if (pageId) {
    const { data: connection } = await sb
      .from("meta_connections")
      .select("page_access_token")
      .eq("tenant_id", tenantId)
      .eq("page_id", pageId)
      .maybeSingle();

    const pageAccessToken = typeof connection?.page_access_token === "string" ? connection.page_access_token : "";
    if (!pageAccessToken) return;

    const excluded = new Set(stringArray(rule.excluded_form_ids));
    const forms = await listLeadgenForms(pageId, pageAccessToken);
    formRows = forms
      .filter((form) => !excluded.has(form.id))
      .map((form) => ({ form_id: form.id, form_name: form.name }));
  }

  if (!formRows.length) return;

  const rows = formRows.map((form) => ({
    tenant_id: tenantId,
    form_id: form.form_id,
    form_name: form.form_name ?? null,
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
}
