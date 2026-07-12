import type { AiMessage } from "@/lib/ai/types";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  type AgentRuntimeContext,
  type ConversationMessageContext,
  type ConversationState,
  type ConversationSummary,
  type LeadRuntimeContext,
  conversationMessagesToAi,
  findLeadForConversation,
  getAgentKnowledgeSnippets,
  getConversationState,
  getRecentConversationMessages,
} from "@/lib/server/conversation-memory";
import { buildMetaFormMemorySummary } from "@/lib/meta-leads/form-metadata";
import { getAgentOutboundMediaPromptLines } from "@/lib/server/agent-media-files";

const DEFAULT_MESSAGE_LIMIT = 20;

export type LeadConversationMemory = AgentRuntimeContext & {
  aiMessages: AiMessage[];
  condensedContext: string;
  recognitionHint: string | null;
  lastInteractionAt: string | null;
};

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return null;
  return Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
}

export function buildRecognitionHint(params: {
  lastInteractionAt: string | null;
  summary: ConversationSummary | null;
  lead: LeadRuntimeContext | null;
  hasPriorMessages: boolean;
}): string | null {
  if (!params.hasPriorMessages && !params.summary?.summary && !params.lead?.aiSummary) {
    return null;
  }

  const days = daysSince(params.lastInteractionAt);
  let timePhrase = "algum tempo";
  if (days !== null) {
    if (days <= 6) timePhrase = "poucos dias";
    else if (days <= 30) timePhrase = "algumas semanas";
    else if (days <= 180) timePhrase = "alguns meses";
    else timePhrase = "bastante tempo";
  }

  const subject =
    textOrNull(params.summary?.customerIntent) ??
    textOrNull(params.summary?.summary)?.slice(0, 160) ??
    textOrNull(params.lead?.aiSummary)?.slice(0, 160);

  if (subject) {
    return (
      `Retomada de conversa: o cliente já falou com você antes (última interação há ${timePhrase}). ` +
      `Se fizer sentido, reconheça naturalmente e cite apenas o que consta no histórico: "${subject}". ` +
      "Seja curto, humanizado e não invente detalhes."
    );
  }

  return (
    `Retomada de conversa: o cliente já falou com você antes (última interação há ${timePhrase}). ` +
    "Reconheça a volta de forma breve e natural, sem inventar assunto se não houver contexto claro."
  );
}

export type LeadMemorySourceOptions = {
  includeCrm?: boolean;
  includeMetaForm?: boolean;
};

/**
 * Uma jornada explicita nao pode herdar texto livre nem formulario de outra jornada.
 * Identificacao e estado do CRM continuam disponiveis; o contexto narrativo vem do
 * resumo e das mensagens filtradas pelo journey_id.
 */
export function isolateLeadContextForJourney(
  lead: LeadRuntimeContext | null,
  journeyId: string | null,
  journeyProfileMetadata: Record<string, unknown> | null,
): LeadRuntimeContext | null {
  if (!lead || !journeyId) return lead;
  return {
    ...lead,
    notes: null,
    aiSummary: null,
    leadTemperature: null,
    suggestedNextAction: null,
    profileMetadata: journeyProfileMetadata ?? {},
  };
}

async function getJourneyProfileMetadata(params: {
  sb: ReturnType<typeof createSupabaseServiceClient>;
  tenantId: string;
  journeyId: string | null;
  agentId: string;
}): Promise<Record<string, unknown> | null> {
  if (!params.journeyId) return null;
  const { data, error } = await params.sb
    .from("lead_journeys")
    .select("agent_id,metadata")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.journeyId)
    .maybeSingle();
  if (error) {
    console.warn("[lead-memory] journey context", error.code, error.message);
    return null;
  }
  if (!data || String(data.agent_id ?? "") !== params.agentId) return null;
  const metadata = data.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const profile = (metadata as Record<string, unknown>).lead_profile;
  return profile && typeof profile === "object" && !Array.isArray(profile)
    ? (profile as Record<string, unknown>)
    : null;
}

