import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { AiMessage } from "@/lib/ai/types";
import { getAgentOutboundMediaPromptLines } from "@/lib/server/agent-media-files";
import { resolveOpenAiApiKey } from "@/lib/ai/openai-api-key";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type ConversationState = {
  id: string;
  tenantId: string;
  remoteJid: string;
  leadId: string | null;
  agentId: string | null;
  channel: string;
  status: string;
  humanPaused: boolean;
  pausedReason: string | null;
  pausedBy: string | null;
  handoffSuggested: boolean;
  handoffReason: string | null;
  lastSummaryAt: string | null;
  isHidden: boolean;
  archivedAt: string | null;
  conversationMode?: string | null;
};

export type ConversationSummary = {
  summary: string;
  customerIntent: string | null;
  leadTemperature: string | null;
  suggestedNextAction: string | null;
  objections: string[];
  importantFacts: Record<string, unknown>;
  createdAt: string;
};

export type ConversationMessageContext = {
  id?: string;
  role: "user" | "assistant" | "human";
  content: string;
  kind: string;
  createdAt: string;
};

export type LeadRuntimeContext = {
  id: string;
  name: string | null;
  phone: string | null;
  source: string | null;
  status: string | null;
  crmFunnelId: string | null;
  notes: string | null;
  agentId: string | null;
  aiSummary: string | null;
  leadTemperature: string | null;
  suggestedNextAction: string | null;
  profileMetadata: Record<string, unknown>;
};

export type AgentRuntimeContext = {
  state: ConversationState | null;
  lead: LeadRuntimeContext | null;
  summary: ConversationSummary | null;
  recentMessages: ConversationMessageContext[];
  knowledgeSnippets: string[];
  /** Linhas `nome — descrição` para o bloco ARQUIVOS DISPONÍVEIS PARA ENVIO. */
  outboundMediaLines: string[];
};

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function phoneFromRemoteJid(remoteJid: string | null | undefined): string | null {
  const digits = String(remoteJid ?? "").split("@")[0]?.replace(/\D/g, "") ?? "";
  return digits.length >= 8 ? digits : null;
}

function rowToState(row: Record<string, unknown>): ConversationState {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    remoteJid: String(row.remote_jid),
    leadId: textOrNull(row.lead_id),
    agentId: textOrNull(row.agent_id),
    channel: String(row.channel ?? "whatsapp"),
    status: String(row.status ?? "active"),
    humanPaused: row.human_paused === true,
    pausedReason: textOrNull(row.paused_reason),
    pausedBy: textOrNull(row.paused_by),
    handoffSuggested: row.handoff_suggested === true,
    handoffReason: textOrNull(row.handoff_reason),
    lastSummaryAt: textOrNull(row.last_summary_at),
    isHidden: row.is_hidden === true,
    archivedAt: textOrNull(row.archived_at),
    conversationMode: textOrNull(row.conversation_mode),
  };
}

function rowToLead(row: Record<string, unknown>): LeadRuntimeContext {
  const metadata = row.profile_metadata && typeof row.profile_metadata === "object"
    ? (row.profile_metadata as Record<string, unknown>)
    : {};
  return {
    id: String(row.id),
    name: textOrNull(row.name),
    phone: textOrNull(row.phone),
    source: textOrNull(row.source),
    status: textOrNull(row.status),
    crmFunnelId: textOrNull(row.crm_funnel_id),
    notes: textOrNull(row.notes),
    agentId: textOrNull(row.agent_id),
    aiSummary: textOrNull(row.ai_summary),
    leadTemperature: textOrNull(row.lead_temperature),
    suggestedNextAction: textOrNull(row.suggested_next_action),
    profileMetadata: metadata,
  };
}

function rowToSummary(row: Record<string, unknown>): ConversationSummary {
  return {
    summary: String(row.summary ?? ""),
    customerIntent: textOrNull(row.customer_intent),
    leadTemperature: textOrNull(row.lead_temperature),
    suggestedNextAction: textOrNull(row.suggested_next_action),
    objections: Array.isArray(row.objections) ? row.objections.filter((item): item is string => typeof item === "string") : [],
    importantFacts: row.important_facts && typeof row.important_facts === "object" ? (row.important_facts as Record<string, unknown>) : {},
    createdAt: String(row.created_at ?? ""),
  };
}

