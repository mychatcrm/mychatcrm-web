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
import { isWithinBusinessHours } from "@/lib/server/follow-up-engine";
import {
  finalizeAgentOutboundDelivery,
  markAgentOutboundFailed,
  prepareAutomatedOutbound,
} from "@/lib/server/agent-outbound-outbox";
import { readTeamMembersFromDb } from "@/lib/server/team-employees-db";
import { pauseConversationAfterCampaignSend } from "@/lib/server/conversation-operation";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type CampaignThroughput = "suave" | "normal" | "acelerado";

/** Mensagens por minuto reais — o antigo seletor (12/28/45 por SEGUNDO) era só decorativo e, se real, baniria o número na hora. */
export const CAMPAIGN_THROUGHPUT_PER_MINUTE: Record<CampaignThroughput, number> = {
  suave: 10,
  normal: 20,
  acelerado: 40,
};

/**
 * Teto de campanhas ATIVAS (agendada ou processando) por tenant, igual pra
 * todos os planos — pedido explícito do dono da conta, não depende de plano.
 * Conta só o que ainda não terminou: concluída/cancelada/falhou libera vaga
 * pra outra, então não trava o cliente pra sempre depois de 5 disparos.
 */
export const CAMPAIGN_ACTIVE_LIMIT = 5;
const CAMPAIGN_ACTIVE_STATUSES = ["scheduled", "processing"] as const;

/**
 * Um "público" da campanha. São só três origens: base do CRM, lista importada
 * de arquivo e contatos digitados na hora. A campanha pode combinar quantos
 * blocos quiser. `leads` carrega ids já resolvidos (import/manual já gravaram
 * o lead antes da campanha existir); `crm` é resolvido no momento da criação.
 *
 * O bloco de CRM é uma pergunta de cada vez, na ordem que o cliente pensa:
 *  1. DE ONDE (`scope`): tudo, ou funis/colunas escolhidos a dedo.
 *  2. DE QUANDO (`period`): tudo, ou recorte por cadastro / silêncio.
 *
 * Antes disso eram cinco filtros soltos e mutuamente exclusivos (base
 * completa, tag, funil, dias, data), o que impedia o pedido mais comum —
 * "coluna X do funil Y, só quem está parado há 30 dias" — e ainda obrigava a
 * empilhar blocos pra somar dois funis.
 */
export type CampaignCrmScope = {
  /** Funis inteiros. Vazio + `columns` vazio = todos os funis. */
  funnelIds: string[];
  /**
   * Colunas específicas, cada uma amarrada ao SEU funil. Soma com
   * `funnelIds` (OU, não E) — "funil de Vendas inteiro + a coluna Proposta
   * do funil de Pós" é uma soma de dois recortes.
   *
   * O par `{funnelId, columnId}` existe porque o id da coluna sozinho é
   * ambíguo: funis diferentes reaproveitam os mesmos ids de etapa do modelo
   * de Kanban (ex.: "proposta" existe em vários funis). Guardar só o id da
   * coluna faria "marcar a coluna Proposta do funil A" bater também em todo
   * lead na coluna Proposta de QUALQUER outro funil — nunca foi isso que se
   * pediu ao escolher uma coluna de um funil específico.
   */
  columns: Array<{ funnelId: string; columnId: string }>;
};

export type CampaignCrmPeriod =
  | { mode: "all" }
  /** Cadastrado há `days` dias ou mais — base parada. */
  | { mode: "cadastro_dias"; days: number }
  /** Cadastrado exatamente nesse dia ("AAAA-MM-DD"). */
  | { mode: "cadastro_data"; date: string }
  /** Sem trocar mensagem há `days` dias ou mais. Quem nunca falou entra. */
  | { mode: "sem_contato_dias"; days: number };

export type CampaignAudienceBlockInput =
  | { kind: "crm"; scope: CampaignCrmScope; period: CampaignCrmPeriod }
  | { kind: "leads"; leadIds: string[] };

