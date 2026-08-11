import {
  generateAgentResponse,
  isAgentMissingInstructionsResult,
} from "@/lib/ai/generate-agent-response";
import { remoteJidToEvoNumber } from "@/lib/integrations/evolution-api";
import { upsertConversationState } from "@/lib/server/conversation-memory";
import { resolveAgentCrmFieldsForLeadInsert } from "@/lib/server/auto-lead-upsert";
import { buildNewLeadCrmFields, promoteLeadToContatoOnAgentEngagement } from "@/lib/server/crm-lead-lifecycle";
import { canAgentAutoContactLead } from "@/lib/server/agent-auto-contact-guard";
import { MetaLeadEventRecorder } from "@/lib/server/meta-lead-events-db";
import { buildLeadTeamPatch, loadRuleTeamAssignment } from "@/lib/server/meta-lead-team-assignment";
import {
  crmBlockedUserMessage,
  isMetaFormAllowedForCrm,
  resolveMetaTenantFromExplicitFormRules,
  resolveAuthorizedMetaLeadAgent,
  unauthorizedUserMessage,
} from "@/lib/server/meta-form-authorization";
import {
  buildFallbackInitialMessage,
  buildLeadProfileMetadata,
  buildMetaInitialAgentPrompt,
  fetchFormQuestionLabels,
  fetchGraphLead,
  fetchGraphObjectField,
  type GraphLeadResponse,
  mergeLeadProfileMetadata,
  parseFieldData,
  resolveMetaLeadAdAttribution,
  sanitizeInitialReply,
} from "@/lib/server/meta-lead-graph";
import {
  buildWhatsappRemoteJid,
  extractLeadName,
  extractLeadPhone,
  shouldSkipMetaOutreachForHumanAttending,
} from "@/lib/server/meta-lead-processing";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  applyLeadRuleMappingsToFields,
  type AppliedLeadRuleMapping,
} from "@/lib/lead-rule-field-mapping";
import type { LeadFieldMapping } from "@/lib/lead-distribution-rules";
import {
  activateLeadJourney,
  authorizeActiveJourney,
  isJourneyIsolationEnabled,
  touchLeadJourney,
} from "@/lib/server/lead-journeys";
import { scheduleLeadRedistribution } from "@/lib/server/lead-redistribution";
import {
  commitTenantLeadQuotaReservation,
  releaseTenantLeadQuotaReservation,
  reserveTenantLeadQuota,
} from "@/lib/server/lead-quota";
import { getTenantPlanSnapshot } from "@/lib/server/tenant-plan-snapshot";
import { persistEvolutionSendReceipt } from "@/lib/server/evolution-customer-delivery";
import {
  resolveMetaLeadWhatsappConnection,
  sendMetaLeadInitialWhatsapp,
} from "@/lib/server/meta-lead-whatsapp-outreach";
import {
  cancelAutomatedOutboundByOperationKey,
  markAgentOutboundAmbiguous,
  markAgentOutboundFailed,
  markAgentOutboundSent,
  prepareAutomatedOutbound,
  reconcileAgentOutboundProviderReceipt,
} from "@/lib/server/agent-outbound-outbox";

type MetaConnectionRow = {
  tenant_id: string;
  page_access_token: string | null;
  /** Necessário pra ler campanha/conjunto/anúncio — page_access_token não basta (ver resolveMetaLeadAdAttribution). */
  user_access_token?: string | null;
  page_name?: string | null;
  health_status?: string | null;
};

export type LeadgenValue = {
  leadgen_id: string;
  page_id: string;
  form_id?: string;
  ad_id?: string;
  ad_group_id?: string;
  created_time?: number;
};

export class MetaLeadgenProcessingError extends Error {
  readonly processingCode: string;
  readonly retryable: boolean;

  constructor(
    processingCode: string,
    retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(processingCode, options);
    this.name = "MetaLeadgenProcessingError";
    this.processingCode = processingCode;
    this.retryable = retryable;
  }
}

function maskPhoneLast4(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.slice(-4) || "empty";
}

function classifyInitialSendFailure(params: {
  status?: number;
  error?: string | null;
}): { retryable: boolean; ambiguous: boolean } {
  const status = Number(params.status ?? 0);
  const error = String(params.error ?? "").toLowerCase();
  if (
    status === 0 ||
    /timeout|timed out|network|fetch|socket|econn|enotfound/.test(error)
  ) {
    return { retryable: false, ambiguous: true };
  }
  if (error === "evolution_delivery_error") {
    return { retryable: true, ambiguous: false };
  }
  if (status === 409 || status === 425 || status === 429) {
    return { retryable: true, ambiguous: false };
  }
  if (status >= 500) {
    return { retryable: false, ambiguous: true };
  }
  return { retryable: false, ambiguous: false };
}

async function revealMetaConversation(params: {
  sb: ReturnType<typeof createSupabaseServiceClient>;
  tenantId: string;
  remoteJid: string;
  leadId: string;
  agentId: string;
  lastMessageAt: string;
  journeyId?: string | null;
}) {
  return upsertConversationState({
    sb: params.sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    leadId: params.leadId,
    agentId: params.agentId,
    channel: "whatsapp",
    lastMessageAt: params.lastMessageAt,
    isHidden: false,
    archivedAt: null,
    hiddenAt: null,
    hiddenBy: null,
    activeJourneyId: params.journeyId ?? null,
  });
}

function timestampMsFromSeconds(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value * 1000;
}

