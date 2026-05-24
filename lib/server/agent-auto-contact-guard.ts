import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  isAgentExplicitlyAuthorizedForMetaForm,
  metaRuleExplicitlyAuthorizesAgent,
  type MetaFormAuthRule,
} from "@/lib/server/meta-form-authorization";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type AutoContactGuardResult =
  | { ok: true; reason: "allowed"; leadId: string | null; formId: string | null }
  | { ok: false; reason: string; leadId: string | null; formId: string | null };

type LeadContactSnapshot = {
  id: string;
  source: string | null;
  phone: string | null;
  profile_metadata: unknown;
};

function normalizePhone(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isMetaLikeSource(source: string | null | undefined): boolean {
  const normalized = (source ?? "").toLowerCase();
  return (
    normalized === "lead_ads" ||
    normalized.includes("meta") ||
    normalized.includes("facebook") ||
    normalized.includes("form")
  );
}

function triggerRequiresMetaAuthorization(triggerSource: string): boolean {
  const normalized = triggerSource.toLowerCase();
  return (
    normalized.includes("meta") ||
    normalized.includes("lead_ads") ||
    normalized.includes("form") ||
    normalized.includes("campaign")
  );
}

export function evaluateCanAgentAutoContactLeadSnapshot(params: {
  agentActive: boolean;
  agentStatus?: string | null;
  agentId: string | null;
  leadSource?: string | null;
  triggerSource: string;
  formId?: string | null;
  pageId?: string | null;
  rules: MetaFormAuthRule[];
}): AutoContactGuardResult {
  const agentId = params.agentId?.trim() ?? "";
  const agentStatus = params.agentStatus?.trim() ?? "ativo";
  const formId = params.formId?.trim() || null;
  const pageId = params.pageId?.trim() || null;

  if (!agentId) return { ok: false, reason: "missing_agent_id", leadId: null, formId };
  if (!params.agentActive || agentStatus === "inativo" || agentStatus === "pausado") {
    return { ok: false, reason: "agent_inactive", leadId: null, formId };
  }

  const needsMetaAuth =
    isMetaLikeSource(params.leadSource) || triggerRequiresMetaAuthorization(params.triggerSource);
  if (!needsMetaAuth) return { ok: true, reason: "allowed", leadId: null, formId };

  if (!formId) return { ok: false, reason: "missing_meta_form_id", leadId: null, formId };
  if (!pageId) return { ok: false, reason: "missing_meta_page_id", leadId: null, formId };

  const authorized = params.rules.some((rule) =>
    metaRuleExplicitlyAuthorizesAgent({ rule, formId, pageId, agentId }),
  );
  if (!authorized) {
    return {
      ok: false,
      reason: "blocked_unauthorized_form",
      leadId: null,
      formId,
    };
  }

  return { ok: true, reason: "allowed", leadId: null, formId };
}

async function loadLead(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  leadId?: string | null;
  phone?: string | null;
}): Promise<LeadContactSnapshot | null> {
  if (params.leadId) {
    const { data } = await params.sb
      .from("leads")
      .select("id, source, phone, profile_metadata")
      .eq("tenant_id", params.tenantId)
      .eq("id", params.leadId)
      .maybeSingle();
    return (data as LeadContactSnapshot | null) ?? null;
  }

  const phone = normalizePhone(params.phone);
  if (!phone) return null;
  const { data } = await params.sb
    .from("leads")
    .select("id, source, phone, profile_metadata")
    .eq("tenant_id", params.tenantId)
    .eq("phone", phone)
    .maybeSingle();
  return (data as LeadContactSnapshot | null) ?? null;
}

async function loadAgentStatus(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
}): Promise<{ active: boolean; status: string | null }> {
  const { data } = await params.sb
    .from("tenant_agents")
    .select("active, metadata")
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .maybeSingle();
  const metadata = metadataObject((data as { metadata?: unknown } | null)?.metadata);
  return {
    active: (data as { active?: boolean } | null)?.active === true,
    status: text(metadata.status),
  };
}

export async function canAgentAutoContactLead(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  agentId: string | null | undefined;
  leadId?: string | null;
  phone?: string | null;
  source?: string | null;
  formId?: string | null;
  pageId?: string | null;
  leadgenId?: string | null;
  triggerSource: string;
}): Promise<AutoContactGuardResult> {
  const agentId = params.agentId?.trim() ?? "";
  if (!agentId) return { ok: false, reason: "missing_agent_id", leadId: params.leadId ?? null, formId: params.formId ?? null };

  const [agent, lead] = await Promise.all([
    loadAgentStatus({ sb: params.sb, tenantId: params.tenantId, agentId }),
    loadLead({ sb: params.sb, tenantId: params.tenantId, leadId: params.leadId, phone: params.phone }),
  ]);

  if (!agent.active || agent.status === "inativo" || agent.status === "pausado") {
    return { ok: false, reason: "agent_inactive", leadId: lead?.id ?? params.leadId ?? null, formId: params.formId ?? null };
  }

  const meta = metadataObject(lead?.profile_metadata);
  const source = params.source ?? lead?.source ?? text(meta.source);
  const formId = params.formId ?? text(meta.meta_form_id);
  const pageId = params.pageId ?? text(meta.meta_page_id);
  const leadId = lead?.id ?? params.leadId ?? null;

  const needsMetaAuth =
    isMetaLikeSource(source) || triggerRequiresMetaAuthorization(params.triggerSource) || Boolean(params.leadgenId ?? text(meta.meta_leadgen_id));
  if (!needsMetaAuth) return { ok: true, reason: "allowed", leadId, formId: formId ?? null };

  if (!formId) return { ok: false, reason: "missing_meta_form_id", leadId, formId: null };
  if (!pageId) return { ok: false, reason: "missing_meta_page_id", leadId, formId };

  const auth = await isAgentExplicitlyAuthorizedForMetaForm({
    sb: params.sb,
    tenantId: params.tenantId,
    pageId,
    formId,
    agentId,
  });

  if (!auth.authorized) {
    console.warn("[auto-contact-guard] blocked", {
      tenant_id: params.tenantId,
      agent_id: agentId,
      lead_id: leadId,
      form_id: formId,
      trigger_source: params.triggerSource,
      reason: auth.reason,
    });
    return { ok: false, reason: "blocked_unauthorized_form", leadId, formId };
  }

  return { ok: true, reason: "allowed", leadId, formId };
}