function rowToMessage(row: Record<string, unknown>): ConversationMessageContext {
  const direction = String(row.direction ?? "");
  const agentId = textOrNull(row.agent_id);
  return {
    id: typeof row.id === "string" ? row.id : undefined,
    role: direction === "inbound" ? "user" : agentId === "human" ? "human" : "assistant",
    content: String(row.content ?? ""),
    kind: String(row.kind ?? "text"),
    createdAt: String(row.created_at ?? ""),
  };
}

export async function getConversationState(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  channel?: string;
}): Promise<ConversationState | null> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const { data, error } = await sb
    .from("conversation_states")
    .select("*")
    .eq("tenant_id", params.tenantId)
    .eq("remote_jid", params.remoteJid)
    .eq("channel", params.channel ?? "whatsapp")
    .maybeSingle();
  if (error) {
    console.warn("[conversation-memory] state", error.code, error.message);
    return null;
  }
  return data ? rowToState(data as Record<string, unknown>) : null;
}

export async function upsertConversationState(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  leadId?: string | null;
  agentId?: string | null;
  channel?: string;
  humanPaused?: boolean;
  pausedReason?: string | null;
  pausedBy?: string | null;
  handoffSuggested?: boolean;
  handoffReason?: string | null;
  status?: string;
  lastMessageAt?: string | null;
  lastSummaryAt?: string | null;
  isHidden?: boolean;
  archivedAt?: string | null;
  hiddenAt?: string | null;
  hiddenBy?: string | null;
  conversationMode?: string | null;
}): Promise<ConversationState | null> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    tenant_id: params.tenantId,
    remote_jid: params.remoteJid,
    channel: params.channel ?? "whatsapp",
    updated_at: now,
  };
  if (params.leadId !== undefined) patch.lead_id = params.leadId;
  if (params.agentId !== undefined) patch.agent_id = params.agentId;
  if (params.humanPaused !== undefined) {
    patch.human_paused = params.humanPaused;
    patch.status = params.humanPaused ? "human_paused" : params.status ?? "active";
    if (params.humanPaused) patch.paused_at = now;
    else patch.resumed_at = now;
  } else if (params.status) {
    patch.status = params.status;
  }
  if (params.pausedReason !== undefined) patch.paused_reason = params.pausedReason;
  if (params.pausedBy !== undefined) patch.paused_by = params.pausedBy;
  if (params.handoffSuggested !== undefined) patch.handoff_suggested = params.handoffSuggested;
  if (params.handoffReason !== undefined) patch.handoff_reason = params.handoffReason;
  if (params.lastMessageAt !== undefined) patch.last_message_at = params.lastMessageAt;
  if (params.lastSummaryAt !== undefined) patch.last_summary_at = params.lastSummaryAt;
  if (params.isHidden !== undefined) patch.is_hidden = params.isHidden;
  if (params.archivedAt !== undefined) patch.archived_at = params.archivedAt;
  if (params.hiddenAt !== undefined) patch.hidden_at = params.hiddenAt;
  if (params.hiddenBy !== undefined) patch.hidden_by = params.hiddenBy;
  if (params.conversationMode !== undefined) patch.conversation_mode = params.conversationMode;

  const { data, error } = await sb
    .from("conversation_states")
    .upsert(patch, { onConflict: "tenant_id,remote_jid,channel" })
    .select("*")
    .single();
  if (error) {
    console.warn("[conversation-memory] upsert state", error.code, error.message);
    return null;
  }
  return rowToState(data as Record<string, unknown>);
}

export async function findLeadForConversation(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid?: string | null;
  phone?: string | null;
}): Promise<LeadRuntimeContext | null> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const phone = textOrNull(params.phone) ?? phoneFromRemoteJid(params.remoteJid);
  if (!phone) return null;
  const { data, error } = await sb
    .from("leads")
    .select("id,name,phone,source,status,notes,agent_id,crm_funnel_id,ai_summary,lead_temperature,suggested_next_action,profile_metadata")
    .eq("tenant_id", params.tenantId)
    .eq("phone", phone)
    .maybeSingle();
  if (error) {
    console.warn("[conversation-memory] lead", error.code, error.message);
    return null;
  }
  return data ? rowToLead(data as Record<string, unknown>) : null;
}