export function buildCondensedMemoryContext(
  memory: {
    lead: LeadRuntimeContext | null;
    state: ConversationState | null;
    summary: ConversationSummary | null;
    lastInteractionAt: string | null;
  },
  sources?: LeadMemorySourceOptions,
): string {
  const includeCrm = sources?.includeCrm !== false;
  const includeMetaForm = sources?.includeMetaForm !== false;

  if (!includeCrm && !includeMetaForm) return "";

  const parts: string[] = ["Memória central do CRM (fonte canônica):"];

  if (memory.lead && includeCrm) {
    parts.push(
      `Lead: ${memory.lead.name ?? "sem nome"} | status ${memory.lead.status ?? "—"} | funil ${memory.lead.crmFunnelId ?? "—"} | temperatura ${memory.lead.leadTemperature ?? "—"}`,
    );
    if (memory.lead.aiSummary) parts.push(`Resumo persistido no CRM: ${memory.lead.aiSummary}`);
    if (memory.lead.suggestedNextAction) {
      parts.push(`Próxima ação sugerida: ${memory.lead.suggestedNextAction}`);
    }
  }

  if (memory.lead && includeMetaForm) {
    const formMemory = buildMetaFormMemorySummary(memory.lead.profileMetadata);
    if (formMemory) parts.push(formMemory);
  }

  if (includeCrm && memory.summary) {
    parts.push(
      `Último resumo da conversa: ${memory.summary.summary}`,
      `Intenção: ${memory.summary.customerIntent ?? "—"}`,
      `Objeções: ${memory.summary.objections.length ? memory.summary.objections.join(", ") : "—"}`,
    );
  }

  if (includeCrm && memory.state) {
    parts.push(
      `Automação: ${memory.state.humanPaused ? "pausada" : "ativa"} | handoff: ${memory.state.handoffSuggested ? "sim" : "não"}`,
    );
  }

  if (includeCrm && memory.lastInteractionAt) {
    parts.push(`Última interação registrada: ${memory.lastInteractionAt}`);
  }

  return parts.length > 1 ? parts.join("\n") : "";
}

async function getLatestSummaryForLead(params: {
  tenantId: string;
  leadId?: string | null;
  remoteJid?: string | null;
  journeyId?: string | null;
}): Promise<ConversationSummary | null> {
  const sb = createSupabaseServiceClient();
  if (params.leadId) {
    let query = sb
      .from("conversation_summaries")
      .select("*")
      .eq("tenant_id", params.tenantId)
      .eq("lead_id", params.leadId);
    if (params.journeyId) query = query.eq("journey_id", params.journeyId);
    const { data } = await query.order("created_at", { ascending: false }).limit(1);
    const row = (data ?? [])[0] as Record<string, unknown> | undefined;
    if (row) {
      return {
        summary: String(row.summary ?? ""),
        customerIntent: textOrNull(row.customer_intent),
        leadTemperature: textOrNull(row.lead_temperature),
        suggestedNextAction: textOrNull(row.suggested_next_action),
        objections: Array.isArray(row.objections)
          ? row.objections.filter((item): item is string => typeof item === "string")
          : [],
        importantFacts:
          row.important_facts && typeof row.important_facts === "object"
            ? (row.important_facts as Record<string, unknown>)
            : {},
        createdAt: String(row.created_at ?? ""),
      };
    }
  }

  if (!params.remoteJid) return null;
  let query = sb
    .from("conversation_summaries")
    .select("*")
    .eq("tenant_id", params.tenantId)
    .eq("remote_jid", params.remoteJid);
  if (params.journeyId) query = query.eq("journey_id", params.journeyId);
  const { data } = await query.order("created_at", { ascending: false }).limit(1);
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    summary: String(row.summary ?? ""),
    customerIntent: textOrNull(row.customer_intent),
    leadTemperature: textOrNull(row.lead_temperature),
    suggestedNextAction: textOrNull(row.suggested_next_action),
    objections: Array.isArray(row.objections)
      ? row.objections.filter((item): item is string => typeof item === "string")
      : [],
    importantFacts:
      row.important_facts && typeof row.important_facts === "object"
        ? (row.important_facts as Record<string, unknown>)
        : {},
    createdAt: String(row.created_at ?? ""),
  };
}

