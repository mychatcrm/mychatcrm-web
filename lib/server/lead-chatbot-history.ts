import { buildConversationTimeline } from "@/lib/conversas/conversation-timeline";
import { loadConversationEvents } from "@/lib/server/conversation-operation";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type ChatbotHistoryMessage = {
  id: string;
  direction: "inbound" | "outbound";
  kind: string;
  content: string;
  media_url: string | null;
  mime_type: string | null;
  storage_key: string | null;
  file_name: string | null;
  caption: string | null;
  media_duration_seconds: number | null;
  thumbnail_url: string | null;
  transcription_status: string | null;
  analysis_status: string | null;
  ai_description: string | null;
  journey_id: string | null;
  agent_id: string | null;
  agent_name: string | null;
  channel: string;
  created_at: string;
};

export type ChatbotHistoryJourney = {
  id: string;
  source: string;
  form_id: string | null;
  campaign_id: string | null;
  agent_id: string | null;
  agent_name: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  metadata: Record<string, unknown>;
};

export type ChatbotHistorySummary = {
  summary: string;
  customer_intent: string | null;
  lead_temperature: string | null;
  suggested_next_action: string | null;
  objections: string[] | null;
  important_facts: Record<string, unknown> | null;
  created_at: string | null;
};

export type ChatbotConversationState = {
  human_paused: boolean;
  paused_reason: string | null;
  paused_by: string | null;
  paused_at: string | null;
  handoff_suggested: boolean;
  handoff_reason: string | null;
  status: string | null;
  channel: string | null;
  last_message_at: string | null;
  conversation_mode: string | null;
  assigned_human_name: string | null;
};

export type ChatbotHistoryEvent = {
  id: string;
  event_type: string;
  title: string;
  detail: string | null;
  created_at: string;
};