export async function getRecentConversationMessages(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  limit?: number;
}): Promise<ConversationMessageContext[]> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const { data, error } = await sb
    .from("whatsapp_messages")
    .select("id,direction,kind,content,agent_id,created_at")
    .eq("tenant_id", params.tenantId)
    .eq("remote_jid", params.remoteJid)
    .order("created_at", { ascending: false })
    .limit(params.limit ?? 24);
  if (error) {
    console.warn("[conversation-memory] messages", error.code, error.message);
    return [];
  }
  return ((data ?? []) as Array<Record<string, unknown>>).reverse().map(rowToMessage);
}

export async function getLatestConversationSummary(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
}): Promise<ConversationSummary | null> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const { data, error } = await sb
    .from("conversation_summaries")
    .select("*")
    .eq("tenant_id", params.tenantId)
    .eq("remote_jid", params.remoteJid)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    console.warn("[conversation-memory] summary", error.code, error.message);
    return null;
  }
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  return row ? rowToSummary(row) : null;
}

export async function getAgentKnowledgeSnippets(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
  limit?: number;
}): Promise<string[]> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const { data, error } = await sb
    .from("agent_knowledge_files")
    .select("original_filename,mime_type,size_bytes,status,extracted_text")
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(params.limit ?? 8);
  if (error) {
    console.warn("[conversation-memory] knowledge", error.code, error.message);
    return [];
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const filename = String(row.original_filename ?? "material");
    const text = textOrNull(row.extracted_text);
    return text
      ? `Material: ${filename}\nTrecho extraído:\n${text.slice(0, 1600)}`
      : `Material disponível: ${filename} (${row.mime_type ?? "tipo desconhecido"}, ${row.size_bytes ?? 0} bytes).`;
  });
}

export async function loadAgentRuntimeContext(params: {
  tenantId: string;
  agentId: string;
  remoteJid?: string | null;
}): Promise<AgentRuntimeContext> {
  const sb = createSupabaseServiceClient();
  if (!params.remoteJid) {
    const [knowledgeSnippets, outboundMediaLines] = await Promise.all([
      getAgentKnowledgeSnippets({ sb, tenantId: params.tenantId, agentId: params.agentId }),
      getAgentOutboundMediaPromptLines({ sb, tenantId: params.tenantId, agentId: params.agentId }),
    ]);
    return { state: null, lead: null, summary: null, recentMessages: [], knowledgeSnippets, outboundMediaLines };
  }
  const [state, lead, summary, recentMessages, knowledgeSnippets, outboundMediaLines] = await Promise.all([
    getConversationState({ sb, tenantId: params.tenantId, remoteJid: params.remoteJid }),
    findLeadForConversation({ sb, tenantId: params.tenantId, remoteJid: params.remoteJid }),
    getLatestConversationSummary({ sb, tenantId: params.tenantId, remoteJid: params.remoteJid }),
    getRecentConversationMessages({ sb, tenantId: params.tenantId, remoteJid: params.remoteJid }),
    getAgentKnowledgeSnippets({ sb, tenantId: params.tenantId, agentId: params.agentId }),
    getAgentOutboundMediaPromptLines({ sb, tenantId: params.tenantId, agentId: params.agentId }),
  ]);
  return { state, lead, summary, recentMessages, knowledgeSnippets, outboundMediaLines };
}

export function conversationMessagesToAi(messages: ConversationMessageContext[]): AiMessage[] {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role === "user" ? "user" : "assistant",
      content: message.kind === "text" ? message.content : `[${message.kind}] ${message.content}`,
    }));
}

export function shouldTriggerHandoff(text: string, keywords: string[] = []): { trigger: boolean; reason: string | null } {
  const normalized = text.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  const defaults = [
    "humano",
    "atendente",
    "pessoa",
    "ligacao",
    "me liga",
    "telefone",
    "reclamacao",
    "reclamar",
  ];
  const all = [...defaults, ...keywords.map((k) => k.toLowerCase())].filter(Boolean);
  const found = all.find((keyword) => normalized.includes(keyword.normalize("NFD").replace(/\p{Diacritic}/gu, "")));
  return { trigger: Boolean(found), reason: found ?? null };
}

