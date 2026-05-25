import { generateAgentResponse } from "@/lib/ai/generate-agent-response";
import { evolutionSendText, remoteJidToEvoNumber } from "@/lib/integrations/evolution-api";
import { upsertConversationState } from "@/lib/server/conversation-memory";
import { resolveAgentCrmFieldsForLeadInsert } from "@/lib/server/auto-lead-upsert";
import { buildNewLeadCrmFields, promoteLeadToContatoOnAgentEngagement } from "@/lib/server/crm-lead-lifecycle";
import { canAgentAutoContactLead } from "@/lib/server/agent-auto-contact-guard";
import { getEvolutionInstanceByTenantId } from "@/lib/server/tenant-evolution-instance-db";
import { MetaLeadEventRecorder } from "@/lib/server/meta-lead-events-db";
import {
  crmBlockedUserMessage,
  isMetaFormAllowedForCrm,
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

export type LeadgenValue = {
  leadgen_id: string;
  page_id: string;
  form_id?: string;
  ad_id?: string;
  ad_group_id?: string;
  created_time?: number;
};

function maskPhoneLast4(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.slice(-4) || "empty";
}

async function revealMetaConversation(params: {
  sb: ReturnType<typeof createSupabaseServiceClient>;
  tenantId: string;
  remoteJid: string;
  leadId: string;
  agentId: string;
  lastMessageAt: string;
}) {
  return upsertConversationState({
    sb: params.sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    leadId: params.leadId,
    agentId: params.agentId,
    channel: "whatsapp",
    status: "active",
    humanPaused: false,
    lastMessageAt: params.lastMessageAt,
    isHidden: false,
    archivedAt: null,
    hiddenAt: null,
    hiddenBy: null,
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

async function loadRuleActivationStartedAtMs(params: {
  sb: ReturnType<typeof createSupabaseServiceClient>;
  tenantId: string;
  ruleId: string | null;
}): Promise<number | null> {
  if (!params.ruleId) return null;
  const { data, error } = await params.sb
    .from("lead_distribution_rules")
    .select("created_at, updated_at")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.ruleId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { created_at?: unknown; updated_at?: unknown };
  // Editing a rule/form selection starts a new safe boundary. Do not import
  // leads created before that configuration moment.
  return timestampMsFromDb(row.updated_at) ?? timestampMsFromDb(row.created_at);
}

export async function processMetaLeadgenEvent(value: LeadgenValue): Promise<void> {
  const { leadgen_id, page_id, form_id, ad_id, ad_group_id } = value;
  if (!leadgen_id || !page_id) {
    console.warn("[meta-webhook] Missing leadgen_id or page_id — skipping");
    return;
  }

  const sb = createSupabaseServiceClient();

  const { data: conn } = await sb
    .from("meta_connections")
    .select("tenant_id, page_access_token, page_name")
    .eq("page_id", page_id)
    .maybeSingle();

  if (!conn) {
    console.warn("[meta-webhook] No tenant found for page_id", { page_id });
    return;
  }

  const { tenant_id, page_access_token, page_name: connPageName } = conn as {
    tenant_id: string;
    page_access_token: string;
    page_name?: string | null;
  };

  const eventRecorder = new MetaLeadEventRecorder(sb, {
    tenant_id,
    leadgen_id,
    page_id,
    form_id: form_id ?? null,
    ad_id: ad_id ?? null,
    adset_id: ad_group_id ?? null,
    raw_webhook: value as Record<string, unknown>,
  });
  await eventRecorder.init();
  await eventRecorder.patch({ page_name: connPageName?.trim() || null });

  console.info("[meta-webhook] Tenant resolved", { tenant_id, page_id });

  const lead = await fetchGraphLead(leadgen_id, page_access_token);
  if (!lead) {
    await eventRecorder.step("graph_fetch_failed");
    await eventRecorder.patch({ error_message: "graph_api_fetch_failed" });
    console.warn("[meta-webhook] Could not fetch lead from Graph API", { leadgen_id });
    return;
  }
  await eventRecorder.step("graph_data_fetched");

  const fields = parseFieldData(lead.field_data ?? []);
  const phone = extractLeadPhone(fields);
  const fullName = extractLeadName(fields);
  const email = fields.email ?? null;

  await eventRecorder.patch({ name: fullName, phone: phone || null, email });

  if (!phone) {
    await eventRecorder.step("skipped_no_phone", { field_keys: Object.keys(fields) });
    await eventRecorder.patch({ whatsapp_status: "skipped", error_message: "no_phone_in_form" });
    console.warn("[meta-webhook] Lead has no phone — cannot route via WhatsApp", {
      leadgen_id,
      field_keys: Object.keys(fields),
    });
    return;
  }

  const resolvedFormId = (form_id ?? lead.form_id ?? "").trim();
  const crmAllowance = await isMetaFormAllowedForCrm({
    sb,
    tenantId: tenant_id,
    pageId: page_id,
    formId: resolvedFormId,
  });

  if (!crmAllowance.allowed) {
    const userMessage = crmBlockedUserMessage(crmAllowance.reason);
    await eventRecorder.step("blocked_form_not_in_rules", {
      reason: crmAllowance.reason,
    });
    await eventRecorder.patch({
      crm_sync_status: "blocked",
      whatsapp_status: "blocked",
      error_message: crmAllowance.reason,
      current_step: "blocked_form_not_in_rules",
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

  const leadCreatedAtMs = timestampMsFromSeconds(value.created_time);
  const activationStartedAtMs = await loadRuleActivationStartedAtMs({
    sb,
    tenantId: tenant_id,
    ruleId,
  });
  if (!leadCreatedAtMs || !activationStartedAtMs || leadCreatedAtMs < activationStartedAtMs) {
    await eventRecorder.step("blocked_historical_lead", {
      rule_id: ruleId,
      lead_created_time: value.created_time ?? null,
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
      lead_created_time: value.created_time ?? null,
      activation_started_at_ms: activationStartedAtMs,
    });
    return;
  }

  const agentResolution = await resolveAuthorizedMetaLeadAgent({
    sb,
    tenantId: tenant_id,
    pageId: page_id,
    formId: resolvedFormId,
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

  const leadMetadata = buildLeadProfileMetadata({
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

  const { data: existingLead } = await sb
    .from("leads")
    .select("id, created_at, campaign_active, agent_id, campaign_agent_id, profile_metadata")
    .eq("tenant_id", tenant_id)
    .eq("phone", phone)
    .maybeSingle();

  const isNewLead = !existingLead;

  const upsertPayload = isNewLead
    ? {
        tenant_id,
        phone,
        name: fullName,
        email: email ?? undefined,
        source: "lead_ads",
        agent_id: agentId,
        campaign_agent_id: agentId,
        campaign_active: Boolean(agentId),
        campaign_rule_id: ruleId,
        agent_assignment_source: agentId ? "meta_rule" : "unassigned",
        rule_id: ruleId,
        profile_metadata: leadMetadata,
        last_seen: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...newLeadCrm,
      }
    : {
        tenant_id,
        phone,
        name: fullName,
        email: email ?? undefined,
        source: "lead_ads",
        agent_id: agentId ?? existingLead?.agent_id ?? null,
        campaign_agent_id: agentId,
        campaign_active: Boolean(agentId),
        agent_assignment_source: agentId ? "meta_rule" : "unassigned",
        rule_id: ruleId,
        campaign_rule_id: ruleId,
        profile_metadata: mergeLeadProfileMetadata(existingLead?.profile_metadata, leadMetadata),
        last_seen: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...crmFunnel,
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
    await eventRecorder.step("crm_lead_failed", { error: upsertErr.message });
    await eventRecorder.patch({ crm_sync_status: "failed", error_message: upsertErr.message });
    console.error("[meta-webhook] Failed to upsert lead", {
      error: upsertErr.message,
      phone_last4: maskPhoneLast4(phone),
    });
    return;
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

  const instance = await getEvolutionInstanceByTenantId(tenant_id);
  if (!instance?.instance_name) {
    await eventRecorder.step("skipped_no_evolution");
    await eventRecorder.patch({ whatsapp_status: "skipped", error_message: "no_evolution_instance" });
    console.warn("[meta-webhook] No Evolution instance for tenant — skipping initial message", { tenant_id });
    return;
  }

  const leadId = upsertedLead?.id;
  if (!leadId) {
    await eventRecorder.patch({ whatsapp_status: "skipped", error_message: "lead_id_missing_after_upsert" });
    console.warn("[meta-webhook] Lead upsert returned no id — skipping initial outreach", {
      tenant_id,
      phone_last4: maskPhoneLast4(phone),
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
    source: "lead_ads",
    formId: resolvedFormId,
    pageId: page_id,
    leadgenId: leadgen_id,
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

  const initialMessageExternalId = `meta:${leadgen_id}:initial`;
  const { data: existingInitialMessage } = await sb
    .from("whatsapp_messages")
    .select("id, delivery_status, sent_at, created_at")
    .eq("tenant_id", tenant_id)
    .eq("message_id", initialMessageExternalId)
    .maybeSingle();
  if (existingInitialMessage?.id) {
    const alreadySent = existingInitialMessage.delivery_status === "sent";
    if (alreadySent) {
      await revealMetaConversation({
        sb,
        tenantId: tenant_id,
        remoteJid,
        leadId,
        agentId,
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
    } else {
      await eventRecorder.step("skipped_duplicate", { reason: "same_leadgen_already_sent" });
      await eventRecorder.patch({ whatsapp_status: "skipped", error_message: "same_leadgen_already_sent" });
    }
    console.info("[meta-webhook] Initial outreach skipped", {
      tenant_id,
      lead_id: leadId,
      phone_last4: maskPhoneLast4(phone),
      reason: "same_leadgen_already_sent",
      delivery_status: existingInitialMessage.delivery_status ?? null,
      inbox_status: alreadySent ? "sent" : "skipped",
    });
    return;
  }

  const humanAttending = await shouldSkipMetaOutreachForHumanAttending({
    sb,
    tenantId: tenant_id,
    remoteJid,
  });
  if (humanAttending) {
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
    lastMessageAt: new Date().toISOString(),
  });
  await eventRecorder.step("conversation_state_created", { state_id: state?.id ?? null });
  console.info("[meta-webhook] Conversation state upserted", {
    tenant_id,
    lead_id: leadId,
    agent_id: agentId,
    state_id: state?.id ?? null,
    remote_jid_last4: maskPhoneLast4(remoteJid),
  });

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
    customerId: remoteJid,
    feature: "agent_chat",
    messages: [{ role: "user", content: aiPrompt }],
  });

  const replyText = sanitizeInitialReply(aiResult.ok ? aiResult.text : "") || buildFallbackInitialMessage(fullName);

  await eventRecorder.step("ai_response_generated", {
    ok: aiResult.ok,
    model: aiResult.ok ? aiResult.model : aiResult.model ?? null,
    fallback_reason: aiResult.ok ? null : aiResult.code,
  });

  console.info("[meta-webhook] AI initial response generated", {
    tenant_id,
    lead_id: leadId,
    agent_id: agentId,
    ok: aiResult.ok,
    model: aiResult.ok ? aiResult.model : aiResult.model ?? null,
    fallback_reason: aiResult.ok ? null : aiResult.code,
  });

  const { data: savedMessage, error: msgErr } = await sb
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
      delivery_status: "pending",
    })
    .select("id")
    .maybeSingle();

  if (msgErr || !savedMessage?.id) {
    await eventRecorder.step("whatsapp_failed", { error: msgErr?.message ?? "missing_saved_message" });
    await eventRecorder.patch({ whatsapp_status: "failed", error_message: msgErr?.message ?? "missing_saved_message" });
    console.error("[meta-webhook] Failed to save initial WhatsApp message", {
      tenant_id,
      lead_id: leadId,
      error: msgErr?.message ?? "missing_saved_message",
    });
    return;
  }

  try {
    const send = await evolutionSendText({
      instanceName: instance.instance_name,
      number: evoNumber,
      text: replyText,
    });

    if (!send.ok) {
      await eventRecorder.step("whatsapp_failed", { status: send.status, error: send.error });
      await eventRecorder.patch({
        whatsapp_status: "failed",
        error_message: send.error ?? "evolution_send_failed",
      });
      console.error("[meta-webhook] Failed to send initial WhatsApp message", {
        tenant_id,
        lead_id: leadId,
        message_id: savedMessage.id,
        status: send.status,
        error: send.error,
      });
      await sb
        .from("whatsapp_messages")
        .update({
          delivery_status: "failed",
          failed_reason: send.error ?? "evolution_send_failed",
        })
        .eq("tenant_id", tenant_id)
        .eq("id", savedMessage.id);
      return;
    }

    const sentAt = new Date().toISOString();
    await Promise.all([
      sb
        .from("whatsapp_messages")
        .update({ delivery_status: "sent", sent_at: sentAt })
        .eq("tenant_id", tenant_id)
        .eq("id", savedMessage.id),
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
        channel: "whatsapp",
        status: "active",
        humanPaused: false,
        lastMessageAt: sentAt,
        isHidden: false,
        archivedAt: null,
        hiddenAt: null,
        hiddenBy: null,
      }),
      promoteLeadToContatoOnAgentEngagement({ sb, tenantId: tenant_id, leadId }),
    ]);

    await eventRecorder.step("whatsapp_sent", { message_id: savedMessage.id });
    await eventRecorder.patch({ whatsapp_status: "sent" });

    console.info("[meta-webhook] Initial WhatsApp message sent", {
      tenant_id,
      lead_id: leadId,
      agent_id: agentId,
      message_id: savedMessage.id,
      phone_last4: maskPhoneLast4(phone),
      instanceName: instance.instance_name,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
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
  }
}