/** Monta memória canônica do lead para o agente (janela recente + resumo CRM). */
export async function buildLeadConversationMemory(params: {
  tenantId: string;
  agentId: string;
  remoteJid?: string | null;
  leadId?: string | null;
  journeyId?: string | null;
  messageLimit?: number;
  excludeMessageIds?: string[];
  sourceOptions?: LeadMemorySourceOptions;
}): Promise<LeadConversationMemory> {
  if (!params.remoteJid && !params.leadId) {
    let sb: ReturnType<typeof createSupabaseServiceClient>;
    try {
      sb = createSupabaseServiceClient();
    } catch {
      return {
        state: null,
        lead: null,
        summary: null,
        recentMessages: [],
        knowledgeSnippets: [],
        outboundMediaLines: [],
        aiMessages: [],
        condensedContext: "",
        recognitionHint: null,
        lastInteractionAt: null,
      };
    }

    const [knowledgeSnippets, outboundMediaLines] = await Promise.all([
      getAgentKnowledgeSnippets({ sb, tenantId: params.tenantId, agentId: params.agentId }),
      getAgentOutboundMediaPromptLines({ sb, tenantId: params.tenantId, agentId: params.agentId }),
    ]);

    console.info("[lead-memory]", {
      event: "agent_context_without_conversation",
      tenant_id: params.tenantId,
      agent_id: params.agentId,
      outbound_media_count: outboundMediaLines.length,
      knowledge_count: knowledgeSnippets.length,
    });

    return {
      state: null,
      lead: null,
      summary: null,
      recentMessages: [],
      knowledgeSnippets,
      outboundMediaLines,
      aiMessages: [],
      condensedContext: "",
      recognitionHint: null,
      lastInteractionAt: null,
    };
  }

  const sb = createSupabaseServiceClient();
  const [state, leadByJid, knowledgeSnippets, outboundMediaLines] = await Promise.all([
    params.remoteJid
      ? getConversationState({ sb, tenantId: params.tenantId, remoteJid: params.remoteJid })
      : Promise.resolve(null),
    params.remoteJid
      ? findLeadForConversation({ sb, tenantId: params.tenantId, remoteJid: params.remoteJid })
      : Promise.resolve(null),
    getAgentKnowledgeSnippets({ sb, tenantId: params.tenantId, agentId: params.agentId }),
    getAgentOutboundMediaPromptLines({ sb, tenantId: params.tenantId, agentId: params.agentId }),
  ]);

  let lead = leadByJid;
  if (!lead && params.leadId) {
    const { data } = await sb
      .from("leads")
      .select(
        "id,name,phone,source,status,notes,agent_id,crm_funnel_id,ai_summary,lead_temperature,suggested_next_action,profile_metadata",
      )
      .eq("tenant_id", params.tenantId)
      .eq("id", params.leadId)
      .maybeSingle();
    if (data) {
      const row = data as Record<string, unknown>;
      const metadata =
        row.profile_metadata && typeof row.profile_metadata === "object"
          ? (row.profile_metadata as Record<string, unknown>)
          : {};
      lead = {
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
  }

  const remoteJid =
    params.remoteJid ??
    (lead?.phone ? `${lead.phone.replace(/\D/g, "")}@s.whatsapp.net` : null);
  const journeyId = params.journeyId ?? state?.activeJourneyId ?? null;

  const journeyProfileMetadata = await getJourneyProfileMetadata({
    sb,
    tenantId: params.tenantId,
    journeyId,
    agentId: params.agentId,
  });
  lead = isolateLeadContextForJourney(lead, journeyId, journeyProfileMetadata);

  const recentMessages: ConversationMessageContext[] = remoteJid
    ? await getRecentConversationMessages({
        sb,
        tenantId: params.tenantId,
        remoteJid,
        limit: params.messageLimit ?? DEFAULT_MESSAGE_LIMIT,
        journeyId,
      })
    : [];

  const summary = await getLatestSummaryForLead({
    tenantId: params.tenantId,
    leadId: lead?.id ?? params.leadId ?? state?.leadId ?? null,
    remoteJid,
    journeyId,
  });

  const lastInteractionAt =
    state?.lastSummaryAt ??
    recentMessages.at(-1)?.createdAt ??
    summary?.createdAt ??
    null;

  const exclude = new Set(params.excludeMessageIds ?? []);
  const filteredMessages = exclude.size
    ? recentMessages.filter((m) => !m.id || !exclude.has(m.id))
    : recentMessages;

  const aiMessages = conversationMessagesToAi(filteredMessages);
  const condensedContext = buildCondensedMemoryContext(
    {
      lead,
      state,
      summary,
      lastInteractionAt,
    },
    params.sourceOptions,
  );
  const recognitionHint = buildRecognitionHint({
    lastInteractionAt,
    summary,
    lead,
    hasPriorMessages: recentMessages.length > 0,
  });

  console.info("[lead-memory]", {
    event: "agent_context_loaded",
    tenant_id: params.tenantId,
    agent_id: params.agentId,
    outbound_media_count: outboundMediaLines.length,
    knowledge_count: knowledgeSnippets.length,
  });

  return {
    state,
    lead,
    summary,
    recentMessages,
    knowledgeSnippets,
    outboundMediaLines,
    aiMessages,
    condensedContext,
    recognitionHint,
    lastInteractionAt,
  };
}