/**
 * Versão IA de detecção de handoff. Usa gpt-4o-mini como classificador binário (sim/não)
 * para detectar se o cliente quer falar com uma pessoa real — independente do vocabulário
 * usado (universal para qualquer nicho).
 *
 * Em caso de falha (API indisponível, timeout, erro), cai automaticamente para a detecção
 * baseada em keywords via shouldTriggerHandoff().
 */
export async function shouldTriggerHandoffAI(
  userMessage: string,
  handoffKeywords: string[] = [],
): Promise<{ trigger: boolean; reason: string | null }> {
  const text = userMessage.trim();
  if (!text) return { trigger: false, reason: null };

  try {
    const apiKey = await resolveOpenAiApiKey();
    if (!apiKey) {
      // Sem chave disponível — fallback síncrono
      return shouldTriggerHandoff(text, handoffKeywords);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);

    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0,
          max_tokens: 5,
          messages: [
            {
              role: "system",
              content: "Você é um classificador. Responda apenas 'sim' ou 'nao'.",
            },
            {
              role: "user",
              content: `O cliente quer falar com uma pessoa humana real (atendente, responsável, especialista, corretor, gerente ou qualquer cargo/função)? Mensagem: "${text.slice(0, 500)}"`,
            },
          ],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return shouldTriggerHandoff(text, handoffKeywords);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const answer = data?.choices?.[0]?.message?.content?.trim().toLowerCase() ?? "";
    const trigger = answer.includes("sim");

    if (trigger) {
      console.info("[handoff-ai] handoff detected by AI classifier", {
        answer,
        message_excerpt: text.slice(0, 80),
      });
    }

    return { trigger, reason: trigger ? "ai_classifier" : null };
  } catch (err) {
    // Timeout ou erro de rede — fallback síncrono sem bloquear o fluxo
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.warn("[handoff-ai] classifier failed, falling back to keywords", {
      reason: isAbort ? "timeout_3s" : err instanceof Error ? err.message : "unknown",
    });
    return shouldTriggerHandoff(text, handoffKeywords);
  }
}

export function buildDeterministicHandoffSummary(params: {
  lead: LeadRuntimeContext | null;
  messages: ConversationMessageContext[];
  reason: string;
}): Omit<ConversationSummary, "createdAt"> {
  const lastUserMessages = params.messages.filter((m) => m.role === "user").slice(-5).map((m) => m.content);
  const summary = [
    params.lead?.name ? `Cliente: ${params.lead.name}.` : null,
    lastUserMessages.length ? `Últimas mensagens do cliente: ${lastUserMessages.join(" | ")}` : "Sem mensagens recentes suficientes.",
    `Motivo do handoff: ${params.reason}.`,
  ].filter(Boolean).join("\n");
  return {
    summary,
    customerIntent: lastUserMessages.at(-1) ?? null,
    leadTemperature: params.reason.includes("contratar") || params.reason.includes("proposta") ? "quente" : "morno",
    suggestedNextAction: "Atendente humano deve assumir a conversa e responder com contexto do histórico.",
    objections: [],
    importantFacts: {},
  };
}

export async function saveConversationSummary(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  stateId?: string | null;
  leadId?: string | null;
  agentId?: string | null;
  summary: Omit<ConversationSummary, "createdAt">;
}): Promise<void> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const now = new Date().toISOString();
  await sb.from("conversation_summaries").insert({
    tenant_id: params.tenantId,
    remote_jid: params.remoteJid,
    conversation_state_id: params.stateId ?? null,
    lead_id: params.leadId ?? null,
    agent_id: params.agentId ?? null,
    summary: params.summary.summary,
    customer_intent: params.summary.customerIntent,
    lead_temperature: params.summary.leadTemperature,
    suggested_next_action: params.summary.suggestedNextAction,
    objections: params.summary.objections,
    important_facts: params.summary.importantFacts,
    created_at: now,
    updated_at: now,
  });
  if (params.leadId) {
    await sb
      .from("leads")
      .update({
        ai_summary: params.summary.summary,
        lead_temperature: params.summary.leadTemperature,
        suggested_next_action: params.summary.suggestedNextAction,
        updated_at: now,
      })
      .eq("tenant_id", params.tenantId)
      .eq("id", params.leadId);
  }
  await upsertConversationState({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    leadId: params.leadId,
    agentId: params.agentId,
    lastMessageAt: now,
    lastSummaryAt: now,
  });
}