function timestampMsFromDb(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function uniqueTenantIds(connections: MetaConnectionRow[]): string[] {
  return Array.from(new Set(connections.map((conn) => conn.tenant_id).filter(Boolean)));
}

async function loadMetaConnectionsForPage(params: {
  sb: ReturnType<typeof createSupabaseServiceClient>;
  pageId: string;
}): Promise<MetaConnectionRow[]> {
  const { data, error } = await params.sb
    .from("meta_connections")
    .select("tenant_id, page_access_token, user_access_token, page_name, health_status")
    .eq("page_id", params.pageId);

  if (error) {
    console.warn("[meta-webhook] meta_connections_query_failed", {
      page_id: params.pageId,
      error: error.message,
    });
    throw new MetaLeadgenProcessingError(
      "meta_connections_query_failed",
      true,
      { cause: error },
    );
  }

  const allConnections = ((data ?? []) as MetaConnectionRow[]).filter(
    (connection) => Boolean(connection.tenant_id),
  );
  const operational = allConnections.filter((connection) =>
    ["ready", "degraded", "legacy_grace"].includes(
      connection.health_status ?? "",
    ),
  );
  if (operational.length > 0) return operational;
  if (
    allConnections.some((connection) =>
      ["provisioning", "retrying", "unverified"].includes(
        connection.health_status ?? "unverified",
      ),
    )
  ) {
    throw new MetaLeadgenProcessingError(
      "meta_connection_not_operational_yet",
      true,
    );
  }
  if (allConnections.length > 0) {
    throw new MetaLeadgenProcessingError(
      "meta_connection_not_operational",
      false,
    );
  }
  return [];
}

async function recordBlockedMetaLeadForTenants(params: {
  sb: ReturnType<typeof createSupabaseServiceClient>;
  tenantIds: string[];
  connections: MetaConnectionRow[];
  value: LeadgenValue;
  step:
    | "blocked_form_not_registered_in_lead_rules"
    | "blocked_ambiguous_meta_page_form_tenant"
    | "blocked_missing_meta_connection_for_resolved_tenant";
  reason: string;
  formId: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  detail?: Record<string, unknown>;
}) {
  const tenantIds = Array.from(new Set(params.tenantIds.filter(Boolean)));
  await Promise.all(
    tenantIds.map(async (tenantId) => {
      const connection = params.connections.find((conn) => conn.tenant_id === tenantId);
      const recorder = new MetaLeadEventRecorder(params.sb, {
        tenant_id: tenantId,
        leadgen_id: params.value.leadgen_id,
        page_id: params.value.page_id,
        form_id: params.formId,
        ad_id: params.value.ad_id ?? null,
        adset_id: params.value.ad_group_id ?? null,
        raw_webhook: params.value as Record<string, unknown>,
      });
      await recorder.init();
      await recorder.patch({
        page_name: connection?.page_name?.trim() || null,
        name: params.name ?? null,
        phone: params.phone || null,
        email: params.email ?? null,
      });
      await recorder.step(params.step, {
        reason: params.reason,
        ...(params.detail ?? {}),
      });
      await recorder.patch({
        crm_sync_status: "blocked",
        whatsapp_status: "blocked",
        error_message: params.reason,
        current_step: params.step,
      });
    }),
  );
}

async function loadRuleActivationStartedAtMs(params: {
  sb: ReturnType<typeof createSupabaseServiceClient>;
  tenantId: string;
  ruleId: string | null;
  pageId: string;
  formId: string;
}): Promise<number | null> {
  if (!params.ruleId) return null;
  const { data, error } = await params.sb
    .from("meta_form_capture_boundaries")
    .select("activated_at")
    .eq("tenant_id", params.tenantId)
    .eq("rule_id", params.ruleId)
    .eq("page_id", params.pageId)
    .in("form_id", [params.formId, "*"])
    .order("form_id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new MetaLeadgenProcessingError(
      "meta_rule_activation_query_failed",
      true,
      { cause: error },
    );
  }
  if (!data) {
    throw new MetaLeadgenProcessingError(
      "meta_rule_activation_missing",
      true,
    );
  }
  return timestampMsFromDb((data as { activated_at?: unknown }).activated_at);
}

async function loadLeadRuleMappings(params: {
  sb: ReturnType<typeof createSupabaseServiceClient>;
  tenantId: string;
  ruleId: string | null;
}): Promise<LeadFieldMapping[]> {
  if (!params.ruleId) return [];
  const { data, error } = await params.sb
    .from("lead_distribution_rules")
    .select("mappings")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.ruleId)
    .maybeSingle();
  if (error || !data) {
    if (error) {
      console.warn("[meta-webhook] Failed to load lead rule mappings", {
        tenant_id: params.tenantId,
        rule_id: params.ruleId,
        error: error.message,
      });
      throw new MetaLeadgenProcessingError(
        "meta_rule_mappings_query_failed",
        true,
        { cause: error },
      );
    }
    throw new MetaLeadgenProcessingError(
      "meta_rule_mappings_missing",
      true,
    );
  }
  const mappings = (data as { mappings?: unknown }).mappings;
  return Array.isArray(mappings) ? (mappings as LeadFieldMapping[]) : [];
}

function buildMappingMetadata(params: {
  ruleId: string | null;
  mappings: LeadFieldMapping[];
  applied: AppliedLeadRuleMapping;
}): Record<string, unknown> | null {
  if (params.mappings.length === 0) return null;
  return {
    rule_id: params.ruleId,
    mapped_fields: params.applied.mappedFields,
    mapped_company: params.applied.company,
    mapped_observations: params.applied.observations,
  };
}