export function normalizeLeadPhone(value: unknown): string {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

function toMessage(row: Record<string, unknown>, agentNames: Map<string, string>): ChatbotHistoryMessage {
  const agentId = typeof row.agent_id === "string" ? row.agent_id : null;
  return {
    id: String(row.id),
    direction: row.direction === "outbound" ? "outbound" : "inbound",
    kind: typeof row.kind === "string" ? row.kind : "text",
    content: typeof row.content === "string" ? row.content : "",
    media_url: typeof row.media_url === "string" ? row.media_url : null,
    mime_type: typeof row.mime_type === "string" ? row.mime_type : null,
    storage_key: typeof row.storage_key === "string" ? row.storage_key : null,
    file_name: typeof row.file_name === "string" ? row.file_name : null,
    caption: typeof row.caption === "string" ? row.caption : null,
    media_duration_seconds:
      typeof row.media_duration_seconds === "number" ? row.media_duration_seconds : null,
    thumbnail_url: typeof row.thumbnail_url === "string" ? row.thumbnail_url : null,
    transcription_status:
      typeof row.transcription_status === "string" ? row.transcription_status : null,
    analysis_status: typeof row.analysis_status === "string" ? row.analysis_status : null,
    ai_description: typeof row.ai_description === "string" ? row.ai_description : null,
    journey_id: typeof row.journey_id === "string" ? row.journey_id : null,
    agent_id: agentId,
    agent_name: agentId ? agentNames.get(agentId) ?? agentId : null,
    channel: "whatsapp",
    created_at: String(row.created_at ?? ""),
  };
}

export async function loadLeadChatbotHistory(params: {
  tenantId: string;
  leadId: string;
  limit?: number;
}): Promise<{
  messages: ChatbotHistoryMessage[];
  events: ChatbotHistoryEvent[];
  timeline: ReturnType<typeof buildConversationTimeline<ChatbotHistoryMessage>>;
  summary: ChatbotHistorySummary | null;
  conversationState: ChatbotConversationState | null;
  journeys: ChatbotHistoryJourney[];
}> {
  const sb = createSupabaseServiceClient();
  const { data: lead, error: leadError } = await sb
    .from("leads")
    .select("id, phone")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.leadId)
    .maybeSingle();

  if (leadError) throw new Error("LEAD_QUERY_FAILED");
  if (!lead) throw new Error("LEAD_NOT_FOUND");

  const phone = normalizeLeadPhone((lead as { phone?: unknown }).phone);
  if (!phone) {
    return { messages: [], events: [], timeline: [], summary: null, conversationState: null, journeys: [] };
  }

  const remoteJidPattern = `${phone}%`;
  const limit = params.limit ?? 200;

  const [messagesRes, summaryRes, stateRes, journeysRes] = await Promise.all([
    sb
      .from("whatsapp_messages")
      .select(
        "id, remote_jid, direction, kind, content, media_url, mime_type, storage_key, file_name, caption, media_duration_seconds, thumbnail_url, transcription_status, analysis_status, ai_description, journey_id, agent_id, created_at",
      )
      .eq("tenant_id", params.tenantId)
      .ilike("remote_jid", remoteJidPattern)
      .order("created_at", { ascending: true })
      .limit(limit),
    sb
      .from("conversation_summaries")
      .select(
        "summary, customer_intent, lead_temperature, suggested_next_action, objections, important_facts, created_at",
      )
      .eq("tenant_id", params.tenantId)
      .eq("lead_id", params.leadId)
      .order("created_at", { ascending: false })
      .limit(1),
    sb
      .from("conversation_states")
      .select(
        "human_paused, paused_reason, paused_by, paused_at, handoff_suggested, handoff_reason, status, channel, last_message_at, remote_jid, conversation_mode, assigned_human_name",
      )
      .eq("tenant_id", params.tenantId)
      .eq("lead_id", params.leadId)
      .order("updated_at", { ascending: false })
      .limit(5),
    sb
      .from("lead_journeys")
      .select("id, source, form_id, campaign_id, agent_id, status, started_at, ended_at, metadata")
      .eq("tenant_id", params.tenantId)
      .eq("lead_id", params.leadId)
      .order("started_at", { ascending: true }),
  ]);

  if (messagesRes.error) throw new Error("MESSAGES_QUERY_FAILED");

  const agentIds = [
    ...new Set(
      (messagesRes.data ?? [])
        .map((row) => (row as { agent_id?: unknown }).agent_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0 && id !== "human"),
    ),
  ];

  const agentNames = new Map<string, string>();
  if (agentIds.length) {
    const { data: agents } = await sb
      .from("tenant_agents")
      .select("agent_id, display_name")
      .eq("tenant_id", params.tenantId)
      .in("agent_id", agentIds);
    for (const row of agents ?? []) {
      const id = (row as { agent_id?: string }).agent_id;
      const name = (row as { display_name?: string }).display_name;
      if (id && name) agentNames.set(id, name);
    }
  }

  const messages = ((messagesRes.data ?? []) as Array<Record<string, unknown>>).map((row) =>
    toMessage(row, agentNames),
  );
  const journeys: ChatbotHistoryJourney[] = (
    journeysRes.error ? [] : (journeysRes.data ?? [])
  ).map((raw) => {
    const row = raw as Record<string, unknown>;
    const agentId = typeof row.agent_id === "string" ? row.agent_id : null;
    return {
      id: String(row.id),
      source: String(row.source ?? "manual"),
      form_id: typeof row.form_id === "string" ? row.form_id : null,
      campaign_id: typeof row.campaign_id === "string" ? row.campaign_id : null,
      agent_id: agentId,
      agent_name: agentId ? agentNames.get(agentId) ?? agentId : null,
      status: String(row.status ?? ""),
      started_at: String(row.started_at ?? ""),
      ended_at: typeof row.ended_at === "string" ? row.ended_at : null,
      metadata:
        row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {},
    };
  });

  const summaryRow = summaryRes.error ? null : summaryRes.data?.[0];
  const summary: ChatbotHistorySummary | null = summaryRow
    ? {
        summary: String((summaryRow as { summary?: unknown }).summary ?? ""),
        customer_intent:
          typeof (summaryRow as { customer_intent?: unknown }).customer_intent === "string"
            ? (summaryRow as { customer_intent: string }).customer_intent
            : null,
        lead_temperature:
          typeof (summaryRow as { lead_temperature?: unknown }).lead_temperature === "string"
            ? (summaryRow as { lead_temperature: string }).lead_temperature
            : null,
        suggested_next_action:
          typeof (summaryRow as { suggested_next_action?: unknown }).suggested_next_action ===
          "string"
            ? (summaryRow as { suggested_next_action: string }).suggested_next_action
            : null,
        objections: Array.isArray((summaryRow as { objections?: unknown }).objections)
          ? ((summaryRow as { objections: unknown[] }).objections).filter(
              (item): item is string => typeof item === "string",
            )
          : null,
        important_facts:
          (summaryRow as { important_facts?: unknown }).important_facts &&
          typeof (summaryRow as { important_facts?: unknown }).important_facts === "object"
            ? ((summaryRow as { important_facts: Record<string, unknown> }).important_facts)
            : null,
        created_at:
          typeof (summaryRow as { created_at?: unknown }).created_at === "string"
            ? (summaryRow as { created_at: string }).created_at
            : null,
      }
    : null;

  const stateRows = (stateRes.error ? [] : stateRes.data ?? []) as Array<Record<string, unknown>>;
  const stateMatch =
    stateRows.find((row) => normalizeLeadPhone(row.remote_jid).startsWith(phone)) ?? stateRows[0];
  const conversationState: ChatbotConversationState | null = stateMatch
    ? {
        human_paused: Boolean(stateMatch.human_paused),
        paused_reason:
          typeof stateMatch.paused_reason === "string" ? stateMatch.paused_reason : null,
        paused_by: typeof stateMatch.paused_by === "string" ? stateMatch.paused_by : null,
        paused_at: typeof stateMatch.paused_at === "string" ? stateMatch.paused_at : null,
        handoff_suggested: Boolean(stateMatch.handoff_suggested),
        handoff_reason:
          typeof stateMatch.handoff_reason === "string" ? stateMatch.handoff_reason : null,
        status: typeof stateMatch.status === "string" ? stateMatch.status : null,
        channel: typeof stateMatch.channel === "string" ? stateMatch.channel : null,
        last_message_at:
          typeof stateMatch.last_message_at === "string" ? stateMatch.last_message_at : null,
        conversation_mode:
          typeof stateMatch.conversation_mode === "string" ? stateMatch.conversation_mode : null,
        assigned_human_name:
          typeof stateMatch.assigned_human_name === "string" ? stateMatch.assigned_human_name : null,
      }
    : null;

  const events = await loadConversationEvents({
    sb,
    tenantId: params.tenantId,
    leadId: params.leadId,
  });
  const timeline = buildConversationTimeline(messages, events);

  return { messages, events, timeline, summary, conversationState, journeys };
}