type CampaignInput = {
  name: string;
  connectionId: string;
  agentId: string;
  /** Regra explícita de Integrações de Leads que autoriza este agente nesta conexão. */
  ruleId: string;
  /** Cru de propósito; ver `parseCampaignAudienceBlocks`, chamado dentro de `createWhatsAppCampaign`. */
  audienceBlocks: unknown;
  messageTemplate: string;
  metaTemplateName?: string | null;
  metaTemplateLang?: string | null;
  throughput?: CampaignThroughput;
  scheduledAt?: string | null;
  /** Janela de envio; ver `parseCampaignSendWindow`. Ausente = envia a qualquer hora. */
  sendWindow?: unknown;
  /** Destino do lead ao entrar no disparo; ver `parseCampaignLeadDestination`. Ausente = não mexe em funil/coluna/dono. */
  leadDestination?: unknown;
  /** `false` = manda só a mensagem e pausa a automação depois (humano assume). Ausente/`true` = comportamento de sempre. */
  continueWithAgent?: boolean;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

async function campaignRuleAuthorizesConfiguration(
  sb: ServiceClient,
  campaign: Record<string, unknown>,
): Promise<boolean> {
  const tenantId = text(campaign.tenant_id);
  const ruleId = text(campaign.rule_id);
  const agentId = text(campaign.agent_id);
  const connectionId = text(campaign.connection_id);
  const transport = text(campaign.transport);
  if (!tenantId || !ruleId || !agentId || !connectionId || !transport) return false;

  const [{ data: rule, error }, { data: agent, error: agentError }] = await Promise.all([
    sb
      .from("lead_distribution_rules")
      .select("source, active, transport, connection_id, agent_ids")
      .eq("tenant_id", tenantId)
      .eq("id", ruleId)
      .maybeSingle(),
    sb
      .from("tenant_agents")
      .select("active, metadata")
      .eq("tenant_id", tenantId)
      .eq("agent_id", agentId)
      .maybeSingle(),
  ]);
  if (error || agentError || !rule || !agent || agent.active !== true) return false;
  const agentStatus = text(object(agent.metadata).status)?.toLowerCase();
  if (agentStatus === "inativo" || agentStatus === "pausado") return false;
  const row = rule as Record<string, unknown>;
  const agentIds = stringArray(row.agent_ids);
  return (
    row.source === "whatsapp_campaign" &&
    row.active === true &&
    row.transport === transport &&
    row.connection_id === connectionId &&
    agentIds.length === 1 &&
    agentIds[0] === agentId
  );
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

/** Fuso fixo pra decidir "mesmo dia de cadastro" — mesmo padrão de `parseCampaignSendWindow`. */
const CAMPAIGN_AUDIENCE_TIMEZONE = "America/Sao_Paulo";

/** `true` quando `createdAt` caiu no mesmo dia-calendário (fuso fixo) que `dateStr` ("AAAA-MM-DD"). */
function leadCreatedOnDate(createdAt: unknown, dateStr: string): boolean {
  if (typeof createdAt !== "string") return false;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return false;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CAMPAIGN_AUDIENCE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}` === dateStr;
}

/** `true` quando `createdAt` tem `minDays` dias ou mais — base parada, o alvo típico de resgate. */
function leadOlderThanDays(createdAt: unknown, minDays: number): boolean {
  if (typeof createdAt !== "string") return false;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() <= Date.now() - minDays * 86_400_000;
}

/** `true` quando a última troca de mensagem tem `minDays` dias ou mais. Quem NUNCA falou entra: silêncio total também é silêncio. */
function leadSilentForDays(lastMessageAt: unknown, minDays: number): boolean {
  if (typeof lastMessageAt !== "string") return true;
  const date = new Date(lastMessageAt);
  if (Number.isNaN(date.getTime())) return true;
  return date.getTime() <= Date.now() - minDays * 86_400_000;
}

/** Escopo vazio dos dois lados = base inteira. */
function leadInCrmScope(lead: Record<string, unknown>, scope: CampaignCrmScope): boolean {
  if (scope.funnelIds.length === 0 && scope.columns.length === 0) return true;
  const funnelId = text(lead.crm_funnel_id);
  const columnId = text(lead.status);
  // OU, não E: "funil de Vendas inteiro + a coluna Proposta do funil de Pós"
  // é uma soma de dois recortes, não uma interseção impossível.
  if (funnelId && scope.funnelIds.includes(funnelId)) return true;
  // Os dois lados do par têm que bater: é a coluna X DESTE funil, não a
  // coluna X de qualquer funil que por acaso reaproveite o mesmo id de etapa.
  if (funnelId && columnId && scope.columns.some((c) => c.funnelId === funnelId && c.columnId === columnId)) {
    return true;
  }
  return false;
}

function leadInCrmPeriod(lead: Record<string, unknown>, period: CampaignCrmPeriod): boolean {
  if (period.mode === "all") return true;
  if (period.mode === "cadastro_dias") return leadOlderThanDays(lead.created_at, period.days);
  if (period.mode === "cadastro_data") return leadCreatedOnDate(lead.created_at, period.date);
  return leadSilentForDays(lead.last_message_at, period.days);
}

/** Escopo E período: as duas perguntas do bloco precisam bater juntas. */
export function leadMatchesCrmAudienceBlock(
  lead: Record<string, unknown>,
  block: { scope: CampaignCrmScope; period: CampaignCrmPeriod },
): boolean {
  return leadInCrmScope(lead, block.scope) && leadInCrmPeriod(lead, block.period);
}

export const CAMPAIGN_AUDIENCE_LEAD_COLUMNS =
  "id, name, phone, status, crm_funnel_id, profile_metadata, whatsapp_opt_in_at, whatsapp_opt_in_source, created_at, last_message_at";

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
      const matchesAnyBlock = crmBlocks.some((block) => leadMatchesCrmAudienceBlock(lead, block));
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

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
}

function crmScopeColumns(value: unknown): Array<{ funnelId: string; columnId: string }> {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: Array<{ funnelId: string; columnId: string }> = [];
  for (const item of value) {
    const row = object(item);
    const funnelId = text(row.funnelId);
    const columnId = text(row.columnId);
    if (!funnelId || !columnId) continue;
    const key = `${funnelId}::${columnId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ funnelId, columnId });
  }
  return out;
}

