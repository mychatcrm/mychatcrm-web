import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import { evolutionSendText } from "@/lib/integrations/evolution-api";
import {
  buildWhatsAppLeadInsertPayload,
  resolveAgentCrmFieldsForLeadInsert,
} from "@/lib/server/auto-lead-upsert";
import { activateLeadJourney, isJourneyIsolationEnabled, touchLeadJourney } from "@/lib/server/lead-journeys";
import { scheduleLeadRedistribution } from "@/lib/server/lead-redistribution";
import {
  commitTenantLeadQuotaReservation,
  releaseTenantLeadQuotaReservation,
  reserveTenantLeadQuota,
} from "@/lib/server/lead-quota";
import { getTenantPlanSnapshot } from "@/lib/server/tenant-plan-snapshot";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

type CampaignInput = {
  name: string;
  connectionId: string;
  agentId?: string | null;
  audienceType: "all" | "tag" | "funnel_stage";
  audienceValue?: string | null;
  messageTemplate: string;
  scheduledAt?: string | null;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function digits(value: unknown): string {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

function remoteJid(phone: string): string {
  return `${phone}@s.whatsapp.net`;
}

type CampaignLeadResolution =
  | { ok: true; lead: Record<string, unknown> }
  | { ok: false; outcome: string };

async function resolveCampaignRecipientLead(params: {
  sb: ServiceClient;
  campaign: Record<string, unknown>;
  recipient: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}): Promise<CampaignLeadResolution> {
  const tenantId = String(params.campaign.tenant_id);
  const recipientId = String(params.recipient.id);
  const phone = digits(params.recipient.phone);
  const requestedLeadId = text(params.recipient.lead_id);
  let lead: Record<string, unknown> | null = null;

  if (requestedLeadId) {
    const { data } = await params.sb
      .from("leads")
      .select("id, name, phone, status, profile_metadata, whatsapp_opt_in, whatsapp_opt_out_at")
      .eq("tenant_id", tenantId)
      .eq("id", requestedLeadId)
      .maybeSingle();
    lead = (data as Record<string, unknown> | null) ?? null;
  }

  if (!lead && phone) {
    const { data } = await params.sb
      .from("leads")
      .select("id, name, phone, status, profile_metadata, whatsapp_opt_in, whatsapp_opt_out_at")
      .eq("tenant_id", tenantId)
      .eq("phone", phone)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    lead = (data as Record<string, unknown> | null) ?? null;
  }

  if (lead?.id) {
    if (String(params.recipient.lead_id ?? "") !== String(lead.id)) {
      await params.sb
        .from("whatsapp_campaign_recipients")
        .update({ lead_id: lead.id, updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("id", recipientId);
    }
    return { ok: true, lead };
  }

  const optInAt = text(params.recipient.opt_in_at);
  const optInSource = text(params.recipient.opt_in_source);
  if (!phone || !optInAt || !optInSource) {
    await params.sb
      .from("whatsapp_campaign_recipients")
      .update({
        status: "skipped",
        last_error: "opt_in_not_active",
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", recipientId);
    return { ok: false, outcome: "skipped" };
  }

  const tenantPlan = await getTenantPlanSnapshot(tenantId);
  const quota = await reserveTenantLeadQuota({
    tenantId,
    plan: tenantPlan.plan,
    operationalLimits: tenantPlan.operationalLimits,
    contactKey: phone,
    source: "whatsapp_campaign",
    idempotencyKey: `campaign:${params.campaign.id}:recipient:${recipientId}`,
    metadata: {
      campaign_id: params.campaign.id,
      recipient_id: recipientId,
      agent_id: text(params.campaign.agent_id),
    },
  });
  if (!quota.admitted) {
    const quotaExhausted = quota.reason === "lead_quota_exhausted";
    await params.sb
      .from("whatsapp_campaign_recipients")
      .update({
        status: quotaExhausted || params.attempts >= params.maxAttempts ? "skipped" : "pending",
        next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString(),
        last_error: quotaExhausted ? "blocked_lead_quota_exhausted" : quota.reason,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", recipientId);
    return { ok: false, outcome: quotaExhausted ? "quota_blocked" : "quota_retry" };
  }

  const agentId = text(params.campaign.agent_id);
  const crmFunnel = await resolveAgentCrmFieldsForLeadInsert(params.sb, { tenantId, agentId });
  const now = new Date().toISOString();
  const payload = {
    ...buildWhatsAppLeadInsertPayload({
      tenantId,
      phone,
      contactName: text(params.recipient.name),
      source: "whatsapp_campaign",
      status: "novo",
      crmFunnelId: crmFunnel.crm_funnel_id ?? null,
      agentId,
      occurredAt: now,
    }),
    whatsapp_opt_in: true,
    whatsapp_opt_in_at: optInAt,
    whatsapp_opt_in_source: optInSource,
    profile_metadata: {
      whatsapp_campaign_id: params.campaign.id,
      whatsapp_campaign_name: params.campaign.name,
      whatsapp_campaign_recipient_id: recipientId,
    },
  };
  const { data: createdLead, error: leadError } = await params.sb
    .from("leads")
    .insert(payload)
    .select("id, name, phone, status, profile_metadata, whatsapp_opt_in, whatsapp_opt_out_at")
    .single();
  if (leadError || !createdLead?.id) {
    await releaseTenantLeadQuotaReservation(quota.eventId, "campaign_lead_insert_failed");
    const terminal = params.attempts >= params.maxAttempts;
    await params.sb
      .from("whatsapp_campaign_recipients")
      .update({
        status: terminal ? "failed" : "pending",
        next_attempt_at: new Date(Date.now() + Math.min(30, params.attempts * 5) * 60_000).toISOString(),
        last_error: `lead_persistence_failed:${leadError?.message ?? "missing_id"}`,
        updated_at: now,
      })
      .eq("tenant_id", tenantId)
      .eq("id", recipientId);
    return { ok: false, outcome: terminal ? "failed" : "persistence_retry" };
  }

  await params.sb
    .from("whatsapp_campaign_recipients")
    .update({ lead_id: createdLead.id, updated_at: now })
    .eq("tenant_id", tenantId)
    .eq("id", recipientId);
  await commitTenantLeadQuotaReservation({ eventId: quota.eventId, leadId: createdLead.id });
  return { ok: true, lead: createdLead as Record<string, unknown> };
}

export function renderWhatsAppCampaignTemplate(
  template: string,
  lead: Record<string, unknown>,
): string {
  const metadata = object(lead.profile_metadata);
  return template
    .replaceAll("{{nome}}", text(lead.name) ?? "cliente")
    .replaceAll("{{empresa}}", text(metadata.company) ?? text(metadata.empresa) ?? "")
    .replaceAll("{{telefone}}", digits(lead.phone));
}

export function leadMatchesWhatsAppCampaignAudience(
  lead: Record<string, unknown>,
  audienceType: CampaignInput["audienceType"],
  audienceValue: string | null,
): boolean {
  if (audienceType === "all") return true;
  if (!audienceValue) return false;
  if (audienceType === "funnel_stage") {
    return String(lead.status ?? "") === audienceValue;
  }
  const metadata = object(lead.profile_metadata);
  const tags = Array.isArray(metadata.tags)
    ? metadata.tags.map((value) => String(value).toLowerCase())
    : [];
  return tags.includes(audienceValue.toLowerCase());
}

export async function createWhatsAppCampaign(params: {
  sb: ServiceClient;
  tenantId: string;
  createdBy?: string | null;
  input: CampaignInput;
}) {
  if (!isJourneyIsolationEnabled()) {
    throw new Error("omnichannel_journeys_disabled");
  }
  const input = params.input;
  const name = input.name.trim();
  const messageTemplate = input.messageTemplate.trim();
  if (!name || !messageTemplate || !input.connectionId) {
    throw new Error("campaign_required_fields");
  }
  if (messageTemplate.length > 4000) throw new Error("campaign_message_too_long");

  const { data: connection } = await params.sb
    .from("tenant_evolution_instances")
    .select("id, instance_name, connection_state")
    .eq("tenant_id", params.tenantId)
    .eq("id", input.connectionId)
    .maybeSingle();
  if (!connection || String(connection.connection_state) !== "open") {
    throw new Error("campaign_connection_not_available");
  }

  if (input.agentId) {
    const { data: agent } = await params.sb
      .from("tenant_agents")
      .select("agent_id, active")
      .eq("tenant_id", params.tenantId)
      .eq("agent_id", input.agentId)
      .eq("active", true)
      .maybeSingle();
    if (!agent) throw new Error("campaign_agent_not_available");
  }

  const { data: candidateRows, error: leadError } = await params.sb
    .from("leads")
    .select("id, name, phone, status, profile_metadata, whatsapp_opt_in_at, whatsapp_opt_in_source")
    .eq("tenant_id", params.tenantId)
    .eq("whatsapp_opt_in", true)
    .is("whatsapp_opt_out_at", null)
    .not("whatsapp_opt_in_at", "is", null)
    .not("whatsapp_opt_in_source", "is", null)
    .not("phone", "is", null)
    .limit(5000);
  if (leadError) throw new Error(`campaign_audience_query:${leadError.message}`);

  const audienceValue = text(input.audienceValue);
  const leads = ((candidateRows ?? []) as Array<Record<string, unknown>>).filter((lead) =>
    leadMatchesWhatsAppCampaignAudience(lead, input.audienceType, audienceValue),
  );
  if (leads.length === 0) throw new Error("campaign_has_no_opted_in_recipients");

  const now = new Date().toISOString();
  const scheduledAt =
    input.scheduledAt && !Number.isNaN(new Date(input.scheduledAt).getTime())
      ? new Date(input.scheduledAt).toISOString()
      : now;
  const { data: campaign, error } = await params.sb
    .from("whatsapp_campaigns")
    .insert({
      tenant_id: params.tenantId,
      name,
      connection_id: input.connectionId,
      transport: "evolution",
      agent_id: input.agentId ?? null,
      audience_type: input.audienceType,
      audience_config: audienceValue ? { value: audienceValue } : {},
      message_template: messageTemplate,
      status: "scheduled",
      scheduled_at: scheduledAt,
      total_recipients: leads.length,
      created_by: params.createdBy ?? null,
      updated_at: now,
    })
    .select("*")
    .single();
  if (error || !campaign) throw new Error(`campaign_insert:${error?.message ?? "missing_campaign"}`);

  const recipients = leads.map((lead) => ({
    tenant_id: params.tenantId,
    campaign_id: campaign.id,
    lead_id: lead.id,
    phone: digits(lead.phone),
    name: text(lead.name),
    status: "pending",
    next_attempt_at: scheduledAt,
    opt_in_at: lead.whatsapp_opt_in_at,
    opt_in_source: lead.whatsapp_opt_in_source,
    updated_at: now,
  }));
  const { error: recipientError } = await params.sb
    .from("whatsapp_campaign_recipients")
    .insert(recipients);
  if (recipientError) {
    await params.sb.from("whatsapp_campaigns").delete().eq("id", campaign.id);
    throw new Error(`campaign_recipients_insert:${recipientError.message}`);
  }
  return campaign as Record<string, unknown>;
}

async function processRecipient(params: {
  sb: ServiceClient;
  campaign: Record<string, unknown>;
  recipient: Record<string, unknown>;
  instanceName: string;
}) {
  const tenantId = String(params.campaign.tenant_id);
  const recipientId = String(params.recipient.id);
  const attempts = Number(params.recipient.attempts ?? 0) + 1;
  const maxAttempts = Number(params.recipient.max_attempts ?? 3);
  const { data: claimed } = await params.sb
    .from("whatsapp_campaign_recipients")
    .update({ status: "processing", attempts, updated_at: new Date().toISOString() })
    .eq("id", recipientId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (!claimed) return "claim_lost";

  const resolvedLead = await resolveCampaignRecipientLead({
    sb: params.sb,
    campaign: params.campaign,
    recipient: params.recipient,
    attempts,
    maxAttempts,
  });
  if (!resolvedLead.ok) return resolvedLead.outcome;
  const lead = resolvedLead.lead;
  if (!lead || lead.whatsapp_opt_in !== true || lead.whatsapp_opt_out_at) {
    await params.sb
      .from("whatsapp_campaign_recipients")
      .update({ status: "skipped", last_error: "opt_in_not_active", updated_at: new Date().toISOString() })
      .eq("id", recipientId);
    return "skipped";
  }

  const phone = digits(lead.phone);
  const jid = remoteJid(phone);
  const journey = await activateLeadJourney({
    sb: params.sb,
    tenantId,
    remoteJid: jid,
    phone,
    leadId: String(lead.id),
    agentId: text(params.campaign.agent_id),
    campaignId: String(params.campaign.id),
    connectionId: String(params.campaign.connection_id),
    source: "whatsapp_campaign",
    sourceRef: recipientId,
    metadata: { campaign_name: params.campaign.name },
  });
  if (!journey || journey.status !== "active") {
    await params.sb
      .from("whatsapp_campaign_recipients")
      .update({ status: "skipped", last_error: journey?.status ?? "journey_activation_failed", updated_at: new Date().toISOString() })
      .eq("id", recipientId);
    return "journey_blocked";
  }

  const content = renderWhatsAppCampaignTemplate(
    String(params.campaign.message_template),
    lead as Record<string, unknown>,
  );
  const pendingAt = new Date().toISOString();
  const { data: message, error: messageInsertError } = await params.sb
    .from("whatsapp_messages")
    .insert({
      tenant_id: tenantId,
      remote_jid: jid,
      direction: "outbound",
      kind: "text",
      content,
      agent_id: text(params.campaign.agent_id),
      lead_id: lead.id,
      journey_id: journey.id,
      client_temp_id: `campaign:${recipientId}:${attempts}`,
      delivery_status: "pending",
    })
    .select("id")
    .single();
  if (messageInsertError || !message?.id) {
    const terminal = attempts >= maxAttempts;
    await params.sb
      .from("whatsapp_campaign_recipients")
      .update({
        status: terminal ? "failed" : "pending",
        next_attempt_at: new Date(Date.now() + Math.min(30, attempts * 5) * 60_000).toISOString(),
        last_error: `message_persistence_failed:${messageInsertError?.message ?? "missing_id"}`,
        updated_at: pendingAt,
      })
      .eq("id", recipientId);
    return terminal ? "failed" : "persistence_retry";
  }

  const delivery = await evolutionSendText({
    instanceName: params.instanceName,
    number: phone,
    text: content,
  });
  if (!delivery.ok) {
    const terminal = attempts >= maxAttempts;
    await Promise.all([
      params.sb
        .from("whatsapp_messages")
        .update({
          delivery_status: "failed",
          failed_reason: delivery.error ?? `evolution_${delivery.status}`,
        })
        .eq("tenant_id", tenantId)
        .eq("id", message.id),
      params.sb
        .from("whatsapp_campaign_recipients")
        .update({
          status: terminal ? "failed" : "pending",
          next_attempt_at: new Date(Date.now() + Math.min(30, attempts * 5) * 60_000).toISOString(),
          last_error: delivery.error ?? `evolution_${delivery.status}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", recipientId),
    ]);
    await scheduleLeadRedistribution({
      sb: params.sb,
      tenantId,
      journeyId: journey.id,
      ruleId: journey.ruleId,
      currentAgentId: journey.agentId,
      trigger: "delivery_failed",
    });
    return terminal ? "failed" : "retry";
  }

  const now = new Date().toISOString();
  const { error: messageUpdateError } = await params.sb
    .from("whatsapp_messages")
    .update({
      delivery_status: "sent",
      sent_at: now,
      failed_reason: null,
    })
    .eq("tenant_id", tenantId)
    .eq("id", message.id);
  if (messageUpdateError) {
    console.error("[whatsapp-campaigns] sent_message_status_update_failed", {
      tenant_id: tenantId,
      campaign_id: params.campaign.id,
      recipient_id: recipientId,
      message_id: message.id,
      error: messageUpdateError.message,
    });
  }
  await Promise.all([
    params.sb
      .from("whatsapp_campaign_recipients")
      .update({
        status: "sent",
        sent_at: now,
        message_id: message.id,
        last_error: null,
        updated_at: now,
      })
      .eq("id", recipientId),
    params.sb
      .from("conversation_states")
      .upsert(
        {
          tenant_id: tenantId,
          remote_jid: jid,
          channel: "whatsapp",
          lead_id: lead.id,
          agent_id: text(params.campaign.agent_id),
          active_journey_id: journey.id,
          last_message_at: now,
          is_hidden: false,
          archived_at: null,
          updated_at: now,
        },
        { onConflict: "tenant_id,remote_jid,channel" },
      ),
    params.sb
      .from("leads")
      .update({
        source: "whatsapp_campaign",
        agent_id: text(params.campaign.agent_id),
        agent_assignment_source: "whatsapp_campaign",
        last_message_at: now,
        last_seen: now,
        updated_at: now,
      })
      .eq("tenant_id", tenantId)
      .eq("id", lead.id),
    touchLeadJourney({ sb: params.sb, tenantId, journeyId: journey.id }),
  ]);
  await scheduleLeadRedistribution({
    sb: params.sb,
    tenantId,
    journeyId: journey.id,
    ruleId: journey.ruleId,
    currentAgentId: journey.agentId,
    trigger: "customer_silence",
  });
  return "sent";
}

export async function processDueWhatsAppCampaigns(
  sb: ServiceClient,
  limit = 50,
): Promise<{ processed: number; outcomes: Record<string, number> }> {
  if (!isJourneyIsolationEnabled()) return { processed: 0, outcomes: {} };
  const now = new Date().toISOString();
  const { data: campaigns, error } = await sb
    .from("whatsapp_campaigns")
    .select("*")
    .in("status", ["scheduled", "processing"])
    .lte("scheduled_at", now)
    .order("scheduled_at", { ascending: true })
    .limit(5);
  if (error) throw new Error(`[whatsapp-campaigns] due_query:${error.message}`);

  const outcomes: Record<string, number> = {};
  let processed = 0;
  for (const campaign of (campaigns ?? []) as Array<Record<string, unknown>>) {
    const { data: connection } = await sb
      .from("tenant_evolution_instances")
      .select("instance_name, connection_state")
      .eq("tenant_id", campaign.tenant_id)
      .eq("id", campaign.connection_id)
      .maybeSingle();
    if (!connection || String(connection.connection_state) !== "open") {
      await sb
        .from("whatsapp_campaigns")
        .update({ status: "failed", updated_at: now })
        .eq("id", campaign.id);
      outcomes.connection_unavailable = (outcomes.connection_unavailable ?? 0) + 1;
      continue;
    }
    await sb
      .from("whatsapp_campaigns")
      .update({ status: "processing", started_at: campaign.started_at ?? now, updated_at: now })
      .eq("id", campaign.id);
    const { data: recipients } = await sb
      .from("whatsapp_campaign_recipients")
      .select("*")
      .eq("tenant_id", campaign.tenant_id)
      .eq("campaign_id", campaign.id)
      .eq("status", "pending")
      .lte("next_attempt_at", now)
      .order("next_attempt_at", { ascending: true })
      .limit(Math.max(1, Math.min(100, limit)));
    for (const recipient of (recipients ?? []) as Array<Record<string, unknown>>) {
      const outcome = await processRecipient({
        sb,
        campaign,
        recipient,
        instanceName: String(connection.instance_name),
      });
      if (outcome === "claim_lost") continue;
      processed += 1;
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    }

    const { data: states } = await sb
      .from("whatsapp_campaign_recipients")
      .select("status")
      .eq("campaign_id", campaign.id);
    const rows = (states ?? []) as Array<{ status: string }>;
    const sent = rows.filter((row) => row.status === "sent").length;
    const failed = rows.filter((row) => row.status === "failed").length;
    const pending = rows.some((row) => ["pending", "processing"].includes(row.status));
    await sb
      .from("whatsapp_campaigns")
      .update({
        status: pending ? "processing" : "completed",
        total_sent: sent,
        total_failed: failed,
        completed_at: pending ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", campaign.id);
  }
  return { processed, outcomes };
}
