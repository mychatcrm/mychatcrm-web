import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  isAgentExplicitlyAuthorizedForMetaForm,
  stringArray,
} from "@/lib/server/meta-form-authorization";
import {
  isAgentAuthorizedForDirectWhatsApp,
  resolveDirectWhatsAppAgentFromRules,
} from "@/lib/server/agent-channel-authorization";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type JourneySource =
  | "meta_form"
  | "whatsapp_direct"
  | "whatsapp_campaign"
  | "manual";

export type JourneyStatus = "active" | "superseded" | "manual_review" | "closed";

export type JourneyConflictPolicy =
  | "latest_wins"
  | "priority_wins"
  | "keep_until_inactive"
  | "manual_review";

export type LeadJourney = {
  id: string;
  tenantId: string;
  remoteJid: string;
  phone: string;
  leadId: string | null;
  agentId: string | null;
  ruleId: string | null;
  campaignId: string | null;
  connectionId: string | null;
  source: JourneySource;
  sourceRef: string | null;
  pageId: string | null;
  formId: string | null;
  status: JourneyStatus;
  conflictPolicy: JourneyConflictPolicy;
  startedAt: string;
  lastActivityAt: string;
  expiresAt: string | null;
  endedAt: string | null;
  metadata: Record<string, unknown>;
};

export type JourneyAuthorizationResult =
  | { ok: true; journey: LeadJourney | null; agentId: string }
  | { ok: false; reason: string; journey: LeadJourney | null };

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizePhone(value: string): string {
  return value.split("@")[0]?.replace(/\D/g, "") ?? "";
}

function rowToJourney(row: Record<string, unknown>): LeadJourney {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    remoteJid: String(row.remote_jid),
    phone: String(row.phone),
    leadId: text(row.lead_id),
    agentId: text(row.agent_id),
    ruleId: text(row.rule_id),
    campaignId: text(row.campaign_id),
    connectionId: text(row.connection_id),
    source: String(row.source) as JourneySource,
    sourceRef: text(row.source_ref),
    pageId: text(row.page_id),
    formId: text(row.form_id),
    status: String(row.status) as JourneyStatus,
    conflictPolicy: String(row.conflict_policy) as JourneyConflictPolicy,
    startedAt: String(row.started_at),
    lastActivityAt: String(row.last_activity_at),
    expiresAt: text(row.expires_at),
    endedAt: text(row.ended_at),
    metadata: object(row.metadata),
  };
}

export function isJourneyIsolationEnabled(): boolean {
  const configured = process.env.OMNICHANNEL_JOURNEYS_ENABLED;
  if (configured === "true") return true;
  if (configured === "false") return false;
  return process.env.VERCEL_ENV === "production";
}

export async function getRuleJourneyPolicy(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  ruleId: string | null;
}): Promise<{ policy: JourneyConflictPolicy; inactivityMinutes: number }> {
  if (!params.ruleId) {
    return { policy: "latest_wins", inactivityMinutes: 1440 };
  }

  const { data, error } = await params.sb
    .from("lead_distribution_rules")
    .select("conflict_policy, conflict_inactivity_minutes")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.ruleId)
    .maybeSingle();

  if (error || !data) {
    if (error) {
      console.warn("[lead-journeys] rule_policy_query_failed", {
        tenant_id: params.tenantId,
        rule_id: params.ruleId,
        error: error.message,
      });
    }
    return { policy: "latest_wins", inactivityMinutes: 1440 };
  }

  const policyRaw = text((data as Record<string, unknown>).conflict_policy);
  const policy: JourneyConflictPolicy =
    policyRaw === "priority_wins" ||
    policyRaw === "keep_until_inactive" ||
    policyRaw === "manual_review"
      ? policyRaw
      : "latest_wins";
  const inactivityRaw = Number(
    (data as Record<string, unknown>).conflict_inactivity_minutes,
  );
  return {
    policy,
    inactivityMinutes:
      Number.isFinite(inactivityRaw) && inactivityRaw > 0
        ? Math.floor(inactivityRaw)
        : 1440,
  };
}

