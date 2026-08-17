import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import { evolutionSendText } from "@/lib/integrations/evolution-api";
import {
  listWhatsAppMessageTemplates,
  sendWhatsAppTemplateMessage,
  type WhatsAppCloudTemplate,
} from "@/lib/integrations/whatsapp-cloud";
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
import { listTenantWhatsappConnections } from "@/lib/server/tenant-whatsapp-connections";
import { lookupWhatsAppCloudConnectionByPhoneNumberId } from "@/lib/server/whatsapp-cloud-connections";
import { persistEvolutionSendReceipt } from "@/lib/server/evolution-customer-delivery";
import { isBroadcastAgentRow } from "@/lib/server/broadcast-agent-identity";
import { isWithinBusinessHours } from "@/lib/server/follow-up-engine";
import {
  markAgentOutboundFailed,
  markAgentOutboundSent,
  prepareAutomatedOutbound,
} from "@/lib/server/agent-outbound-outbox";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type CampaignThroughput = "suave" | "normal" | "acelerado";

/** Mensagens por minuto reais — o antigo seletor (12/28/45 por SEGUNDO) era só decorativo e, se real, baniria o número na hora. */
export const CAMPAIGN_THROUGHPUT_PER_MINUTE: Record<CampaignThroughput, number> = {
  suave: 10,
  normal: 20,
  acelerado: 40,
};

/**
 * Um "público" da campanha. A campanha pode combinar quantos blocos o cliente
 * quiser — um filtro do CRM, uma lista importada e alguns contatos digitados
 * na mesma campanha, ou vários blocos do mesmo tipo (3 tags diferentes, por
 * exemplo). `leads` carrega ids já resolvidos (import/manual já gravaram o
 * lead antes da campanha existir); `crm` é resolvido no momento da criação.
 */
export type CampaignAudienceBlockInput =
  | { kind: "crm"; filter: "all" | "tag" | "funnel_stage"; value?: string | null }
  | { kind: "leads"; leadIds: string[] };

