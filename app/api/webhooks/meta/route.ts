import { NextRequest, NextResponse } from "next/server";
import { generateAgentResponse } from "@/lib/ai/generate-agent-response";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { verifyMetaSignature256 } from "@/lib/integrations/whatsapp-cloud";
import { getEvolutionInstanceByTenantId } from "@/lib/server/tenant-evolution-instance-db";
import { evolutionSendText, remoteJidToEvoNumber } from "@/lib/integrations/evolution-api";
import { resolveEvolutionAgentId } from "@/lib/server/evolution-agent-resolve";
import { upsertConversationState } from "@/lib/server/conversation-memory";
import {
  buildWhatsappRemoteJid,
  extractLeadName,
  extractLeadPhone,
  shouldSendMetaInitialOutreach,
} from "@/lib/server/meta-lead-processing";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ─── Types ────────────────────────────────────────────────────────────────────

type LeadgenValue = {
  leadgen_id: string;
  page_id: string;
  form_id?: string;
  ad_id?: string;
  ad_group_id?: string;
  created_time?: number;
};

type MetaEntry = {
  id: string;
  time?: number;
  changes?: Array<{
    field: string;
    value: LeadgenValue;
  }>;
};

type MetaWebhookPayload = {
  object?: string;
  entry?: MetaEntry[];
};

type GraphLeadFieldData = {
  name: string;
  values: string[];
};