/** Escopo ilegível (ou ausente) vira base inteira — nunca um público vazio silencioso. */
export function parseCrmScope(raw: unknown): CampaignCrmScope {
  const config = object(raw);
  return { funnelIds: stringList(config.funnelIds), columns: crmScopeColumns(config.columns) };
}

/**
 * Período ilegível vira "todo o período". Um número de dias inválido não pode
 * virar recorte: `Number("abc")` daria NaN e toda comparação de data seria
 * falsa, produzindo um público vazio sem o cliente entender por quê.
 */
export function parseCrmPeriod(raw: unknown): CampaignCrmPeriod {
  const config = object(raw);
  if (config.mode === "cadastro_data") {
    const date = text(config.date);
    return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { mode: "cadastro_data", date } : { mode: "all" };
  }
  if (config.mode === "cadastro_dias" || config.mode === "sem_contato_dias") {
    const days = Number(config.days);
    if (!Number.isFinite(days) || days < 0) return { mode: "all" };
    return { mode: config.mode, days: Math.floor(days) };
  }
  return { mode: "all" };
}

/** Lê os blocos de público crus do cliente — nunca confia na forma que chega. */
export function parseCampaignAudienceBlocks(raw: unknown): CampaignAudienceBlockInput[] {
  if (!Array.isArray(raw)) return [];
  const blocks: CampaignAudienceBlockInput[] = [];
  for (const item of raw) {
    const entry = object(item);
    if (entry.kind === "crm") {
      blocks.push({
        kind: "crm",
        scope: parseCrmScope(entry.scope),
        period: parseCrmPeriod(entry.period),
      });
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
  const ruleId = input.ruleId?.trim();
  if (!ruleId) throw new Error("campaign_rule_required");

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
  const agentStatus = text(object(agent?.metadata).status)?.toLowerCase();
  if (!agent || agentStatus === "inativo" || agentStatus === "pausado") {
    throw new Error("campaign_agent_not_available");
  }

  const { data: rule, error: ruleError } = await params.sb
    .from("lead_distribution_rules")
    .select("id, source, active, transport, connection_id, agent_ids")
    .eq("tenant_id", params.tenantId)
    .eq("id", ruleId)
    .eq("source", "whatsapp_campaign")
    .eq("active", true)
    .maybeSingle();
  if (ruleError) throw new Error(`campaign_rule_query:${ruleError.message}`);
  const authorizedAgents = stringArray((rule as Record<string, unknown> | null)?.agent_ids);
  if (
    !rule ||
    authorizedAgents.length !== 1 ||
    authorizedAgents[0] !== input.agentId ||
    String((rule as Record<string, unknown>).connection_id ?? "") !== connection.connectionId ||
    String((rule as Record<string, unknown>).transport ?? "") !== connection.transport
  ) {
    throw new Error("campaign_rule_not_authorized");
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
  // Normalizada na gravação: guardar o que o cliente mandou cru deixaria dia
  // inválido, hora fora de faixa ou vendedor inexistente cair no processador
  // só no momento do envio, bem mais difícil de diagnosticar.
  const leadDestination = parseCampaignLeadDestination(input.leadDestination);
  if (leadDestination.ownerAction === "atribuir" && leadDestination.ownerEmployeeId) {
    const teamEmployees = await readTeamMembersFromDb(params.tenantId);
    const employee = teamEmployees.find((e) => e.id === leadDestination.ownerEmployeeId);
    if (!employee || !employee.ativo) throw new Error("campaign_owner_employee_invalid");
  }

  const { count: activeCampaignCount, error: activeCountError } = await params.sb
    .from("whatsapp_campaigns")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", params.tenantId)
    .in("status", CAMPAIGN_ACTIVE_STATUSES);
  if (activeCountError) throw new Error(`campaign_active_count_query:${activeCountError.message}`);
  if ((activeCampaignCount ?? 0) >= CAMPAIGN_ACTIVE_LIMIT) {
    throw new Error("campaign_active_limit_reached");
  }

  const { data: campaign, error } = await params.sb
    .from("whatsapp_campaigns")
    .insert({
      tenant_id: params.tenantId,
      name,
      connection_id: connection.connectionId,
      transport: connection.transport,
      agent_id: input.agentId,
      rule_id: ruleId,
      // audience_type/audience_config são resumo legado de quando o público
      // era um filtro único. Um bloco agora carrega escopo E período, e a
      // campanha pode ter vários — nada disso cabe no resumo, então ele fica
      // sempre "custom" e `audience_blocks` é a fonte de verdade.
      audience_type: "custom",
      audience_config: {},
      audience_blocks: audienceBlocks,
      message_template: messageTemplate,
      meta_template_name: metaTemplateName,
      meta_template_lang: metaTemplateLang,
      throughput,
      // Salvar NÃO dispara: a campanha nasce parada e o cliente dá play no
      // card quando quiser. Antes, criar já começava a mandar — tirava dele a
      // chance de revisar antes de a base inteira receber.
      status: "draft",
      scheduled_at: scheduledAt,
      send_window: parseCampaignSendWindow(input.sendWindow) ?? {},
      lead_destination: leadDestination,
      continue_with_agent: input.continueWithAgent !== false,
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

/**
 * Patch de `leads` aplicado quando o disparo sai. `agent_id` sempre muda pro
 * agente da campanha — isolação obrigatória, não é opção. `crm_funnel_id`/
 * `status` (id da coluna) e `owner_employee_id` só mudam se o dono da conta
 * configurou isso nesta campanha (`lead_destination`); sem config, o card
 * fica exatamente onde estava.
 */
export function buildCampaignLeadPatch(
  campaign: Record<string, unknown>,
  now: string,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    source: "whatsapp_campaign",
    agent_id: text(campaign.agent_id),
    agent_assignment_source: "whatsapp_campaign",
    last_message_at: now,
    last_seen: now,
    updated_at: now,
  };
  const destination = parseCampaignLeadDestination(campaign.lead_destination);
  if (destination.moveToFunnel) {
    patch.crm_funnel_id = destination.funnelId;
    patch.status = destination.columnId;
  }
  if (destination.ownerAction === "soltar") {
    patch.owner_employee_id = null;
  } else if (destination.ownerAction === "atribuir" && destination.ownerEmployeeId) {
    patch.owner_employee_id = destination.ownerEmployeeId;
  }
  return patch;
}

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
    ruleId: text(params.campaign.rule_id),
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
    ruleId: journey.ruleId!,
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
      agent_outbox_id: outbound.id,
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

  const now = new Date().toISOString();
  let messageUpdateError: { message: string } | null = null;
  let providerMessageId: string | null = null;
  let providerRemoteJid: string | null = null;
  let providerStatus: string | null = null;
  let deliveryStatus: "pending" | "sent" | "delivered" | "read" | "failed" = "sent";
  if (params.sender.transport === "evolution") {
    const receipt = await persistEvolutionSendReceipt({
      sb: params.sb,
      tenantId,
      messageRowId: message.id,
      connectionId: String(params.campaign.connection_id),
      payload: "data" in delivery ? delivery.data : null,
    });
    providerMessageId = receipt.messageId;
    providerRemoteJid = receipt.remoteJid;
    providerStatus = receipt.providerStatus;
    deliveryStatus = receipt.deliveryStatus;
  } else {
    providerMessageId = "messageId" in delivery ? delivery.messageId ?? null : null;
    const update = await params.sb
      .from("whatsapp_messages")
      .update({
        delivery_status: "sent",
        sent_at: now,
        failed_reason: null,
        provider_message_id: providerMessageId,
      })
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
  await finalizeAgentOutboundDelivery({
    sb: params.sb,
    id: outbound.id,
    claimToken: outbound.claimToken,
    providerMessageId,
    kind: "text",
    content,
    providerRemoteJid,
    providerStatus,
    deliveryStatus,
  });
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
      .update(buildCampaignLeadPatch(params.campaign, now))
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
  // Disparo "único": a mensagem já saiu, mas o dono da conta configurou pra
  // não continuar a conversa pela IA — pausa a automação agora que o resto do
  // upsert (agent_id, journey) já está gravado. O botão de "reativar
  // automação" do CRM já existente destrava isso quando quiserem.
  if (params.campaign.continue_with_agent === false) {
    await pauseConversationAfterCampaignSend({
      sb: params.sb,
      tenantId,
      remoteJid: jid,
      leadId: text(lead.id),
      agentId: text(params.campaign.agent_id),
    });
  }
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

/**
 * O que fazer com o lead no CRM quando ele entra num disparo. A troca do
 * agente de IA (`leads.agent_id`) não é opção aqui — acontece sempre, em
 * `processRecipient`, porque é a isolação do agente de disparos já em
 * produção. Isto cobre só o que o dono da conta pode escolher por campanha:
 * mover o card pra outro funil/coluna, e o que fazer com o vendedor humano
 * responsável.
 */
export type CampaignOwnerAction = "manter" | "soltar" | "atribuir";

export type CampaignLeadDestination = {
  moveToFunnel: boolean;
  funnelId: string | null;
  columnId: string | null;
  ownerAction: CampaignOwnerAction;
  /** Só preenchido quando `ownerAction === "atribuir"`. Validado em `createWhatsAppCampaign`. */
  ownerEmployeeId: string | null;
};

/**
 * Lê o destino gravado na campanha. `moveToFunnel` só fica `true` quando
 * funil E coluna vêm preenchidos — meia-configuração (ligado sem destino
 * escolhido) não move nada, mesmo raciocínio de `parseCampaignSendWindow`.
 *
 * `ownerAction` é independente do funil: dá pra soltar/atribuir o vendedor
 * sem mover de funil, ou mover sem mexer no vendedor. `"atribuir"` sem
 * `ownerEmployeeId` cai pra `"manter"` — meia-configuração não reatribui
 * ninguém. Compatibilidade: campanha antiga só tinha `releaseOwner`
 * (booleano); sem `ownerAction` explícito, `releaseOwner: true` vira
 * `"soltar"`.
 */
export function parseCampaignLeadDestination(raw: unknown): CampaignLeadDestination {
  const config = object(raw);
  const funnelId = text(config.funnelId);
  const columnId = text(config.columnId);
  const moveToFunnel = config.moveToFunnel === true && Boolean(funnelId && columnId);
  const ownerEmployeeId = text(config.ownerEmployeeId);

  let ownerAction: CampaignOwnerAction = "manter";
  if (config.ownerAction === "atribuir" && ownerEmployeeId) {
    ownerAction = "atribuir";
  } else if (config.ownerAction === "soltar" || (config.ownerAction === undefined && config.releaseOwner === true)) {
    ownerAction = "soltar";
  }

  return {
    moveToFunnel,
    funnelId: moveToFunnel ? funnelId : null,
    columnId: moveToFunnel ? columnId : null,
    ownerAction,
    ownerEmployeeId: ownerAction === "atribuir" ? ownerEmployeeId : null,
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
    if (!(await campaignRuleAuthorizesConfiguration(sb, campaign))) {
      await sb
        .from("whatsapp_campaigns")
        .update({
          status: "review_required",
          review_reason: "campaign_rule_not_authorized",
          updated_at: now,
        })
        .eq("tenant_id", campaign.tenant_id)
        .eq("id", campaign.id)
        .in("status", ["scheduled", "processing"]);
      outcomes.rule_review_required = (outcomes.rule_review_required ?? 0) + 1;
      continue;
    }

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
    // O `.in(status)` é o que respeita uma pausa feita DURANTE esta passada:
    // sem ele, este update final devolveria a campanha para "processing" e o
    // pause do cliente seria desfeito sozinho segundos depois.
    await sb
      .from("whatsapp_campaigns")
      .update({
        status: pending ? "processing" : "completed",
        total_sent: sent,
        total_failed: failed,
        completed_at: pending ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", campaign.id)
      .in("status", ["scheduled", "processing"]);
  }
  return { processed, outcomes };
}

/**
 * Ações do card na tela: dar play, pausar e voltar do zero.
 *
 * Retomar não precisa de nenhuma mágica: `whatsapp_campaign_recipients` guarda
 * quem já recebeu, então voltar o status pra "scheduled" faz o processador
 * continuar exatamente da fila que estava — sem reenviar pra ninguém.
 */
export type CampaignControlAction = "start" | "pause" | "reset";

export async function controlWhatsAppCampaign(params: {
  sb: ServiceClient;
  tenantId: string;
  campaignId: string;
  action: CampaignControlAction;
}): Promise<Record<string, unknown>> {
  const { data: current, error: loadError } = await params.sb
    .from("whatsapp_campaigns")
    .select("id, tenant_id, status, rule_id, agent_id, connection_id, transport")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.campaignId)
    .maybeSingle();
  if (loadError) throw new Error(`campaign_load:${loadError.message}`);
  if (!current) throw new Error("campaign_not_found");

  const status = String((current as { status: unknown }).status);
  const now = new Date().toISOString();

  if (params.action === "pause") {
    if (!["scheduled", "processing"].includes(status)) throw new Error("campaign_not_running");
    return updateCampaignRow(params, { status: "paused", updated_at: now });
  }

  if (params.action === "start") {
    if (!["draft", "paused"].includes(status)) throw new Error("campaign_not_startable");
    if (!(await campaignRuleAuthorizesConfiguration(params.sb, current as Record<string, unknown>))) {
      await updateCampaignRow(params, {
        status: "review_required",
        review_reason: "campaign_rule_not_authorized",
        updated_at: now,
      });
      throw new Error("campaign_rule_not_authorized");
    }
    // `scheduled_at` volta pra agora: uma campanha salva ontem com data de
    // ontem não deve ficar esperando nada — play significa "manda agora".
    return updateCampaignRow(params, { status: "scheduled", scheduled_at: now, updated_at: now });
  }

  // reset: devolve TODO destinatário pra fila e zera o placar. Só o que já foi
  // enviado de verdade não volta atrás — a mensagem no WhatsApp do lead não
  // tem como ser desfeita, mas ele entra de novo na fila e recebe outra vez,
  // que é exatamente o que "começar do zero" quer dizer.
  const { error: recipientsError } = await params.sb
    .from("whatsapp_campaign_recipients")
    .update({ status: "pending", sent_at: null, message_id: null, attempts: 0, last_error: null, next_attempt_at: now, updated_at: now })
    .eq("tenant_id", params.tenantId)
    .eq("campaign_id", params.campaignId);
  if (recipientsError) throw new Error(`campaign_reset_recipients:${recipientsError.message}`);

  return updateCampaignRow(params, {
    status: "draft",
    total_sent: 0,
    total_failed: 0,
    started_at: null,
    completed_at: null,
    scheduled_at: now,
    updated_at: now,
  });
}

async function updateCampaignRow(
  params: { sb: ServiceClient; tenantId: string; campaignId: string },
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await params.sb
    .from("whatsapp_campaigns")
    .update(patch)
    .eq("tenant_id", params.tenantId)
    .eq("id", params.campaignId)
    .select("*")
    .single();
  if (error || !data) throw new Error(`campaign_update:${error?.message ?? "missing_campaign"}`);
  return data as Record<string, unknown>;
}

/** Ordem escolhida a dedo pelo cliente arrastando os cards. */
export async function reorderWhatsAppCampaigns(params: {
  sb: ServiceClient;
  tenantId: string;
  orderedIds: string[];
}): Promise<void> {
  await Promise.all(
    params.orderedIds.map((id, index) =>
      params.sb
        .from("whatsapp_campaigns")
        .update({ display_order: index })
        .eq("tenant_id", params.tenantId)
        .eq("id", id),
    ),
  );
}