type CampaignInput = {
  name: string;
  connectionId: string;
  agentId: string;
  /** Cru de propósito; ver `parseCampaignAudienceBlocks`, chamado dentro de `createWhatsAppCampaign`. */
  audienceBlocks: unknown;
  messageTemplate: string;
  metaTemplateName?: string | null;
  metaTemplateLang?: string | null;
  throughput?: CampaignThroughput;
  scheduledAt?: string | null;
  /** Janela de envio; ver `parseCampaignSendWindow`. Ausente = envia a qualquer hora. */
  sendWindow?: unknown;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/** Mesmos 3 valores de renderWhatsAppCampaignTemplate, como lista posicional — usado pelo envio via template Meta ({{1}}, {{2}}, {{3}}). */
export function buildWhatsAppCampaignTemplateParams(lead: Record<string, unknown>): string[] {
  const metadata = object(lead.profile_metadata);
  return [
    text(lead.name) ?? "cliente",
    text(metadata.company) ?? text(metadata.empresa) ?? "",
    digits(lead.phone),
  ];
}

export function leadMatchesWhatsAppCampaignAudience(
  lead: Record<string, unknown>,
  audienceType: "all" | "tag" | "funnel_stage",
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

const CAMPAIGN_AUDIENCE_LEAD_COLUMNS =
  "id, name, phone, status, profile_metadata, whatsapp_opt_in_at, whatsapp_opt_in_source";

/**
 * Une os públicos da campanha num único conjunto de leads, sem repetir quem
 * bate em mais de um bloco (ex.: contato importado que também está na tag
 * escolhida no mesmo disparo). Cada bloco só entrega quem já tem opt-in ativo
 * — inclusive os blocos de contatos explícitos, porque `leadIds` pode incluir
 * um lead reaproveitado que nunca autorizou.
 */
export async function resolveWhatsAppCampaignAudience(
  sb: ServiceClient,
  tenantId: string,
  blocks: CampaignAudienceBlockInput[],
): Promise<Array<Record<string, unknown>>> {
  const resolved = new Map<string, Record<string, unknown>>();

  const crmBlocks = blocks.filter(
    (block): block is Extract<CampaignAudienceBlockInput, { kind: "crm" }> => block.kind === "crm",
  );
  if (crmBlocks.length > 0) {
    const { data: candidateRows, error } = await sb
      .from("leads")
      .select(CAMPAIGN_AUDIENCE_LEAD_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("whatsapp_opt_in", true)
      .is("whatsapp_opt_out_at", null)
      .not("whatsapp_opt_in_at", "is", null)
      .not("whatsapp_opt_in_source", "is", null)
      .not("phone", "is", null)
      .limit(5000);
    if (error) throw new Error(`campaign_audience_query:${error.message}`);
    for (const lead of (candidateRows ?? []) as Array<Record<string, unknown>>) {
      const matchesAnyBlock = crmBlocks.some((block) =>
        leadMatchesWhatsAppCampaignAudience(lead, block.filter, text(block.value)),
      );
      if (matchesAnyBlock) resolved.set(String(lead.id), lead);
    }
  }

  const explicitIds = [
    ...new Set(
      blocks
        .filter((block): block is Extract<CampaignAudienceBlockInput, { kind: "leads" }> => block.kind === "leads")
        .flatMap((block) => block.leadIds.map((id) => String(id).trim()).filter(Boolean)),
    ),
  ].filter((id) => !resolved.has(id));
  if (explicitIds.length > 0) {
    const { data: explicitRows, error } = await sb
      .from("leads")
      .select(CAMPAIGN_AUDIENCE_LEAD_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("whatsapp_opt_in", true)
      .is("whatsapp_opt_out_at", null)
      .not("whatsapp_opt_in_at", "is", null)
      .not("whatsapp_opt_in_source", "is", null)
      .not("phone", "is", null)
      .in("id", explicitIds);
    if (error) throw new Error(`campaign_audience_query:${error.message}`);
    for (const lead of (explicitRows ?? []) as Array<Record<string, unknown>>) {
      resolved.set(String(lead.id), lead);
    }
  }

  return [...resolved.values()];
}

async function resolveMetaTemplate(params: {
  tenantId: string;
  phoneNumberId: string;
  templateName: string;
}): Promise<WhatsAppCloudTemplate | null> {
  const cloudConnection = await lookupWhatsAppCloudConnectionByPhoneNumberId(params.phoneNumberId);
  if (!cloudConnection || cloudConnection.tenant_id !== params.tenantId || !cloudConnection.waba_id) return null;
  const templates = await listWhatsAppMessageTemplates({
    wabaId: cloudConnection.waba_id,
    accessToken: cloudConnection.access_token,
  });
  return templates.find((t) => t.name === params.templateName) ?? null;
}

/** Lê os blocos de público crus do cliente — nunca confia na forma que chega. */
export function parseCampaignAudienceBlocks(raw: unknown): CampaignAudienceBlockInput[] {
  if (!Array.isArray(raw)) return [];
  const blocks: CampaignAudienceBlockInput[] = [];
  for (const item of raw) {
    const entry = object(item);
    if (entry.kind === "crm") {
      const filter =
        entry.filter === "tag" || entry.filter === "funnel_stage" || entry.filter === "all" ? entry.filter : null;
      if (!filter) continue;
      blocks.push({ kind: "crm", filter, value: text(entry.value) });
    } else if (entry.kind === "leads") {
      const leadIds = Array.isArray(entry.leadIds)
        ? [...new Set(entry.leadIds.map((id) => String(id).trim()).filter(Boolean))]
        : [];
      if (leadIds.length > 0) blocks.push({ kind: "leads", leadIds });
    }
  }
  return blocks;
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
  if (!name || !input.connectionId || !input.agentId?.trim()) {
    throw new Error("campaign_required_fields");
  }

  const connections = await listTenantWhatsappConnections(params.tenantId);
  const connection = connections.find((c) => c.connectionId === input.connectionId && c.connected);
  if (!connection) throw new Error("campaign_connection_not_available");

  const { data: agent } = await params.sb
    .from("tenant_agents")
    .select("agent_id, active, metadata")
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", input.agentId)
    .eq("active", true)
    .maybeSingle();
  if (!agent) throw new Error("campaign_agent_not_available");
  // Quem responde ao disparo é atendido por ESTE agente — ele passa a ser o
  // dono da conversa e do lead. Deixar um agente de atendimento assumir esse
  // papel arrastaria a base antiga para dentro do funil de lead novo, que é
  // exatamente a mistura que a separação existe para impedir.
  if (!isBroadcastAgentRow(agent as Record<string, unknown>)) {
    throw new Error("campaign_agent_not_broadcast");
  }

  let messageTemplate = input.messageTemplate.trim();
  let metaTemplateName: string | null = null;
  let metaTemplateLang: string | null = null;

  if (connection.transport === "cloud_api") {
    metaTemplateName = text(input.metaTemplateName);
    if (!metaTemplateName) throw new Error("campaign_meta_template_required");
    const template = await resolveMetaTemplate({
      tenantId: params.tenantId,
      phoneNumberId: connection.connectionId,
      templateName: metaTemplateName,
    });
    if (!template || template.status !== "APPROVED") throw new Error("campaign_meta_template_not_approved");
    metaTemplateLang = text(input.metaTemplateLang) ?? template.language ?? "pt_BR";
    messageTemplate = `[Template Meta aprovado: ${metaTemplateName}]`;
  } else {
    if (!messageTemplate) throw new Error("campaign_required_fields");
    if (messageTemplate.length > 4000) throw new Error("campaign_message_too_long");
  }

  const audienceBlocks = parseCampaignAudienceBlocks(input.audienceBlocks);
  if (audienceBlocks.length === 0) throw new Error("campaign_audience_required");
  const leads = await resolveWhatsAppCampaignAudience(params.sb, params.tenantId, audienceBlocks);
  if (leads.length === 0) throw new Error("campaign_has_no_opted_in_recipients");

  const now = new Date().toISOString();
  const scheduledAt =
    input.scheduledAt && !Number.isNaN(new Date(input.scheduledAt).getTime())
      ? new Date(input.scheduledAt).toISOString()
      : now;
  const throughput: CampaignThroughput =
    input.throughput && input.throughput in CAMPAIGN_THROUGHPUT_PER_MINUTE ? input.throughput : "normal";
  // audience_type/audience_config viram resumo legível quando dá pra resumir
  // num único filtro; audience_blocks guarda a configuração completa sempre —
  // sem isso, uma campanha com 3 públicos combinados ficaria irrecuperável
  // depois de criada (o campo resumo não tem como representar a combinação).
  const singleCrmBlock =
    audienceBlocks.length === 1 && audienceBlocks[0]!.kind === "crm"
      ? (audienceBlocks[0] as Extract<CampaignAudienceBlockInput, { kind: "crm" }>)
      : null;
  const { data: campaign, error } = await params.sb
    .from("whatsapp_campaigns")
    .insert({
      tenant_id: params.tenantId,
      name,
      connection_id: connection.connectionId,
      transport: connection.transport,
      agent_id: input.agentId,
      audience_type: singleCrmBlock?.filter ?? "custom",
      audience_config: singleCrmBlock && text(singleCrmBlock.value) ? { value: text(singleCrmBlock.value) } : {},
      audience_blocks: audienceBlocks,
      message_template: messageTemplate,
      meta_template_name: metaTemplateName,
      meta_template_lang: metaTemplateLang,
      throughput,
      status: "scheduled",
      scheduled_at: scheduledAt,
      // Normalizada na gravação: guardar o que o cliente mandou cru deixaria
      // dia inválido ou hora fora de faixa cair no processador.
      send_window: parseCampaignSendWindow(input.sendWindow) ?? {},
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

type RecipientSender =
  | { transport: "evolution"; instanceName: string }
  | { transport: "cloud_api"; phoneNumberId: string; accessToken: string; templateName: string; templateLang: string; bodyParamCount: number };

async function processRecipient(params: {
  sb: ServiceClient;
  campaign: Record<string, unknown>;
  recipient: Record<string, unknown>;
  sender: RecipientSender;
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

  const content =
    params.sender.transport === "evolution"
      ? renderWhatsAppCampaignTemplate(String(params.campaign.message_template), lead as Record<string, unknown>)
      : buildWhatsAppCampaignTemplateParams(lead as Record<string, unknown>).slice(0, params.sender.bodyParamCount).join(" · ");
  const outbound = await prepareAutomatedOutbound({
    sb: params.sb,
    operationKey: `campaign:${recipientId}:${attempts}`,
    tenantId,
    remoteJid: jid,
    agentId: journey.agentId!,
    journeyId: journey.id,
    connectionId: String(params.campaign.connection_id),
    channel: params.sender.transport === "cloud_api" ? "meta_cloud" : "evolution",
    kind: params.sender.transport === "cloud_api" ? "template" : "text",
    content,
    leadId: String(lead.id),
  });
  if (outbound.action !== "send") {
    await params.sb.from("whatsapp_campaign_recipients").update({
      status: outbound.action === "already_sent" ? "sent" : "skipped",
      last_error: `outbound_${outbound.action}`,
      updated_at: new Date().toISOString(),
    }).eq("id", recipientId);
    return `outbound_${outbound.action}`;
  }
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
      channel: params.sender.transport === "cloud_api" ? "meta_cloud" : "evolution",
      connection_id: String(params.campaign.connection_id),
      client_temp_id: `campaign:${recipientId}:${attempts}`,
      delivery_status: "pending",
    })
    .select("id")
    .single();
  if (messageInsertError || !message?.id) {
    await markAgentOutboundFailed({
      sb: params.sb,
      id: outbound.id,
      claimToken: outbound.claimToken,
      error: messageInsertError?.message ?? "message_persistence_failed",
    });
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

  const delivery =
    params.sender.transport === "evolution"
      ? await evolutionSendText({
          instanceName: params.sender.instanceName,
          number: phone,
          text: content,
          resolveRecipient: true,
        })
      : await sendWhatsAppTemplateMessage({
          toWaId: phone,
          templateName: params.sender.templateName,
          languageCode: params.sender.templateLang,
          bodyParams:
            params.sender.bodyParamCount > 0
              ? buildWhatsAppCampaignTemplateParams(lead as Record<string, unknown>).slice(0, params.sender.bodyParamCount)
              : undefined,
          phoneNumberId: params.sender.phoneNumberId,
          accessToken: params.sender.accessToken,
        });
  if (!delivery.ok) {
    await markAgentOutboundFailed({
      sb: params.sb,
      id: outbound.id,
      claimToken: outbound.claimToken,
      error: delivery.error ?? `send_failed_${delivery.status}`,
    });
    const terminal = attempts >= maxAttempts;
    await Promise.all([
      params.sb
        .from("whatsapp_messages")
        .update({
          delivery_status: "failed",
          failed_reason: delivery.error ?? `send_failed_${delivery.status}`,
        })
        .eq("tenant_id", tenantId)
        .eq("id", message.id),
      params.sb
        .from("whatsapp_campaign_recipients")
        .update({
          status: terminal ? "failed" : "pending",
          next_attempt_at: new Date(Date.now() + Math.min(30, attempts * 5) * 60_000).toISOString(),
          last_error: delivery.error ?? `send_failed_${delivery.status}`,
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

  await markAgentOutboundSent({
    sb: params.sb,
    id: outbound.id,
    claimToken: outbound.claimToken,
  });

  const now = new Date().toISOString();
  let messageUpdateError: { message: string } | null = null;
  if (params.sender.transport === "evolution") {
    await persistEvolutionSendReceipt({
      sb: params.sb,
      tenantId,
      messageRowId: message.id,
      connectionId: String(params.campaign.connection_id),
      payload: "data" in delivery ? delivery.data : null,
    });
  } else {
    const update = await params.sb
      .from("whatsapp_messages")
      .update({ delivery_status: "sent", sent_at: now, failed_reason: null })
      .eq("tenant_id", tenantId)
      .eq("id", message.id);
    messageUpdateError = update.error;
  }
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

export type CampaignSendWindow = {
  ativo: boolean;
  diasAtivos: number[];
  horaInicio: number;
  minutoInicio: number;
  horaFim: number;
  minutoFim: number;
  timezone: string;
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/**
 * Lê a janela de envio gravada na campanha.
 *
 * Devolve `null` quando não há janela ativa — e aí a campanha envia a qualquer
 * hora, que é o comportamento de sempre. Config pela metade (ligada mas sem
 * dia nenhum marcado) também vira `null`: uma janela que nunca abre travaria a
 * campanha para sempre em silêncio, pior que não ter janela.
 */
export function parseCampaignSendWindow(raw: unknown): CampaignSendWindow | null {
  const config = object(raw);
  if (config.ativo !== true) return null;

  const diasAtivos = Array.isArray(config.diasAtivos)
    ? [...new Set(config.diasAtivos.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))]
    : [];
  if (diasAtivos.length === 0) return null;

  return {
    ativo: true,
    diasAtivos,
    horaInicio: clampInt(config.horaInicio, 0, 23, 8),
    minutoInicio: clampInt(config.minutoInicio, 0, 59, 0),
    horaFim: clampInt(config.horaFim, 0, 23, 18),
    minutoFim: clampInt(config.minutoFim, 0, 59, 0),
    timezone: text(config.timezone) ?? "America/Sao_Paulo",
  };
}

/** Margem antes do maxDuration (120s) da function — o resto fica pra próxima passada, nunca arrisca timeout no meio de um envio. */
const PROCESS_TIME_BUDGET_MS = 100_000;

export async function processDueWhatsAppCampaigns(
  sb: ServiceClient,
  options: { limit?: number; campaignId?: string } = {},
): Promise<{ processed: number; outcomes: Record<string, number> }> {
  if (!isJourneyIsolationEnabled()) return { processed: 0, outcomes: {} };
  const limit = options.limit ?? 80;
  const now = new Date().toISOString();
  let query = sb
    .from("whatsapp_campaigns")
    .select("*")
    .in("status", ["scheduled", "processing"])
    .lte("scheduled_at", now)
    .order("scheduled_at", { ascending: true })
    .limit(5);
  if (options.campaignId) query = query.eq("id", options.campaignId);
  const { data: campaigns, error } = await query;
  if (error) throw new Error(`[whatsapp-campaigns] due_query:${error.message}`);

  const outcomes: Record<string, number> = {};
  let processed = 0;
  for (const campaign of (campaigns ?? []) as Array<Record<string, unknown>>) {
    // Antes de resolver a conexão de propósito: no transporte Cloud isso custa
    // idas ao Graph, e não faz sentido pagar por elas para descobrir logo em
    // seguida que a campanha está fora da janela de envio.
    const sendWindow = parseCampaignSendWindow(campaign.send_window);
    if (sendWindow && !isWithinBusinessHours(new Date(), sendWindow)) {
      outcomes.outside_send_window = (outcomes.outside_send_window ?? 0) + 1;
      continue;
    }

    let sender: RecipientSender | null = null;
    if (String(campaign.transport) === "cloud_api") {
      const cloudConn = await lookupWhatsAppCloudConnectionByPhoneNumberId(String(campaign.connection_id));
      const templateName = text(campaign.meta_template_name);
      if (cloudConn?.active && cloudConn.tenant_id === campaign.tenant_id && templateName && cloudConn.waba_id) {
        const template = await resolveMetaTemplate({
          tenantId: String(campaign.tenant_id),
          phoneNumberId: String(campaign.connection_id),
          templateName,
        });
        if (template?.status === "APPROVED") {
          sender = {
            transport: "cloud_api",
            phoneNumberId: cloudConn.phone_number_id,
            accessToken: cloudConn.access_token,
            templateName,
            templateLang: text(campaign.meta_template_lang) ?? template.language ?? "pt_BR",
            bodyParamCount: template.bodyParamCount,
          };
        }
      }
    } else {
      const { data: connection } = await sb
        .from("tenant_evolution_instances")
        .select("instance_name, connection_state")
        .eq("tenant_id", campaign.tenant_id)
        .eq("id", campaign.connection_id)
        .maybeSingle();
      if (connection && String(connection.connection_state) === "open") {
        sender = { transport: "evolution", instanceName: String(connection.instance_name) };
      }
    }

    if (!sender) {
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
      .limit(Math.max(1, Math.min(200, limit)));

    const throughput = String(campaign.throughput ?? "normal") as CampaignThroughput;
    const perMinute = CAMPAIGN_THROUGHPUT_PER_MINUTE[throughput] ?? CAMPAIGN_THROUGHPUT_PER_MINUTE.normal;
    const delayMs = Math.round(60_000 / perMinute);
    const batchStartedAt = Date.now();

    const recipientRows = (recipients ?? []) as Array<Record<string, unknown>>;
    for (let i = 0; i < recipientRows.length; i += 1) {
      if (Date.now() - batchStartedAt > PROCESS_TIME_BUDGET_MS) break;
      const outcome = await processRecipient({ sb, campaign, recipient: recipientRows[i]!, sender });
      if (outcome === "claim_lost") continue;
      processed += 1;
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      if (i < recipientRows.length - 1) await sleep(delayMs);
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