type GraphLeadResponse = {
  id: string;
  created_time?: string;
  field_data?: GraphLeadFieldData[];
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

// ─── GET — webhook verification ──────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim();
  if (!expectedToken) {
    console.error("[meta-webhook] META_WEBHOOK_VERIFY_TOKEN not set");
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  if (mode === "subscribe" && token === expectedToken && challenge) {
    console.info("[meta-webhook] Webhook verified");
    return new NextResponse(challenge, { status: 200 });
  }

  console.warn("[meta-webhook] Verification failed", { mode, token });
  return new NextResponse("Forbidden", { status: 403 });
}

// ─── POST — leadgen events ────────────────────────────────────────────────────

const LEADGEN_WEBHOOK_FIELDS = new Set(["leadgen", "leadgen_update"]);

function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `meta-${Date.now()}`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = newRequestId();
  console.info("[meta-webhook] POST received", {
    requestId,
    contentLength: req.headers.get("content-length"),
    hasSignature: Boolean(req.headers.get("x-hub-signature-256")),
    userAgent: req.headers.get("user-agent"),
  });

  const rawBody = await req.text();

  const signatureBypass = process.env.WEBHOOK_SIGNATURE_BYPASS === "true";
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (signatureBypass) {
    console.warn("[meta-webhook] WEBHOOK_SIGNATURE_BYPASS=true — skipping signature check (REMOVE FOR PRODUCTION)");
  } else if (appSecret) {
    const sig = req.headers.get("x-hub-signature-256");
    if (!verifyMetaSignature256(rawBody, sig, appSecret)) {
      console.warn("[meta-webhook] Invalid signature — ignoring");
      return NextResponse.json({ ok: false }, { status: 200 }); // 200 to stop Meta retries on bad sig
    }
  } else {
    console.warn("[meta-webhook] META_APP_SECRET not set — skipping signature check");
  }

  let payload: MetaWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as MetaWebhookPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 200 });
  }

  if (payload.object !== "page") {
    console.info("[meta-webhook] Ignored non-page object", {
      requestId,
      object: payload.object ?? null,
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const entryCount = payload.entry?.length ?? 0;
  const changeCount = (payload.entry ?? []).reduce((n, e) => n + (e.changes?.length ?? 0), 0);
  console.info("[meta-webhook] Page payload accepted", { requestId, entryCount, changeCount });

  await processLeadgenEntries(payload.entry ?? [], requestId);

  return NextResponse.json({ ok: true }, { status: 200 });
}

// ─── Core processing ──────────────────────────────────────────────────────────

async function processLeadgenEntries(entries: MetaEntry[], requestId: string): Promise<void> {
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      if (!LEADGEN_WEBHOOK_FIELDS.has(change.field)) continue;
      console.info("[meta-webhook] Processing leadgen change", {
        requestId,
        field: change.field,
        page_id: change.value?.page_id,
        leadgen_id: change.value?.leadgen_id,
      });
      await processLeadgenEvent(change.value).catch((err) => {
        console.error("[meta-webhook] Error processing leadgen event", {
          requestId,
          field: change.field,
          leadgen_id: change.value?.leadgen_id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }
}

async function processLeadgenEvent(value: LeadgenValue): Promise<void> {
  const { leadgen_id, page_id, form_id, ad_id } = value;
  if (!leadgen_id || !page_id) {
    console.warn("[meta-webhook] Missing leadgen_id or page_id — skipping");
    return;
  }

  const sb = createSupabaseServiceClient();

  // 1. Find the tenant that owns this page
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
  console.info("[meta-webhook] Tenant resolved", { tenant_id, page_id });

  // 2. Fetch lead details from Graph API
  const lead = await fetchGraphLead(leadgen_id, page_access_token);
  if (!lead) {
    console.warn("[meta-webhook] Could not fetch lead from Graph API", { leadgen_id });
    return;
  }

  // 3. Parse field_data
  const fields = parseFieldData(lead.field_data ?? []);
  const phone = extractLeadPhone(fields);
  const fullName = extractLeadName(fields);
  const email = fields.email ?? null;

  if (!phone) {
    console.warn("[meta-webhook] Lead has no phone — cannot route via WhatsApp", {
      leadgen_id,
      field_keys: Object.keys(fields),
    });
    return;
  }

  // 4. Resolve agent: distribution rules > legacy form mapping > instance default > tenant default
  const routing = await resolveAgentForLead(sb, tenant_id, form_id ?? "", page_id);
  const instance = await getEvolutionInstanceByTenantId(tenant_id);
  const agentResolution = await resolveValidMetaAgent({
    sb,
    tenantId: tenant_id,
    routedAgentId: routing.agentId,
    instanceDefaultAgentId: instance?.default_agent_id ?? null,
  });
  const agentId = agentResolution.agentId;

  if (agentResolution.invalidAgentId) {
    console.warn("[meta-webhook] Invalid agent ignored", {
      tenant_id,
      invalid_agent_id: agentResolution.invalidAgentId,
      reason: agentResolution.invalidReason,
      fallback_source: agentResolution.source,
    });
  }
  console.info("[meta-webhook] Agent resolved", {
    tenant_id,
    agent_id: agentId,
    source: agentResolution.source,
    rule_id: routing.ruleId,
  });

  // 5. Upsert lead in CRM — profile_metadata com todos os campos do formulário
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
    pageId: page_id,
    pageName: connPageName?.trim() || null,
    campaignName: adContext?.campaignName ?? null,
    adName: adContext?.adName ?? null,
    questionLabels,
  });

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
    console.error("[meta-webhook] Failed to upsert lead", {
      error: upsertErr.message,
      phone_last4: maskPhoneLast4(phone),
    });
    return;
  } else {
    console.info("[meta-webhook] Lead upserted", {
      lead_id: upsertedLead?.id,
      phone_last4: maskPhoneLast4(phone),
      agentId,
      is_new: isNewLead,
    });
  }

  if (!agentId) {
    console.warn("[meta-webhook] No valid agent for lead — skipping initial outreach", {
      tenant_id,
      lead_id: upsertedLead?.id,
      phone_last4: maskPhoneLast4(phone),
    });
    return;
  }

  if (!instance?.instance_name) {
    console.warn("[meta-webhook] No Evolution instance for tenant — skipping initial message", { tenant_id });
    return;
  }

  const leadId = upsertedLead?.id;
  if (!leadId) {
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

    console.info("[meta-webhook] Initial WhatsApp message sent", {
      tenant_id,
      lead_id: leadId,
      agent_id: agentId,
      message_id: savedMessage.id,
      phone_last4: maskPhoneLast4(phone),
      instanceName: instance.instance_name,
    });
  } catch (err) {
    console.error("[meta-webhook] Failed to send initial WhatsApp message", {
      error: err instanceof Error ? err.message : String(err),
      tenant_id,
      lead_id: leadId,
      phone_last4: maskPhoneLast4(phone),
    });
    await sb
      .from("whatsapp_messages")
      .update({
        delivery_status: "failed",
        failed_reason: err instanceof Error ? err.message : "evolution_send_exception",
      })
      .eq("tenant_id", tenant_id)
      .eq("id", savedMessage.id);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function maskPhoneLast4(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.slice(-4) || "empty";
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

function buildMetaInitialAgentPrompt(params: {
  leadName: string;
  phone: string;
  email: string | null;
  formName: string | null;
  pageName: string | null;
  campaignName: string | null;
  adName: string | null;
  formFields: unknown;
}): string {
  const fields = Array.isArray(params.formFields)
    ? params.formFields
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const row = item as Record<string, unknown>;
          const label = typeof row.label === "string" ? row.label.trim() : typeof row.key === "string" ? row.key.trim() : "";
          const value = typeof row.value === "string" ? row.value.trim() : "";
          return label && value ? `- ${label}: ${value}` : null;
        })
        .filter((item): item is string => Boolean(item))
    : [];
  return [
    "Um novo lead acabou de preencher um formulário Meta Lead Ads e deve receber o primeiro atendimento agora pelo WhatsApp.",
    "Responda como o agente configurado, com uma primeira mensagem curta, útil e contextual.",
    "Não diga que é uma simulação. Não invente dados além do contexto abaixo.",
    "",
    `Nome do lead: ${params.leadName}`,
    `Telefone: ${params.phone}`,
    params.email ? `E-mail: ${params.email}` : null,
    params.pageName ? `Página Meta: ${params.pageName}` : null,
    params.formName ? `Formulário: ${params.formName}` : null,
    params.campaignName ? `Campanha: ${params.campaignName}` : null,
    params.adName ? `Anúncio: ${params.adName}` : null,
    fields.length ? `Campos preenchidos:\n${fields.join("\n")}` : null,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function buildFallbackInitialMessage(fullName: string): string {
  const firstName = fullName.split(/\s+/)[0] || "tudo bem";
  return `Olá, ${firstName}! Recebi seu cadastro e já vou te ajudar por aqui.`;
}

function sanitizeInitialReply(text: string): string {
  return text
    .replace(/\[\[HANDOFF\]\]/gi, "")
    .replace(/\[\[ENVIAR_MEDIA:[^\]]+\]\]/gi, "")
    .trim();
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

async function fetchGraphLead(leadgenId: string, pageAccessToken: string): Promise<GraphLeadResponse | null> {
  try {
    const url = `https://graph.facebook.com/v19.0/${leadgenId}?fields=field_data,created_time&access_token=${encodeURIComponent(pageAccessToken)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("[meta-webhook] Graph API error", { status: res.status, body: body.slice(0, 300) });
      return null;
    }
    return (await res.json()) as GraphLeadResponse;
  } catch (err) {
    console.warn("[meta-webhook] fetchGraphLead failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

function parseFieldData(fieldData: GraphLeadFieldData[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fieldData) {
    if (f.name && Array.isArray(f.values) && f.values.length > 0) {
      out[f.name.toLowerCase().replace(/\s+/g, "_")] = f.values[0] ?? "";
    }
  }
  return out;
}

type LeadFormFieldEntry = { key: string; label: string; value: string };

function humanizeFieldKeyAsLabel(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return key;
  if (/[A-Za-zÀ-ÿ]/.test(trimmed) && trimmed.includes(" ")) return trimmed;
  return trimmed
    .replace(/_/g, " ")
    .replace(/\?/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/u, (c) => c.toUpperCase());
}

function buildFormFieldsFromFieldData(
  fieldData: GraphLeadFieldData[],
  questionLabels: Map<string, string>,
): LeadFormFieldEntry[] {
  const rows: LeadFormFieldEntry[] = [];
  for (const f of fieldData) {
    const key = f.name?.trim();
    if (!key || !Array.isArray(f.values) || f.values.length === 0) continue;
    const value = f.values.map((v) => String(v).trim()).filter(Boolean).join(", ");
    if (!value) continue;
    rows.push({
      key,
      label: questionLabels.get(key) ?? humanizeFieldKeyAsLabel(key),
      value,
    });
  }
  return rows;
}

function buildLeadProfileMetadata(params: {
  leadgenId: string;
  fieldData: GraphLeadFieldData[];
  formId?: string;
  formName: string | null;
  adId?: string;
  pageId: string;
  pageName: string | null;
  campaignName: string | null;
  adName: string | null;
  questionLabels: Map<string, string>;
}): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    source: "lead_ads",
    meta_leadgen_id: params.leadgenId,
    form_fields: buildFormFieldsFromFieldData(params.fieldData, params.questionLabels),
  };
  if (params.formId) meta.meta_form_id = params.formId;
  if (params.formName) meta.meta_form_name = params.formName;
  if (params.adId) meta.meta_ad_id = params.adId;
  if (params.adName) meta.meta_ad_name = params.adName;
  if (params.pageId) meta.meta_page_id = params.pageId;
  if (params.pageName) meta.meta_page_name = params.pageName;
  if (params.campaignName) meta.meta_campaign_name = params.campaignName;
  return meta;
}

function mergeLeadProfileMetadata(
  previous: unknown,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const prev =
    previous && typeof previous === "object" && !Array.isArray(previous)
      ? (previous as Record<string, unknown>)
      : {};
  return { ...prev, ...next };
}

async function fetchGraphObjectField(
  objectId: string,
  field: string,
  pageAccessToken: string,
): Promise<string | null> {
  try {
    const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(objectId)}?fields=${encodeURIComponent(field)}&access_token=${encodeURIComponent(pageAccessToken)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const value = data[field];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

async function fetchGraphAdContext(
  adId: string,
  pageAccessToken: string,
): Promise<{ adName: string | null; campaignName: string | null }> {
  try {
    const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(adId)}?fields=name,campaign{name}&access_token=${encodeURIComponent(pageAccessToken)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return { adName: null, campaignName: null };
    const data = (await res.json()) as {
      name?: string;
      campaign?: { name?: string };
    };
    return {
      adName: typeof data.name === "string" && data.name.trim() ? data.name.trim() : null,
      campaignName:
        typeof data.campaign?.name === "string" && data.campaign.name.trim() ? data.campaign.name.trim() : null,
    };
  } catch {
    return { adName: null, campaignName: null };
  }
}

async function fetchFormQuestionLabels(formId: string, pageAccessToken: string): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  try {
    const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(formId)}?fields=questions{key,label}&access_token=${encodeURIComponent(pageAccessToken)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return labels;
    const raw = (await res.json()) as {
      questions?: Array<{ key?: string; label?: string }> | { data?: Array<{ key?: string; label?: string }> };
    };
    const list = Array.isArray(raw.questions)
      ? raw.questions
      : Array.isArray(raw.questions?.data)
        ? raw.questions.data
        : [];
    for (const q of list) {
      const key = q.key?.trim();
      const label = q.label?.trim();
      if (key && label) labels.set(key, label);
    }
  } catch {
    return labels;
  }
  return labels;
}