export async function activateLeadJourney(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  phone?: string | null;
  leadId?: string | null;
  agentId?: string | null;
  ruleId?: string | null;
  campaignId?: string | null;
  connectionId?: string | null;
  source: JourneySource;
  sourceRef?: string | null;
  pageId?: string | null;
  formId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<LeadJourney | null> {
  if (!isJourneyIsolationEnabled()) return null;
  const phone = normalizePhone(params.phone || params.remoteJid);
  if (!phone) return null;
  const policy = await getRuleJourneyPolicy({
    sb: params.sb,
    tenantId: params.tenantId,
    ruleId: params.ruleId ?? null,
  });

  const { data, error } = await params.sb.rpc("activate_lead_journey", {
    p_tenant_id: params.tenantId,
    p_remote_jid: params.remoteJid,
    p_phone: phone,
    p_lead_id: params.leadId ?? null,
    p_agent_id: params.agentId ?? null,
    p_rule_id: params.ruleId ?? null,
    p_campaign_id: params.campaignId ?? null,
    p_connection_id: params.connectionId ?? null,
    p_source: params.source,
    p_source_ref: params.sourceRef ?? null,
    p_page_id: params.pageId ?? null,
    p_form_id: params.formId ?? null,
    p_conflict_policy: policy.policy,
    p_inactivity_minutes: policy.inactivityMinutes,
    p_metadata: params.metadata ?? {},
  });

  if (error || !data) {
    console.error("[lead-journeys] activation_failed", {
      tenant_id: params.tenantId,
      source: params.source,
      rule_id: params.ruleId ?? null,
      error: error?.message ?? "missing_rpc_result",
    });
    return null;
  }

  const raw = Array.isArray(data) ? data[0] : data;
  if (!raw || typeof raw !== "object") return null;
  const journey = rowToJourney(raw as Record<string, unknown>);

  if (journey.status === "active") {
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + policy.inactivityMinutes * 60_000).toISOString();
    const { error: bindError } = await params.sb.rpc("bind_active_journey_v2", {
      p_tenant_id: params.tenantId,
      p_remote_jid: params.remoteJid,
      p_journey_id: journey.id,
      p_lead_id: params.leadId ?? journey.leadId,
      p_agent_id: params.agentId ?? journey.agentId,
      p_expires_at: expiresAt,
    });
    if (bindError) {
      await params.sb.from("lead_journeys").update({
        status: "manual_review",
        ended_at: now,
        updated_at: now,
        metadata: { ...journey.metadata, bind_error: bindError.message },
      }).eq("tenant_id", params.tenantId).eq("id", journey.id).eq("status", "active");
      console.error("[lead-journeys] bind_failed", {
        tenant_id: params.tenantId,
        journey_id: journey.id,
        error: bindError.message,
      });
      return { ...journey, status: "manual_review", endedAt: now };
    }
    await Promise.all([
      params.sb
        .from("agent_response_jobs")
        .update({
          status: "cancelled",
          failed_reason: "journey_superseded",
          completed_at: now,
          updated_at: now,
        })
        .eq("tenant_id", params.tenantId)
        .eq("remote_jid", params.remoteJid)
        .eq("status", "pending")
        .or(`journey_id.is.null,journey_id.neq.${journey.id}`),
      params.sb
        .from("follow_up_jobs")
        .update({
          status: "cancelled",
          last_error: "journey_superseded",
          updated_at: now,
        })
        .eq("tenant_id", params.tenantId)
        .eq("remote_jid", params.remoteJid)
        .eq("status", "pending")
        .or("follow_up_type.is.null,follow_up_type.neq.human_abandoned")
        .or(`journey_id.is.null,journey_id.neq.${journey.id}`),
    ]);
    journey.expiresAt = expiresAt;
  }

  console.info("[lead-journeys] journey_resolved", {
    tenant_id: params.tenantId,
    journey_id: journey.id,
    source: journey.source,
    status: journey.status,
    rule_id: journey.ruleId,
    agent_id: journey.agentId,
  });
  return journey;
}

export async function getActiveLeadJourney(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
}): Promise<LeadJourney | null> {
  if (!isJourneyIsolationEnabled()) return null;
  const { data, error } = await params.sb
    .from("lead_journeys")
    .select("*")
    .eq("tenant_id", params.tenantId)
    .eq("remote_jid", params.remoteJid)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1);

  if (error) {
    console.warn("[lead-journeys] active_query_failed", {
      tenant_id: params.tenantId,
      error: error.message,
    });
    return null;
  }
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  return row ? rowToJourney(row) : null;
}

