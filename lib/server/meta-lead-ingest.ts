import { generateAgentResponse } from "@/lib/ai/generate-agent-response";
import { evolutionSendText, remoteJidToEvoNumber } from "@/lib/integrations/evolution-api";
import { upsertConversationState } from "@/lib/server/conversation-memory";
import { resolveEvolutionAgentId } from "@/lib/server/evolution-agent-resolve";
import { resolveAgentCrmFieldsForLeadInsert } from "@/lib/server/auto-lead-upsert";
import { getEvolutionInstanceByTenantId } from "@/lib/server/tenant-evolution-instance-db";
import { MetaLeadEventRecorder } from "@/lib/server/meta-lead-events-db";
import {
  buildFallbackInitialMessage,
  buildLeadProfileMetadata,
  buildMetaInitialAgentPrompt,
  fetchFormQuestionLabels,
  fetchGraphAdContext,
  fetchGraphLead,
  fetchGraphObjectField,
  mergeLeadProfileMetadata,
  parseFieldData,
  sanitizeInitialReply,
} from "@/lib/server/meta-lead-graph";
import {
  buildWhatsappRemoteJid,
  extractLeadName,
  extractLeadPhone,
  shouldSendMetaInitialOutreach,
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

type LeadDistributionRuleRow = {
  id: string;
  page_id: string | null;
  use_all_forms: boolean | null;
  included_form_ids: unknown;
  excluded_form_ids: unknown;
  distribution_type: string;
  agent_ids: unknown;
};

type AgentValidationResult = {
  agentId: string | null;
  source: "routing" | "instance_default" | "tenant_active" | "none";
  invalidAgentId: string | null;
  invalidReason: string | null;
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function maskPhoneLast4(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.slice(-4) || "empty";
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

  const routing = await resolveAgentForLead(sb, tenant_id, form_id ?? "", page_id);
  const instance = await getEvolutionInstanceByTenantId(tenant_id);
  const agentResolution = await resolveValidMetaAgent({
    sb,
    tenantId: tenant_id,
    routedAgentId: routing.agentId,
    instanceDefaultAgentId: instance?.default_agent_id ?? null,
  });
  const agentId = agentResolution.agentId;

  await eventRecorder.step("agent_resolved", {
    agent_id: agentId,
    source: agentResolution.source,
    rule_id: routing.ruleId,
    invalid_agent_id: agentResolution.invalidAgentId,
  });
  await eventRecorder.patch({
    agent_id: agentId,
    agent_resolution_source: agentResolution.source,
  });

  if (agentResolution.invalidAgentId) {
    console.warn("[meta-webhook] Invalid agent ignored", {
      tenant_id,
      invalid_agent_id: agentResolution.invalidAgentId,
      reason: agentResolution.invalidReason,
      fallback_source: agentResolution.source,
    });
  }

  const [formName, adContext] = await Promise.all([
    form_id ? fetchGraphObjectField(form_id, "name", page_access_token) : Promise.resolve(null),
    ad_id ? fetchGraphAdContext(ad_id, page_access_token) : Promise.resolve(null),
  ]);

  const questionLabels = form_id ? await fetchFormQuestionLabels(form_id, page_access_token) : new Map<string, string>();

  const leadMetadata = buildLeadProfileMetadata({
    leadgenId: leadgen_id,
    fieldData: lead.field_data ?? [],
    formId: form_id,
    formName,
    adId: ad_id,
    adsetId: ad_group_id ?? adContext?.adsetId ?? undefined,
    pageId: page_id,
    pageName: connPageName?.trim() || null,
    campaignId: adContext?.campaignId ?? undefined,
    campaignName: adContext?.campaignName ?? null,
    adsetName: adContext?.adsetName ?? null,
    adName: adContext?.adName ?? null,
    agentResolutionSource: agentResolution.source,
    invalidAgentId: agentResolution.invalidAgentId,
    rawWebhook: value as Record<string, unknown>,
    questionLabels,
  });

  await eventRecorder.step("form_fields_saved");
  await eventRecorder.patch({
    form_name: formName,
    form_fields: leadMetadata.form_fields ?? [],
    profile_metadata: leadMetadata,
    campaign_id: adContext?.campaignId ?? null,
    campaign_name: adContext?.campaignName ?? null,
    adset_name: adContext?.adsetName ?? null,
    ad_name: adContext?.adName ?? null,
  });

  const crmExtras = await resolveAgentCrmFieldsForLeadInsert(sb, { tenantId: tenant_id, agentId });

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
        campaign_rule_id: routing.ruleId ?? null,
        agent_assignment_source: "meta_rule",
        rule_id: routing.ruleId,
        profile_metadata: leadMetadata,
        last_seen: new Date().toISOString(),
        ...crmExtras,
      }
    : {
        tenant_id,
        phone,
        name: fullName,
        email: email ?? undefined,
        source: "lead_ads",
        agent_id: agentId,
        campaign_agent_id: agentId,
        campaign_active: Boolean(agentId),
        agent_assignment_source: agentId ? "meta_rule" : "unassigned",
        rule_id: routing.ruleId,
        campaign_rule_id: routing.ruleId ?? null,
        profile_metadata: mergeLeadProfileMetadata(existingLead?.profile_metadata, leadMetadata),
        last_seen: new Date().toISOString(),
        ...crmExtras,
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
    is_new: isNewLead,
  });

  if (!agentId) {
    await eventRecorder.step("skipped_no_agent");
    await eventRecorder.patch({ whatsapp_status: "skipped", error_message: "no_valid_agent" });
    console.warn("[meta-webhook] No valid agent for lead — skipping initial outreach", {
      tenant_id,
      lead_id: upsertedLead?.id,
      phone_last4: maskPhoneLast4(phone),
    });
    return;
  }

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

  const outreachDecision = shouldSendMetaInitialOutreach(
    upsertedLead?.profile_metadata ?? upsertPayload.profile_metadata,
    leadgen_id,
  );
  if (!outreachDecision.shouldSend) {
    await eventRecorder.step("skipped_duplicate", { reason: outreachDecision.reason });
    await eventRecorder.patch({ whatsapp_status: "skipped", error_message: outreachDecision.reason });
    console.info("[meta-webhook] Initial outreach skipped", {
      tenant_id,
      lead_id: leadId,
      phone_last4: maskPhoneLast4(phone),
      reason: outreachDecision.reason,
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

  const initialMessageExternalId = `meta:${leadgen_id}:initial`;
  const { data: existingInitialMessage } = await sb
    .from("whatsapp_messages")
    .select("id, delivery_status")
    .eq("tenant_id", tenant_id)
    .eq("message_id", initialMessageExternalId)
    .maybeSingle();
  if (existingInitialMessage?.id) {
    await eventRecorder.step("skipped_duplicate", { reason: "initial_message_already_exists" });
    await eventRecorder.patch({ whatsapp_status: "skipped", error_message: "initial_message_already_exists" });
    console.info("[meta-webhook] Initial outreach skipped", {
      tenant_id,
      lead_id: leadId,
      phone_last4: maskPhoneLast4(phone),
      reason: "initial_message_already_exists",
      delivery_status: existingInitialMessage.delivery_status ?? null,
    });
    return;
  }

  const state = await upsertConversationState({
    sb,
    tenantId: tenant_id,
    remoteJid,
    leadId,
    agentId,
    channel: "whatsapp",
    status: "active",
    humanPaused: false,
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
    campaignName: adContext?.campaignName ?? null,
    adName: adContext?.adName ?? null,
    formFields: leadMetadata.form_fields,
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
        lastMessageAt: sentAt,
      }),
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

async function isUsableTenantAgent(params: {
  sb: ReturnType<typeof createSupabaseServiceClient>;
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
  const metadata = data.metadata && typeof data.metadata === "object"
    ? (data.metadata as Record<string, unknown>)
    : {};
  const status = typeof metadata.status === "string" ? metadata.status : "ativo";
  if (status === "inativo" || status === "pausado") return { ok: false, reason: `metadata_${status}` };
  return { ok: true };
}

async function resolveValidMetaAgent(params: {
  sb: ReturnType<typeof createSupabaseServiceClient>;
  tenantId: string;
  routedAgentId: string | null;
  instanceDefaultAgentId: string | null;
}): Promise<AgentValidationResult> {
  const routedCheck = await isUsableTenantAgent({
    sb: params.sb,
    tenantId: params.tenantId,
    agentId: params.routedAgentId,
  });
  if (routedCheck.ok && params.routedAgentId) {
    return { agentId: params.routedAgentId, source: "routing", invalidAgentId: null, invalidReason: null };
  }
  const routedInvalidReason = routedCheck.ok ? null : routedCheck.reason;

  const defaultCheck = await isUsableTenantAgent({
    sb: params.sb,
    tenantId: params.tenantId,
    agentId: params.instanceDefaultAgentId,
  });
  if (defaultCheck.ok && params.instanceDefaultAgentId) {
    return {
      agentId: params.instanceDefaultAgentId,
      source: "instance_default",
      invalidAgentId: params.routedAgentId,
      invalidReason: routedInvalidReason,
    };
  }

  const { data } = await params.sb
    .from("tenant_agents")
    .select("agent_id")
    .eq("tenant_id", params.tenantId)
    .eq("active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const fallbackAgentId = typeof data?.agent_id === "string" ? data.agent_id : null;
  if (fallbackAgentId) {
    return {
      agentId: fallbackAgentId,
      source: "tenant_active",
      invalidAgentId: params.routedAgentId,
      invalidReason: routedInvalidReason,
    };
  }

  return {
    agentId: null,
    source: "none",
    invalidAgentId: params.routedAgentId,
    invalidReason: routedInvalidReason,
  };
}

async function resolveAgentForLead(
  sb: ReturnType<typeof createSupabaseServiceClient>,
  tenantId: string,
  formId: string,
  pageId: string,
): Promise<{ agentId: string | null; ruleId: string | null }> {
  const { data: rules } = await sb
    .from("lead_distribution_rules")
    .select("id, page_id, use_all_forms, included_form_ids, excluded_form_ids, distribution_type, agent_ids")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .eq("source", "meta_form")
    .order("order_index", { ascending: true })
    .returns<LeadDistributionRuleRow[]>();

  const matchingRule = rules?.find((rule) => {
    if (rule.page_id && rule.page_id !== pageId) return false;
    if (rule.use_all_forms) {
      const excluded = stringArray(rule.excluded_form_ids);
      return !excluded.includes(formId);
    }
    const included = stringArray(rule.included_form_ids);
    return included.includes(formId);
  });

  if (matchingRule) {
    const agentIds = stringArray(matchingRule.agent_ids);
    if (
      (matchingRule.distribution_type === "automation_agent" ||
        matchingRule.distribution_type === "specific_agents" ||
        matchingRule.distribution_type === "round_robin") &&
      agentIds.length > 0
    ) {
      if (agentIds.length === 1) return { agentId: agentIds[0] ?? null, ruleId: matchingRule.id };

      const counts = await Promise.all(
        agentIds.map(async (aid) => {
          const { count } = await sb
            .from("leads")
            .select("*", { count: "exact", head: true })
            .eq("tenant_id", tenantId)
            .eq("rule_id", matchingRule.id)
            .eq("agent_id", aid);
          return { aid, count: count || 0 };
        }),
      );
      counts.sort((a, b) => a.count - b.count);
      return { agentId: counts[0]?.aid ?? null, ruleId: matchingRule.id };
    }
  }

  if (formId) {
    const { data: mapping } = await sb
      .from("meta_form_agent_mapping")
      .select("agent_id")
      .eq("tenant_id", tenantId)
      .eq("form_id", formId)
      .maybeSingle();
    if (mapping?.agent_id) return { agentId: mapping.agent_id, ruleId: matchingRule?.id ?? null };
  }

  const { data: instance } = await sb
    .from("tenant_evolution_instances")
    .select("default_agent_id")
    .eq("tenant_id", tenantId)
    .order("slot_index", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (instance?.default_agent_id) return { agentId: instance.default_agent_id, ruleId: matchingRule?.id ?? null };

  return { agentId: await resolveEvolutionAgentId(tenantId, null), ruleId: matchingRule?.id ?? null };
}