export async function processMetaLeadgenEvent(value: LeadgenValue): Promise<void> {
  const { leadgen_id, page_id, form_id, ad_id, ad_group_id } = value;
  if (!leadgen_id || !page_id) {
    console.warn("[meta-webhook] Missing leadgen_id or page_id — skipping");
    return;
  }

  const sb = createSupabaseServiceClient();

  const connections = await loadMetaConnectionsForPage({ sb, pageId: page_id });
  if (connections.length === 0) {
    console.warn("[meta-webhook] No tenant found for page_id", { page_id });
    return;
  }
  const candidateTenantIds = uniqueTenantIds(connections);
  const resolvedFormId = (form_id ?? "").trim();

  const tenantResolution = await resolveMetaTenantFromExplicitFormRules({
    sb,
    pageId: page_id,
    formId: resolvedFormId,
    candidateTenantIds,
  });

  if (tenantResolution.status === "not_found") {
    if (tenantResolution.reason === "rules_query_failed") {
      throw new MetaLeadgenProcessingError(
        "meta_lead_rules_query_failed",
        true,
      );
    }
    const tenantsToRecord = tenantResolution.tenantIds.length > 0 ? tenantResolution.tenantIds : candidateTenantIds;
    await recordBlockedMetaLeadForTenants({
      sb,
      tenantIds: tenantsToRecord,
      connections,
      value,
      step: "blocked_form_not_registered_in_lead_rules",
      reason: tenantResolution.reason,
      formId: resolvedFormId || null,
      detail: {
        page_id,
        form_id: resolvedFormId || null,
      },
    });
    console.warn("[meta-webhook] Meta form blocked before CRM — no matching lead rule", {
      page_id,
      form_id: resolvedFormId || null,
      leadgen_id,
      reason: tenantResolution.reason,
      candidate_tenant_ids: candidateTenantIds,
    });
    return;
  }

  if (tenantResolution.status === "ambiguous") {
    await recordBlockedMetaLeadForTenants({
      sb,
      tenantIds: tenantResolution.tenantIds,
      connections,
      value,
      step: "blocked_ambiguous_meta_page_form_tenant",
      reason: tenantResolution.reason,
      formId: resolvedFormId || null,
      detail: {
        page_id,
        form_id: resolvedFormId || null,
        rule_ids: tenantResolution.ruleIds,
      },
    });
    console.warn("[meta-webhook] Meta form blocked before CRM — ambiguous tenant resolution", {
      page_id,
      form_id: resolvedFormId || null,
      leadgen_id,
      tenant_ids: tenantResolution.tenantIds,
      rule_ids: tenantResolution.ruleIds,
    });
    return;
  }

  const conn = connections.find((connection) => connection.tenant_id === tenantResolution.tenantId);
  if (!conn?.page_access_token?.trim()) {
    await recordBlockedMetaLeadForTenants({
      sb,
      tenantIds: [tenantResolution.tenantId],
      connections,
      value,
      step: "blocked_missing_meta_connection_for_resolved_tenant",
      reason: "missing_meta_connection_for_resolved_tenant",
      formId: resolvedFormId || null,
      detail: {
        page_id,
        form_id: resolvedFormId || null,
        rule_id: tenantResolution.ruleId,
      },
    });
    console.warn("[meta-webhook] Meta form blocked before CRM — missing connection for resolved tenant", {
      tenant_id: tenantResolution.tenantId,
      page_id,
      form_id: resolvedFormId || null,
      leadgen_id,
      rule_id: tenantResolution.ruleId,
    });
    return;
  }

  const { tenant_id, page_access_token, user_access_token, page_name: connPageName } = conn as {
    tenant_id: string;
    page_access_token: string;
    user_access_token?: string | null;
    page_name?: string | null;
  };

  // Resolve the owning tenant before retrieving any personal data. A token
  // from another tenant that happens to share the same Page must never be used
  // to bypass that tenant's own Leads Access state.
  let lead: Awaited<ReturnType<typeof fetchGraphLead>>;
  try {
    lead = await fetchGraphLead(leadgen_id, page_access_token);
  } catch (error) {
    const recorder = new MetaLeadEventRecorder(sb, {
      tenant_id,
      leadgen_id,
      page_id,
      form_id: resolvedFormId || null,
      ad_id: ad_id ?? null,
      adset_id: ad_group_id ?? null,
      raw_webhook: value as Record<string, unknown>,
    });
    await recorder.init();
    await recorder.patch({
      page_name: connPageName?.trim() || null,
      error_message: "graph_api_fetch_failed",
    });
    await recorder.step("graph_fetch_failed");
    console.warn("[meta-webhook] Could not fetch lead from Graph API", {
      tenant_id,
      page_id,
      leadgen_id,
    });
    throw error;
  }
  const graphFormId = lead.form_id?.trim() ?? "";
  if (graphFormId && graphFormId !== resolvedFormId) {
    await recordBlockedMetaLeadForTenants({
      sb,
      tenantIds: [tenant_id],
      connections,
      value,
      step: "blocked_form_not_registered_in_lead_rules",
      reason: "graph_form_id_mismatch",
      formId: resolvedFormId || null,
      detail: {
        page_id,
        webhook_form_id: resolvedFormId || null,
        graph_form_id: graphFormId,
        rule_id: tenantResolution.ruleId,
      },
    });
    console.warn("[meta-webhook] Graph lead form differs from webhook rule", {
      tenant_id,
      page_id,
      leadgen_id,
      webhook_form_id: resolvedFormId,
      graph_form_id: graphFormId,
    });
    return;
  }

  const webhookObservedAt = new Date().toISOString();
  const { error: webhookHealthError } = await sb
    .from("meta_connections")
    .update({
      last_webhook_at: webhookObservedAt,
      lead_access_status: "verified_by_delivery",
      last_lead_access_verified_at: webhookObservedAt,
      updated_at: webhookObservedAt,
    })
    .eq("tenant_id", tenant_id)
    .eq("page_id", page_id);
  if (webhookHealthError) {
    console.warn("[meta-webhook] delivery proof update failed", {
      tenant_id,
      page_id,
      error: webhookHealthError.message,
    });
  }

  const fields = parseFieldData(lead.field_data ?? []);
  let phone = extractLeadPhone(fields);
  let fullName = extractLeadName(fields);
  let email = fields.email ?? null;

  const eventRecorder = new MetaLeadEventRecorder(sb, {
    tenant_id,
    leadgen_id,
    page_id,
    form_id: resolvedFormId || form_id || null,
    ad_id: ad_id ?? null,
    adset_id: ad_group_id ?? null,
    raw_webhook: value as Record<string, unknown>,
  });
  await eventRecorder.init();
  await eventRecorder.patch({ page_name: connPageName?.trim() || null });
  await eventRecorder.step("meta_tenant_resolved_by_form_rule", {
    rule_id: tenantResolution.ruleId,
    form_id: resolvedFormId || null,
  });
  await eventRecorder.step("graph_data_fetched");

  console.info("[meta-webhook] meta_tenant_resolved_by_form_rule", {
    tenant_id,
    page_id,
    form_id: resolvedFormId || null,
    rule_id: tenantResolution.ruleId,
    leadgen_id,
  });

  await eventRecorder.patch({ name: fullName, phone: phone || null, email });

  const crmAllowance = await isMetaFormAllowedForCrm({
    sb,
    tenantId: tenant_id,
    pageId: page_id,
    formId: resolvedFormId,
    throwOnQueryError: true,
  });

  if (!crmAllowance.allowed) {
    const userMessage = crmBlockedUserMessage(crmAllowance.reason);
    await eventRecorder.step("blocked_form_not_registered_in_lead_rules", {
      reason: crmAllowance.reason,
    });
    await eventRecorder.patch({
      crm_sync_status: "blocked",
      whatsapp_status: "blocked",
      error_message: crmAllowance.reason,
      current_step: "blocked_form_not_registered_in_lead_rules",
    });
    console.warn("[meta-webhook] Meta form blocked before CRM — not in lead rules", {
      tenant_id,
      page_id,
      form_id: resolvedFormId || null,
      leadgen_id,
      reason: crmAllowance.reason,
      user_message: userMessage,
    });
    return;
  }

  const ruleId = crmAllowance.ruleId;
  const ruleMappings = await loadLeadRuleMappings({
    sb,
    tenantId: tenant_id,
    ruleId,
  });
  const appliedMapping = applyLeadRuleMappingsToFields(fields, ruleMappings, {
    formId: resolvedFormId || null,
  });
  if (appliedMapping.name) fullName = appliedMapping.name;
  if (appliedMapping.phone) phone = appliedMapping.phone;
  if (appliedMapping.email) email = appliedMapping.email;

  await eventRecorder.patch({ name: fullName, phone: phone || null, email });

  if (!phone) {
    await eventRecorder.step("skipped_no_phone", { field_keys: Object.keys(fields), rule_id: ruleId });
    await eventRecorder.patch({ whatsapp_status: "skipped", error_message: "no_phone_in_form" });
    console.warn("[meta-webhook] Lead has no phone — cannot route via WhatsApp", {
      leadgen_id,
      field_keys: Object.keys(fields),
      rule_id: ruleId,
    });
    return;
  }

  const leadCreatedAtMs = timestampMsFromSeconds(value.created_time) ?? timestampMsFromDb(lead.created_time);
  const activationStartedAtMs = await loadRuleActivationStartedAtMs({
    sb,
    tenantId: tenant_id,
    ruleId,
    pageId: page_id,
    formId: resolvedFormId,
  });
  if (!leadCreatedAtMs || !activationStartedAtMs || leadCreatedAtMs < activationStartedAtMs) {
    await eventRecorder.step("blocked_historical_lead", {
      rule_id: ruleId,
      lead_created_time: value.created_time ?? lead.created_time ?? null,
    });
    await eventRecorder.patch({
      crm_sync_status: "blocked",
      whatsapp_status: "blocked",
      error_message: "historical_meta_lead_before_rule_activation",
      current_step: "blocked_historical_lead",
    });
    console.warn("[meta-webhook] Historical Meta lead blocked before CRM import", {
      tenant_id,
      page_id,
      form_id: resolvedFormId || null,
      leadgen_id,
      rule_id: ruleId,
      lead_created_time: value.created_time ?? lead.created_time ?? null,
      activation_started_at_ms: activationStartedAtMs,
    });
    return;
  }

  const agentResolution = await resolveAuthorizedMetaLeadAgent({
    sb,
    tenantId: tenant_id,
    pageId: page_id,
    formId: resolvedFormId,
    throwOnQueryError: true,
  });
  const agentId = agentResolution.authorized ? agentResolution.agentId : null;

  await eventRecorder.step("agent_resolved", {
    agent_id: agentId,
    source: agentResolution.source,
    rule_id: agentResolution.ruleId ?? ruleId,
    authorized: agentResolution.authorized,
    reason: agentResolution.reason,
  });
  await eventRecorder.patch({
    agent_id: agentId,
    agent_resolution_source: agentResolution.source,
  });

  const attribution = await resolveMetaLeadAdAttribution({
    pageAccessToken: page_access_token,
    userAccessToken: user_access_token,
    graphLead: lead,
    webhook: value as Record<string, unknown>,
    webhookAdId: ad_id ?? null,
    webhookAdsetId: ad_group_id ?? null,
    webhookFormId: form_id ?? null,
  });

  const effectiveFormId = resolvedFormId || attribution.formId || undefined;
  const formName = effectiveFormId
    ? await fetchGraphObjectField(effectiveFormId, "name", page_access_token)
    : null;

  const questionLabels = effectiveFormId
    ? await fetchFormQuestionLabels(effectiveFormId, page_access_token)
    : new Map<string, string>();

  const baseLeadMetadata = buildLeadProfileMetadata({
    leadgenId: leadgen_id,
    fieldData: lead.field_data ?? [],
    formId: effectiveFormId ?? form_id,
    formName,
    adId: attribution.adId ?? undefined,
    adsetId: attribution.adsetId ?? undefined,
    pageId: page_id,
    pageName: connPageName?.trim() || null,
    campaignId: attribution.campaignId ?? undefined,
    campaignName: attribution.campaignName,
    adsetName: attribution.adsetName,
    adName: attribution.adName,
    agentResolutionSource: agentResolution.source,
    invalidAgentId: agentResolution.invalidAgentId ?? null,
    rawWebhook: value as Record<string, unknown>,
    questionLabels,
  });
  const mappingMetadata = buildMappingMetadata({
    ruleId,
    mappings: ruleMappings,
    applied: appliedMapping,
  });
  const leadMetadata = mappingMetadata
    ? {
        ...baseLeadMetadata,
        lead_rule_mapping: mappingMetadata,
      }
    : baseLeadMetadata;

  await eventRecorder.step("form_fields_saved");
  await eventRecorder.patch({
    form_name: formName,
    form_fields: leadMetadata.form_fields ?? [],
    profile_metadata: leadMetadata,
    campaign_id: attribution.campaignId ?? null,
    campaign_name: attribution.campaignName ?? null,
    adset_id: attribution.adsetId ?? null,
    adset_name: attribution.adsetName ?? null,
    ad_id: attribution.adId ?? null,
    ad_name: attribution.adName ?? null,
  });

  const crmFunnel = await resolveAgentCrmFieldsForLeadInsert(sb, {
    tenantId: tenant_id,
    agentId,
  });
  const newLeadCrm = buildNewLeadCrmFields(crmFunnel.crm_funnel_id);

  const { data: existingLead, error: existingLeadError } = await sb
    .from("leads")
    .select(
      "id, created_at, campaign_active, agent_id, campaign_agent_id, profile_metadata, team_id, owner_employee_id",
    )
    .eq("tenant_id", tenant_id)
    .eq("phone", phone)
    .maybeSingle();
  if (existingLeadError) {
    throw new MetaLeadgenProcessingError(
      "existing_lead_lookup_failed",
      true,
      { cause: existingLeadError },
    );
  }

  const isNewLead = !existingLead;
  const tenantPlan = await getTenantPlanSnapshot(tenant_id);
  const quotaAdmission = await reserveTenantLeadQuota({
    tenantId: tenant_id,
    plan: tenantPlan.plan,
    operationalLimits: tenantPlan.operationalLimits,
    contactKey: phone,
    source: "meta_form",
    idempotencyKey: `meta:${leadgen_id}:lead-admission`,
    isExistingContact: !isNewLead,
    metadata: {
      leadgen_id,
      page_id,
      form_id: resolvedFormId || null,
      rule_id: ruleId,
    },
  });
  if (!quotaAdmission.admitted) {
    if (
      quotaAdmission.status === "unavailable" ||
      quotaAdmission.reason === "lead_quota_unavailable"
    ) {
      throw new MetaLeadgenProcessingError(
        "lead_quota_unavailable",
        true,
      );
    }
    const reason = quotaAdmission.reason === "lead_quota_exhausted"
      ? "blocked_lead_quota_exhausted"
      : "blocked_lead_quota_unavailable";
    await eventRecorder.step(reason, {
      quota_reason: quotaAdmission.reason,
      used: quotaAdmission.used,
      cap: quotaAdmission.cap,
      cycle_start: quotaAdmission.cycleStart,
    });
    await eventRecorder.patch({
      crm_sync_status: "blocked",
      whatsapp_status: "blocked",
      error_message: quotaAdmission.reason,
      current_step: reason,
    });
    console.warn("[meta-webhook] new lead blocked by quota", {
      tenant_id,
      leadgen_id,
      reason: quotaAdmission.reason,
      used: quotaAdmission.used,
      cap: quotaAdmission.cap,
    });
    return;
  }
  const journeyIsolationEnabled = isJourneyIsolationEnabled();
  const deferJourneyAttribution =
    journeyIsolationEnabled && Boolean(agentId && agentResolution.authorized);
  const attributionPayload = {
    agent_id: agentId ?? existingLead?.agent_id ?? null,
    campaign_agent_id: agentId,
    campaign_active: Boolean(agentId),
    agent_assignment_source: agentId ? "meta_rule" : "unassigned",
    rule_id: ruleId,
    campaign_rule_id: ruleId,
    profile_metadata: isNewLead
      ? leadMetadata
      : mergeLeadProfileMetadata(existingLead?.profile_metadata, leadMetadata),
  };

  // Carimbo de equipe: o lead herda a equipe da regra que o admitiu — sem isto
  // ele nasce sem equipe e só o titular da conta o veria. No modo
  // "IA + Vendedor" já nasce atribuído ao vendedor escolhido na regra.
  const teamPatch = buildLeadTeamPatch({
    assignment: await loadRuleTeamAssignment(sb, tenant_id, ruleId),
    isNewLead,
    currentTeamId: (existingLead as { team_id?: string | null } | null)?.team_id ?? null,
    currentOwnerEmployeeId:
      (existingLead as { owner_employee_id?: string | null } | null)?.owner_employee_id ?? null,
  });

  const upsertPayload: Record<string, unknown> = isNewLead
    ? {
        tenant_id,
        phone,
        name: fullName,
        email: email ?? undefined,
        source: "lead_ads",
        last_seen: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...newLeadCrm,
        ...teamPatch,
        ...(deferJourneyAttribution ? {} : attributionPayload),
      }
    : {
        tenant_id,
        phone,
        name: fullName,
        email: email ?? undefined,
        source: "lead_ads",
        last_seen: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...teamPatch,
        ...(deferJourneyAttribution ? {} : { ...attributionPayload, ...crmFunnel }),
      };

  const { data: upsertedLead, error: upsertErr } = await sb
    .from("leads")
    .upsert(upsertPayload, {
      onConflict: "tenant_id,phone",
      ignoreDuplicates: false,
    })
    .select("id, profile_metadata")
    .maybeSingle();

  if (upsertErr) {
    await releaseTenantLeadQuotaReservation(quotaAdmission.eventId, "crm_lead_upsert_failed");
    await eventRecorder.step("crm_lead_failed", { error: upsertErr.message });
    await eventRecorder.patch({ crm_sync_status: "failed", error_message: upsertErr.message });
    console.error("[meta-webhook] Failed to upsert lead", {
      error: upsertErr.message,
      phone_last4: maskPhoneLast4(phone),
    });
    throw new MetaLeadgenProcessingError(
      "crm_lead_upsert_failed",
      true,
      { cause: upsertErr },
    );
  }

  await eventRecorder.step(isNewLead ? "crm_lead_created" : "crm_lead_updated");
  await eventRecorder.patch({
    crm_sync_status: "synced",
    lead_id: upsertedLead?.id ?? null,
  });

  console.info("[meta-webhook] Lead upserted", {
    lead_id: upsertedLead?.id,
    phone_last4: maskPhoneLast4(phone),
    agentId,
    authorized: agentResolution.authorized,
    is_new: isNewLead,
  });

  const leadId = upsertedLead?.id;
  if (!leadId) {
    await releaseTenantLeadQuotaReservation(quotaAdmission.eventId, "lead_id_missing_after_upsert");
    await eventRecorder.patch({ whatsapp_status: "skipped", error_message: "lead_id_missing_after_upsert" });
    throw new MetaLeadgenProcessingError(
      "lead_id_missing_after_upsert",
      true,
    );
  }
  try {
    await commitTenantLeadQuotaReservation({ eventId: quotaAdmission.eventId, leadId });
  } catch (quotaCommitError) {
    // The lead is already durable; do not lie about its CRM state or retry an
    // outbound message. A reserved entry will expire safely and is logged for
    // operational repair.
    console.error("[meta-webhook] lead quota commit failed", {
      tenant_id,
      lead_id: leadId,
      error: quotaCommitError instanceof Error ? quotaCommitError.message : String(quotaCommitError),
    });
  }

  if (!agentId || !agentResolution.authorized) {
    await eventRecorder.step("skipped_no_agent");
    if (!agentResolution.authorized) {
      await eventRecorder.patch({
        whatsapp_status: "blocked",
        error_message: agentResolution.reason,
      });
    } else {
      await eventRecorder.patch({ whatsapp_status: "skipped", error_message: "no_valid_agent" });
    }
    console.warn("[meta-webhook] No authorized agent — skipping automation", {
      tenant_id,
      lead_id: upsertedLead?.id,
      phone_last4: maskPhoneLast4(phone),
      source: agentResolution.source,
      reason: agentResolution.reason,
    });
    return;
  }

  const remoteJid = buildWhatsappRemoteJid(phone);
  const evoNumber = remoteJidToEvoNumber(remoteJid);
  if (!evoNumber) {
    await eventRecorder.patch({ whatsapp_status: "skipped", error_message: "invalid_remote_jid" });
    console.warn("[meta-webhook] Invalid remoteJid after phone normalization — skipping", {
      tenant_id,
      lead_id: leadId,
      phone_last4: maskPhoneLast4(phone),
    });
    return;
  }

  const autoContactGuard = await canAgentAutoContactLead({
    sb,
    tenantId: tenant_id,
    agentId,
    leadId,
    phone,
    remoteJid,
    journeyId: null,
    source: "lead_ads",
    formId: resolvedFormId,
    pageId: page_id,
    leadgenId: leadgen_id,
    connectionId: agentResolution.connectionId,
    triggerSource: "meta_lead_ingest",
  });
  if (!autoContactGuard.ok) {
    await eventRecorder.step("blocked_unauthorized_form", {
      reason: autoContactGuard.reason,
      form_id: autoContactGuard.formId,
    });
    await eventRecorder.patch({
      whatsapp_status: "blocked",
      error_message: autoContactGuard.reason,
      current_step: "blocked_unauthorized_form",
    });
    console.warn("[meta-webhook] Auto contact guard blocked outreach", {
      tenant_id,
      lead_id: leadId,
      agent_id: agentId,
      form_id: autoContactGuard.formId,
      reason: autoContactGuard.reason,
      phone_last4: maskPhoneLast4(phone),
    });
    return;
  }

  const selectedConnectionId = agentResolution.connectionId;
  if (!selectedConnectionId) {
    await eventRecorder.step("skipped_selected_connection_unavailable", {
      connection_id: null,
      reason: "connection_not_selected",
    });
    await eventRecorder.patch({
      whatsapp_status: "skipped",
      error_message: "selected_rule_connection_not_selected",
      current_step: "skipped_selected_connection_unavailable",
    });
    console.warn("[meta-webhook] selected rule connection unavailable", {
      tenant_id,
      lead_id: leadId,
      agent_id: agentId,
      connection_id: null,
      reason: "connection_not_selected",
    });
    return;
  }

  const resolvedConnection = await resolveMetaLeadWhatsappConnection({
    tenantId: tenant_id,
    connectionId: selectedConnectionId,
    transport: agentResolution.transport,
    metaTemplateName: agentResolution.metaTemplateName,
    metaTemplateLang: agentResolution.metaTemplateLang,
  });
  if (!resolvedConnection.ok) {
    await eventRecorder.step("skipped_selected_connection_unavailable", {
      connection_id: selectedConnectionId,
      transport: agentResolution.transport,
      reason: resolvedConnection.reason,
    });
    await eventRecorder.patch({
      whatsapp_status: "skipped",
      error_message: `selected_rule_connection_${resolvedConnection.reason}`,
      current_step: "skipped_selected_connection_unavailable",
    });
    console.warn("[meta-webhook] selected rule connection unavailable", {
      tenant_id,
      lead_id: leadId,
      agent_id: agentId,
      connection_id: selectedConnectionId,
      transport: agentResolution.transport,
      reason: resolvedConnection.reason,
    });
    return;
  }
  if (resolvedConnection.transport === "evolution" && resolvedConnection.fallbackFromCloud) {
    await eventRecorder.step("cloud_to_evolution_fallback", {
      connection_id: selectedConnectionId,
      evolution_instance_id: resolvedConnection.instance.id,
      reason: resolvedConnection.fallbackFromCloud.reason,
    });
    console.warn("[meta-webhook] cloud_to_evolution_fallback", {
      tenant_id,
      lead_id: leadId,
      agent_id: agentId,
      connection_id: selectedConnectionId,
      reason: resolvedConnection.fallbackFromCloud.reason,
      instance_name: resolvedConnection.instance.instance_name,
    });
  }
  if (resolvedConnection.transport === "evolution" && resolvedConnection.adoptedSibling) {
    await eventRecorder.step("selected_connection_reconciled", {
      connection_id: selectedConnectionId,
      instance_name: resolvedConnection.instance.instance_name,
    });
    console.warn("[meta-webhook] selected connection reconciled", {
      tenant_id,
      lead_id: leadId,
      agent_id: agentId,
      connection_id: selectedConnectionId,
      instance_name: resolvedConnection.instance.instance_name,
    });
  }

  const journeyConnectionId =
    resolvedConnection.transport === "cloud_api"
      ? resolvedConnection.phoneNumberId
      : resolvedConnection.instance.id;

  const journey = await activateLeadJourney({
    sb,
    tenantId: tenant_id,
    remoteJid,
    phone,
    leadId,
    agentId,
    ruleId,
    connectionId: journeyConnectionId,
    source: "meta_form",
    sourceRef: leadgen_id,
    pageId: page_id,
    formId: resolvedFormId,
    metadata: {
      form_name: formName,
      lead_profile: leadMetadata,
      campaign_id: attribution.campaignId ?? null,
      campaign_name: attribution.campaignName ?? null,
      adset_id: attribution.adsetId ?? null,
      ad_id: attribution.adId ?? null,
      whatsapp_transport: resolvedConnection.transport,
      rule_connection_id: selectedConnectionId,
      ...(resolvedConnection.transport === "evolution" && resolvedConnection.fallbackFromCloud
        ? {
            cloud_to_evolution_fallback: true,
            fallback_reason: resolvedConnection.fallbackFromCloud.reason,
          }
        : {}),
    },
  });
  if (journeyIsolationEnabled && (!journey || journey.status !== "active")) {
    const reason =
      journey?.status === "manual_review"
        ? "journey_requires_manual_review"
        : journey?.status === "superseded"
          ? "journey_conflict_kept_existing"
          : "journey_activation_failed";
    await eventRecorder.step("automation_blocked_by_journey", {
      reason,
      journey_id: journey?.id ?? null,
      journey_status: journey?.status ?? null,
    });
    await eventRecorder.patch({
      whatsapp_status: "blocked",
      error_message: reason,
      current_step: "automation_blocked_by_journey",
    });
    console.warn("[meta-webhook] Journey did not acquire automation", {
      tenant_id,
      lead_id: leadId,
      agent_id: agentId,
      journey_id: journey?.id ?? null,
      journey_status: journey?.status ?? null,
    });
    return;
  }
  const journeyId = journey?.id ?? null;

  if (deferJourneyAttribution) {
    const { error: attributionError } = await sb
      .from("leads")
      .update({
        ...attributionPayload,
        ...crmFunnel,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenant_id)
      .eq("id", leadId);
    if (attributionError) {
      await eventRecorder.step("crm_attribution_failed", {
        error: attributionError.message,
        journey_id: journeyId,
      });
      await eventRecorder.patch({
        whatsapp_status: "blocked",
        error_message: "crm_attribution_failed",
      });
      console.error("[meta-webhook] Failed to persist winning journey attribution", {
        tenant_id,
        lead_id: leadId,
        journey_id: journeyId,
        error: attributionError.message,
      });
      throw new MetaLeadgenProcessingError(
        "crm_attribution_failed",
        true,
        { cause: attributionError },
      );
    }
    await eventRecorder.step("crm_attribution_committed", {
      journey_id: journeyId,
      agent_id: agentId,
      rule_id: ruleId,
    });
  }

  const initialMessageExternalId = `meta:${leadgen_id}:initial`;
  const outboundOperationKey = `meta-leadgen:${leadgen_id}:initial`;
  const { data: existingInitialMessage, error: existingMessageError } = await sb
    .from("whatsapp_messages")
    .select("id, content, delivery_status, provider_message_id, sent_at, created_at")
    .eq("tenant_id", tenant_id)
    .eq("message_id", initialMessageExternalId)
    .maybeSingle();
  if (existingMessageError) {
    throw new MetaLeadgenProcessingError(
      "initial_whatsapp_message_lookup_failed",
      true,
      { cause: existingMessageError },
    );
  }
  let resumableInitialMessage: {
    id: string;
    content: string;
    delivery_status: string | null;
  } | null = null;
  if (existingInitialMessage?.id) {
    await sb
      .from("whatsapp_messages")
      .update({ journey_id: journeyId })
      .eq("tenant_id", tenant_id)
      .eq("id", existingInitialMessage.id)
      .is("journey_id", null);
    const alreadySent =
      ["sent", "delivered", "read"].includes(
        existingInitialMessage.delivery_status ?? "",
      ) ||
      Boolean(
        existingInitialMessage.delivery_status === "pending" &&
        existingInitialMessage.provider_message_id,
      );
    if (alreadySent) {
      if (
        typeof existingInitialMessage.provider_message_id === "string" &&
        existingInitialMessage.provider_message_id.trim()
      ) {
        await reconcileAgentOutboundProviderReceipt({
          sb,
          tenantId: tenant_id,
          operationKey: outboundOperationKey,
          providerMessageId:
            existingInitialMessage.provider_message_id.trim(),
        });
      }
      await revealMetaConversation({
        sb,
        tenantId: tenant_id,
        remoteJid,
        leadId,
        agentId,
        journeyId,
        lastMessageAt:
          typeof existingInitialMessage.sent_at === "string"
            ? existingInitialMessage.sent_at
            : typeof existingInitialMessage.created_at === "string"
              ? existingInitialMessage.created_at
              : new Date().toISOString(),
      });
    }
    if (alreadySent) {
      await eventRecorder.step("whatsapp_sent", { reason: "same_leadgen_already_sent", message_id: existingInitialMessage.id });
      await eventRecorder.patch({ whatsapp_status: "sent", error_message: null, current_step: "whatsapp_sent" });
      console.info("[meta-webhook] Initial outreach already accepted", {
        tenant_id,
        lead_id: leadId,
        phone_last4: maskPhoneLast4(phone),
        reason: "same_leadgen_already_sent",
        delivery_status: existingInitialMessage.delivery_status ?? null,
      });
      return;
    }

    const persistedContent =
      typeof existingInitialMessage.content === "string"
        ? existingInitialMessage.content.trim()
        : "";
    if (
      ["pending", "failed"].includes(
        existingInitialMessage.delivery_status ?? "",
      ) &&
      persistedContent
    ) {
      resumableInitialMessage = {
        id: existingInitialMessage.id,
        content: persistedContent,
        delivery_status: existingInitialMessage.delivery_status ?? null,
      };
      console.info("[meta-webhook] Resuming persisted initial outreach", {
        tenant_id,
        lead_id: leadId,
        message_id: existingInitialMessage.id,
        previous_status: existingInitialMessage.delivery_status ?? null,
      });
    } else {
      await eventRecorder.step("skipped_duplicate", { reason: "same_leadgen_already_sent" });
      await eventRecorder.patch({ whatsapp_status: "skipped", error_message: "same_leadgen_already_sent" });
      console.info("[meta-webhook] Initial outreach duplicate skipped", {
        tenant_id,
        lead_id: leadId,
        phone_last4: maskPhoneLast4(phone),
        delivery_status: existingInitialMessage.delivery_status ?? null,
      });
      return;
    }
  }

  const humanAttending = await shouldSkipMetaOutreachForHumanAttending({
    sb,
    tenantId: tenant_id,
    remoteJid,
  });
  if (humanAttending) {
    if (resumableInitialMessage) {
      await sb
        .from("whatsapp_messages")
        .update({
          delivery_status: "failed",
          failed_reason: "human_attending_before_dispatch_resume",
        })
        .eq("tenant_id", tenant_id)
        .eq("id", resumableInitialMessage.id);
      await cancelAutomatedOutboundByOperationKey({
        sb,
        tenantId: tenant_id,
        operationKey: outboundOperationKey,
        reason: "human_attending_before_dispatch_resume",
      });
    }
    await eventRecorder.step("skipped_human_attending", { reason: "human_attending_today" });
    await eventRecorder.patch({ whatsapp_status: "skipped", error_message: "human_attending_today" });
    console.info("[meta-webhook] Initial outreach skipped — human attending today", {
      tenant_id,
      lead_id: leadId,
      phone_last4: maskPhoneLast4(phone),
    });
    return;
  }

  const state = await revealMetaConversation({
    sb,
    tenantId: tenant_id,
    remoteJid,
    leadId,
    agentId,
    journeyId,
    lastMessageAt: new Date().toISOString(),
  });
  if (state?.humanPaused) {
    await eventRecorder.step("skipped_human_attending", {
      reason: "human_attending_during_meta_reveal",
    });
    await eventRecorder.patch({
      whatsapp_status: "skipped",
      error_message: "human_attending_during_meta_reveal",
    });
    return;
  }
  await eventRecorder.step("conversation_state_created", { state_id: state?.id ?? null });
  console.info("[meta-webhook] Conversation state upserted", {
    tenant_id,
    lead_id: leadId,
    agent_id: agentId,
    state_id: state?.id ?? null,
    remote_jid_last4: maskPhoneLast4(remoteJid),
  });

  let replyText = resumableInitialMessage?.content ?? "";
  if (!replyText) {
    const aiPrompt = buildMetaInitialAgentPrompt({
      leadName: fullName,
      phone,
      email,
      formName,
      pageName: connPageName?.trim() || null,
      campaignName: attribution.campaignName,
      adsetName: attribution.adsetName,
      adName: attribution.adName,
      formFields: leadMetadata.form_fields,
      profileMetadata: leadMetadata,
    });

    const aiResult = await generateAgentResponse({
      tenantId: tenant_id,
      agentId,
      conversationId: remoteJid,
      journeyId,
      customerId: remoteJid,
      feature: "agent_chat",
      messages: [{ role: "user", content: aiPrompt }],
    });

    await eventRecorder.step("ai_response_generated", {
      ok: aiResult.ok,
      model: aiResult.ok ? aiResult.model : aiResult.model ?? null,
      fallback_reason: aiResult.ok ? null : aiResult.detail ?? aiResult.code,
    });

    console.info("[meta-webhook] AI initial response generated", {
      tenant_id,
      lead_id: leadId,
      agent_id: agentId,
      ok: aiResult.ok,
      model: aiResult.ok ? aiResult.model : aiResult.model ?? null,
      fallback_reason: aiResult.ok ? null : aiResult.detail ?? aiResult.code,
    });

    if (isAgentMissingInstructionsResult(aiResult)) {
      await eventRecorder.step("automation_blocked_agent_missing_instructions", {
        agent_id: agentId,
        journey_id: journeyId,
      });
      await eventRecorder.patch({
        whatsapp_status: "blocked",
        error_message: "agent_missing_instructions",
        current_step: "automation_blocked_agent_missing_instructions",
      });
      console.warn("[meta-webhook] automation blocked because agent has no instructions", {
        tenant_id,
        lead_id: leadId,
        agent_id: agentId,
        journey_id: journeyId,
      });
      return;
    }

    replyText =
      sanitizeInitialReply(aiResult.ok ? aiResult.text : "") ||
      buildFallbackInitialMessage(fullName);
  }

  const messageChannel = resolvedConnection.transport === "cloud_api" ? "meta_cloud" : "evolution";
  const messageConnectionId =
    resolvedConnection.transport === "cloud_api"
      ? resolvedConnection.phoneNumberId
      : resolvedConnection.instance.id;

  let savedMessage: { id: string } | null = resumableInitialMessage
    ? { id: resumableInitialMessage.id }
    : null;
  let msgErr: { message: string } | null = null;
  if (!savedMessage) {
    const inserted = await sb
      .from("whatsapp_messages")
      .insert({
        tenant_id,
        remote_jid: remoteJid,
        direction: "outbound",
        kind: "text",
        content: replyText.slice(0, 4000),
        message_id: initialMessageExternalId,
        agent_id: agentId,
        lead_id: leadId,
        journey_id: journeyId,
        delivery_status: "pending",
        channel: messageChannel,
        connection_id: messageConnectionId,
      })
      .select("id")
      .maybeSingle();
    savedMessage = inserted.data as { id: string } | null;
    msgErr = inserted.error;
  }

  if (msgErr || !savedMessage?.id) {
    await eventRecorder.step("whatsapp_failed", { error: msgErr?.message ?? "missing_saved_message" });
    await eventRecorder.patch({ whatsapp_status: "failed", error_message: msgErr?.message ?? "missing_saved_message" });
    console.error("[meta-webhook] Failed to save initial WhatsApp message", {
      tenant_id,
      lead_id: leadId,
      error: msgErr?.message ?? "missing_saved_message",
    });
    throw new MetaLeadgenProcessingError(
      "initial_whatsapp_message_persist_failed",
      true,
      { cause: msgErr ?? undefined },
    );
  }

  const preparedOutbound = await prepareAutomatedOutbound({
    sb,
    operationKey: outboundOperationKey,
    tenantId: tenant_id,
    remoteJid,
    agentId,
    journeyId,
    connectionId: messageConnectionId,
    channel: messageChannel,
    kind: resolvedConnection.transport === "cloud_api" ? "template" : "text",
    content: replyText,
    leadId,
  });
  if (preparedOutbound.action === "already_sent") {
    await sb
      .from("whatsapp_messages")
      .update({
        delivery_status: "sent",
        failed_reason: null,
      })
      .eq("tenant_id", tenant_id)
      .eq("id", savedMessage.id);
    await eventRecorder.step("whatsapp_sent", {
      reason: "outbound_already_sent",
      message_id: savedMessage.id,
      outbox_id: preparedOutbound.id,
    });
    await eventRecorder.patch({
      whatsapp_status: "sent",
      error_message: null,
      current_step: "whatsapp_sent",
    });
    return;
  }
  if (
    preparedOutbound.action === "blocked" ||
    preparedOutbound.action === "stale"
  ) {
    const reason =
      preparedOutbound.action === "blocked"
        ? preparedOutbound.reason
        : "outbound_stale";
    await sb
      .from("whatsapp_messages")
      .update({
        delivery_status: "failed",
        failed_reason: reason,
      })
      .eq("tenant_id", tenant_id)
      .eq("id", savedMessage.id);
    await eventRecorder.step("automation_blocked_by_journey", {
      reason,
      journey_id: journeyId,
      outbox_id: preparedOutbound.id,
    });
    await eventRecorder.patch({
      whatsapp_status: "blocked",
      error_message: reason,
      current_step: "automation_blocked_by_journey",
    });
    return;
  }
  if (preparedOutbound.action === "ambiguous") {
    await sb
      .from("whatsapp_messages")
      .update({
        delivery_status: "failed",
        failed_reason: "outbound_dispatch_ambiguous",
      })
      .eq("tenant_id", tenant_id)
      .eq("id", savedMessage.id);
    await eventRecorder.step("whatsapp_failed", {
      reason: "outbound_dispatch_ambiguous",
      outbox_id: preparedOutbound.id,
    });
    await eventRecorder.patch({
      whatsapp_status: "failed",
      error_message: "outbound_dispatch_ambiguous",
    });
    throw new MetaLeadgenProcessingError(
      "outbound_dispatch_ambiguous",
      false,
    );
  }
  if (preparedOutbound.action === "in_progress") {
    throw new MetaLeadgenProcessingError("outbound_dispatch_in_progress", true);
  }

  let outboundFinalized = false;
  let providerDispatchStarted = false;
  try {
    if (journeyIsolationEnabled) {
      const currentJourney = await authorizeActiveJourney({
        sb,
        tenantId: tenant_id,
        remoteJid,
        preferredAgentId: agentId,
      });
      if (!currentJourney.ok || currentJourney.journey?.id !== journeyId) {
        await eventRecorder.step("automation_blocked_by_journey", {
          reason: currentJourney.ok ? "journey_superseded_before_send" : currentJourney.reason,
          journey_id: journeyId,
        });
        await sb
          .from("whatsapp_messages")
          .update({
            delivery_status: "failed",
            failed_reason: "journey_superseded_before_send",
          })
          .eq("tenant_id", tenant_id)
          .eq("id", savedMessage.id);
        await markAgentOutboundFailed({
          sb,
          id: preparedOutbound.id,
          claimToken: preparedOutbound.claimToken,
          error: "journey_superseded_before_send",
        });
        outboundFinalized = true;
        return;
      }
    }
    providerDispatchStarted = true;
    const send = await sendMetaLeadInitialWhatsapp({
      connection: resolvedConnection,
      evoNumber,
      phone,
      leadName: fullName,
      replyText,
    });

    if (send.ok && send.restarted) {
      console.info("[meta-webhook] WhatsApp connection recovered before initial send", {
        tenant_id,
        lead_id: leadId,
        connection_id: selectedConnectionId,
        attempts: send.attempts,
      });
    }

    if (!send.ok) {
      await eventRecorder.step("whatsapp_failed", { status: send.status, error: send.error });
      await eventRecorder.patch({
        whatsapp_status: "failed",
        error_message: send.error ?? "whatsapp_send_failed",
      });
      console.error("[meta-webhook] Failed to send initial WhatsApp message", {
        tenant_id,
        lead_id: leadId,
        message_id: savedMessage.id,
        status: send.status,
        error: send.error,
        transport: resolvedConnection.transport,
      });
      await sb
        .from("whatsapp_messages")
        .update({
          delivery_status: "failed",
          failed_reason: send.error ?? "whatsapp_send_failed",
        })
        .eq("tenant_id", tenant_id)
        .eq("id", savedMessage.id);
      const failure = classifyInitialSendFailure({
        status: send.status,
        error: send.error,
      });
      if (failure.ambiguous) {
        await markAgentOutboundAmbiguous({
          sb,
          id: preparedOutbound.id,
          claimToken: preparedOutbound.claimToken,
          reason: "initial_whatsapp_dispatch_ambiguous",
        });
      } else {
        await markAgentOutboundFailed({
          sb,
          id: preparedOutbound.id,
          claimToken: preparedOutbound.claimToken,
          error: failure.retryable
            ? "initial_whatsapp_dispatch_retryable"
            : "initial_whatsapp_dispatch_rejected",
        });
      }
      outboundFinalized = true;
      await scheduleLeadRedistribution({
        sb,
        tenantId: tenant_id,
        journeyId,
        ruleId,
        currentAgentId: agentId,
        trigger: "delivery_failed",
      });
      throw new MetaLeadgenProcessingError(
        failure.ambiguous
          ? "initial_whatsapp_dispatch_ambiguous"
          : "initial_whatsapp_dispatch_failed",
        failure.retryable,
      );
    }

    let acceptedStatus: "pending" | "sent" = "sent";
    let providerMessageId: string | null = send.providerMessageId;
    if (send.channel === "evolution" && send.evolutionPayload) {
      const receipt = await persistEvolutionSendReceipt({
        sb,
        tenantId: tenant_id,
        messageRowId: savedMessage.id,
        connectionId: send.persistenceConnectionId,
        payload: send.evolutionPayload,
      });
      acceptedStatus = receipt.deliveryStatus === "pending" ? "pending" : "sent";
      providerMessageId = receipt.messageId ?? providerMessageId;
    } else {
      await sb
        .from("whatsapp_messages")
        .update({
          delivery_status: "sent",
          provider_message_id: providerMessageId,
        })
        .eq("tenant_id", tenant_id)
        .eq("id", savedMessage.id);
    }
    await markAgentOutboundSent({
      sb,
      id: preparedOutbound.id,
      claimToken: preparedOutbound.claimToken,
      providerMessageId,
    });
    outboundFinalized = true;

    const sentAt = new Date().toISOString();
    await Promise.all([
      sb
        .from("leads")
        .update({
          profile_metadata: mergeLeadProfileMetadata(upsertedLead?.profile_metadata, {
            meta_initial_outreach_leadgen_id: leadgen_id,
            meta_initial_outreach_sent_at: sentAt,
            meta_initial_outreach_message_id: savedMessage.id,
          }),
          last_message_at: sentAt,
          updated_at: sentAt,
        })
        .eq("tenant_id", tenant_id)
        .eq("id", leadId),
      upsertConversationState({
        sb,
        tenantId: tenant_id,
        remoteJid,
        leadId,
        agentId,
        activeJourneyId: journeyId,
        channel: "whatsapp",
        status: "active",
        humanPaused: false,
        lastMessageAt: sentAt,
        isHidden: false,
        archivedAt: null,
        hiddenAt: null,
        hiddenBy: null,
      }),
      promoteLeadToContatoOnAgentEngagement({ sb, tenantId: tenant_id, leadId, agentId }),
      journeyId
        ? touchLeadJourney({
            sb,
            tenantId: tenant_id,
            journeyId,
            leadId,
            occurredAt: sentAt,
          })
        : Promise.resolve(),
    ]);
    await scheduleLeadRedistribution({
      sb,
      tenantId: tenant_id,
      journeyId,
      ruleId,
      currentAgentId: agentId,
      trigger: "customer_silence",
    });

    await eventRecorder.step("whatsapp_sent", {
      message_id: savedMessage.id,
      provider_message_id: providerMessageId,
      channel: send.channel,
    });
    await eventRecorder.patch({ whatsapp_status: acceptedStatus });

    console.info("[meta-webhook] Initial WhatsApp message sent", {
      tenant_id,
      lead_id: leadId,
      agent_id: agentId,
      message_id: savedMessage.id,
      phone_last4: maskPhoneLast4(phone),
      transport: resolvedConnection.transport,
      channel: send.channel,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof MetaLeadgenProcessingError) {
      throw err;
    }
    if (outboundFinalized) {
      console.error("[meta-webhook] Initial WhatsApp post-send processing failed", {
        error: message,
        tenant_id,
        lead_id: leadId,
        phone_last4: maskPhoneLast4(phone),
      });
      await eventRecorder.step("whatsapp_sent", {
        reason: "postprocess_failed_after_provider_acceptance",
        error: message,
        outbox_id: preparedOutbound.id,
      }).catch(() => undefined);
      return;
    }

    const ambiguous = providerDispatchStarted;
    if (ambiguous) {
      await markAgentOutboundAmbiguous({
        sb,
        id: preparedOutbound.id,
        claimToken: preparedOutbound.claimToken,
        reason: "initial_whatsapp_dispatch_ambiguous",
      });
    } else {
      await markAgentOutboundFailed({
        sb,
        id: preparedOutbound.id,
        claimToken: preparedOutbound.claimToken,
        error: "initial_whatsapp_pre_dispatch_failed",
      });
    }
    await eventRecorder.step("whatsapp_failed", { error: message });
    await eventRecorder.patch({ whatsapp_status: "failed", error_message: message });
    console.error("[meta-webhook] Failed to send initial WhatsApp message", {
      error: message,
      tenant_id,
      lead_id: leadId,
      phone_last4: maskPhoneLast4(phone),
    });
    await sb
      .from("whatsapp_messages")
      .update({
        delivery_status: "failed",
        failed_reason: message,
      })
      .eq("tenant_id", tenant_id)
      .eq("id", savedMessage.id);
    throw new MetaLeadgenProcessingError(
      ambiguous
        ? "initial_whatsapp_dispatch_ambiguous"
        : "initial_whatsapp_pre_dispatch_failed",
      !ambiguous,
      { cause: err },
    );
  }
}