export async function getLeadJourneyById(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  journeyId: string;
}): Promise<LeadJourney | null> {
  const { data, error } = await params.sb
    .from("lead_journeys")
    .select("*")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.journeyId)
    .maybeSingle();
  if (error || !data) return null;
  return rowToJourney(data as Record<string, unknown>);
}

async function campaignAuthorizesAgent(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  campaignId: string;
  agentId: string;
}): Promise<boolean> {
  const { data } = await params.sb
    .from("whatsapp_campaigns")
    .select("agent_id, status")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.campaignId)
    .maybeSingle();
  if (!data) return false;
  const row = data as Record<string, unknown>;
  return (
    text(row.agent_id) === params.agentId &&
    !["cancelled", "failed"].includes(String(row.status))
  );
}

export async function authorizeActiveJourney(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  preferredAgentId?: string | null;
  /** Identity of the inbound transport; prevents cross-number journey reuse. */
  connectionId?: string | null;
}): Promise<JourneyAuthorizationResult> {
  const journey = await getActiveLeadJourney(params);
  if (!journey) {
    return { ok: false, reason: "no_active_journey", journey: null };
  }
  if (!journey.connectionId) {
    return { ok: false, reason: "journey_connection_missing", journey };
  }
  if (!journey.expiresAt || Date.parse(journey.expiresAt) <= Date.now()) {
    const now = new Date().toISOString();
    await params.sb
      .from("lead_journeys")
      .update({ status: "closed", ended_at: now, updated_at: now })
      .eq("tenant_id", params.tenantId)
      .eq("id", journey.id)
      .eq("status", "active");
    return { ok: false, reason: "journey_expired", journey };
  }
  const agentId = params.preferredAgentId?.trim() || journey.agentId?.trim() || "";
  if (!agentId || journey.agentId !== agentId) {
    return { ok: false, reason: "journey_agent_mismatch", journey };
  }
  if (params.connectionId && journey.connectionId !== params.connectionId) {
    return { ok: false, reason: "journey_connection_mismatch", journey };
  }
  const { data: agent } = await params.sb
    .from("tenant_agents")
    .select("active, metadata")
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", agentId)
    .maybeSingle();
  const agentMetadata = object((agent as { metadata?: unknown } | null)?.metadata);
  if (
    (agent as { active?: boolean } | null)?.active !== true ||
    ["inativo", "pausado"].includes((text(agentMetadata.status) ?? "").toLowerCase())
  ) {
    return { ok: false, reason: "journey_agent_inactive", journey };
  }

  if (journey.source === "meta_form") {
    if (!journey.formId || !journey.pageId) {
      return { ok: false, reason: "journey_missing_meta_identity", journey };
    }
    const auth = await isAgentExplicitlyAuthorizedForMetaForm({
      sb: params.sb,
      tenantId: params.tenantId,
      pageId: journey.pageId,
      formId: journey.formId,
      agentId,
      connectionId: journey.connectionId,
    });
    return auth.authorized
      ? { ok: true, journey, agentId }
      : { ok: false, reason: "journey_meta_rule_revoked", journey };
  }

  if (journey.source === "whatsapp_campaign") {
    if (!journey.campaignId) {
      return { ok: false, reason: "journey_missing_campaign", journey };
    }
    const authorized = await campaignAuthorizesAgent({
      sb: params.sb,
      tenantId: params.tenantId,
      campaignId: journey.campaignId,
      agentId,
    });
    return authorized
      ? { ok: true, journey, agentId }
      : { ok: false, reason: "journey_campaign_agent_revoked", journey };
  }

  if (journey.source === "whatsapp_direct") {
    const authorized = await isAgentAuthorizedForDirectWhatsApp({
      sb: params.sb,
      tenantId: params.tenantId,
      agentId,
      ruleId: journey.ruleId,
      connectionId: journey.connectionId,
    });
    return authorized
      ? { ok: true, journey, agentId }
      : { ok: false, reason: "journey_direct_rule_revoked", journey };
  }

  if (journey.source === "manual") {
    if (
      journey.metadata.manual_assignment !== true ||
      !journey.formId ||
      !journey.pageId ||
      !journey.ruleId ||
      !journey.connectionId
    ) {
      return { ok: false, reason: "manual_journey_has_no_automation", journey };
    }
    const auth = await isAgentExplicitlyAuthorizedForMetaForm({
      sb: params.sb,
      tenantId: params.tenantId,
      pageId: journey.pageId,
      formId: journey.formId,
      agentId,
      connectionId: journey.connectionId,
    });
    return auth.authorized && auth.ruleId === journey.ruleId
      ? { ok: true, journey, agentId }
      : { ok: false, reason: "manual_journey_meta_rule_revoked", journey };
  }

  return { ok: false, reason: "manual_journey_has_no_automation", journey };
}

export async function resolveDirectJourneyAgent(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  connectionId?: string | null;
}): Promise<JourneyAuthorizationResult> {
  if (!isJourneyIsolationEnabled()) {
    const resolved = await resolveDirectWhatsAppAgentFromRules({
      sb: params.sb,
      tenantId: params.tenantId,
      connectionId: params.connectionId,
    });
    return resolved
      ? { ok: true, journey: null, agentId: resolved.agentId }
      : { ok: false, reason: "blocked_no_direct_whatsapp_rule", journey: null };
  }

  const existing = await authorizeActiveJourney({
    sb: params.sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    connectionId: params.connectionId,
  });
  if (existing.ok) return existing;
  if (existing.journey) return existing;

  const { data, error } = await params.sb
    .from("lead_distribution_rules")
    .select("id, agent_ids, distribution_type, connection_id")
    .eq("tenant_id", params.tenantId)
    .eq("active", true)
    .eq("source", "whatsapp_organico")
    .order("order_index", { ascending: true });
  if (error) {
    return { ok: false, reason: "direct_rule_query_failed", journey: null };
  }
  const matchingRules = ((data ?? []) as Array<Record<string, unknown>>).filter((candidate) => {
    const ruleConnection = text(candidate.connection_id);
    return Boolean(params.connectionId) && ruleConnection === params.connectionId;
  });
  if (matchingRules.length > 1) {
    console.error("[lead-journeys] direct_rule_ambiguous", {
      tenant_id: params.tenantId,
      connection_id: params.connectionId ?? null,
      rule_count: matchingRules.length,
    });
    return { ok: false, reason: "direct_rule_ambiguous", journey: null };
  }
  const rule = matchingRules[0] ?? null;
  const ruleAgentIds = rule ? stringArray(rule.agent_ids) : [];
  if (rule && ruleAgentIds.length !== 1) {
    return {
      ok: false,
      reason: "direct_rule_invalid_agent_count",
      journey: null,
    };
  }
  const agentId = ruleAgentIds[0] ?? null;
  if (!rule || !agentId) {
    return { ok: false, reason: "blocked_no_direct_whatsapp_rule", journey: null };
  }

  const journey = await activateLeadJourney({
    sb: params.sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    agentId,
    ruleId: String(rule.id),
    connectionId: params.connectionId ?? null,
    source: "whatsapp_direct",
  });
  if (!journey || journey.status !== "active") {
    return {
      ok: false,
      reason: journey?.status === "manual_review" ? "journey_manual_review" : "journey_not_active",
      journey,
    };
  }
  return { ok: true, journey, agentId };
}

export async function touchLeadJourney(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  journeyId: string;
  leadId?: string | null;
  occurredAt?: string;
}): Promise<void> {
  const journey = await getLeadJourneyById({
    sb: params.sb,
    tenantId: params.tenantId,
    journeyId: params.journeyId,
  });
  if (!journey || journey.status !== "active") return;
  const policy = await getRuleJourneyPolicy({
    sb: params.sb,
    tenantId: params.tenantId,
    ruleId: journey.ruleId,
  });
  const occurredAt = params.occurredAt ?? new Date().toISOString();
  const patch: Record<string, unknown> = {
    last_activity_at: occurredAt,
    expires_at: new Date(
      Date.parse(occurredAt) + policy.inactivityMinutes * 60_000,
    ).toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (params.leadId !== undefined) patch.lead_id = params.leadId;
  await params.sb
    .from("lead_journeys")
    .update(patch)
    .eq("tenant_id", params.tenantId)
    .eq("id", params.journeyId);
}

export async function attachJourneyToExistingMessages(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  journeyId: string;
  since?: string | null;
}): Promise<void> {
  let query = params.sb
    .from("whatsapp_messages")
    .update({ journey_id: params.journeyId })
    .eq("tenant_id", params.tenantId)
    .eq("remote_jid", params.remoteJid)
    .is("journey_id", null);
  if (params.since) query = query.gte("created_at", params.since);
  await query;
}
