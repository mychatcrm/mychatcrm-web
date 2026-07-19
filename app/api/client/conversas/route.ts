/**
 * GET /api/client/conversas
 * Lista remote_jid únicos do tenant com última mensagem (RPC DISTINCT ON) e
 * estado/CRM. Ordenadas por última mensagem (desc).
 */
import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isConversationVisibleInInbox } from "@/lib/server/conversation-visibility";
import { deriveConversationMode } from "@/lib/server/conversation-operation";

export const dynamic = "force-dynamic";

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function phoneFromRemoteJid(remoteJid: string): string | null {
  const digits = digitsOnly(remoteJid.split("@")[0] ?? remoteJid);
  return digits.length >= 10 ? digits : null;
}

type InboxLastMessage = {
  remote_jid: string;
  last_content: string;
  last_kind: string;
  last_direction: string;
  last_at: string;
  connection_id: string | null;
  channel: string | null;
};

async function loadLastMessages(
  sb: ReturnType<typeof createSupabaseServiceClient>,
  tenantId: string,
  connectionId: string | null,
): Promise<{ rows: InboxLastMessage[]; via: "rpc" | "scan" }> {
  const { data: rpcData, error: rpcError } = await sb.rpc("list_tenant_inbox_conversations", {
    p_tenant_id: tenantId,
    p_connection_id: connectionId,
  });

  if (!rpcError && Array.isArray(rpcData)) {
    return {
      via: "rpc",
      rows: (rpcData as Array<Record<string, unknown>>).map((row) => ({
        remote_jid: String(row.remote_jid ?? ""),
        last_content: String(row.last_content ?? ""),
        last_kind: String(row.last_kind ?? "text"),
        last_direction: String(row.last_direction ?? "inbound"),
        last_at: String(row.last_at ?? ""),
        connection_id: typeof row.connection_id === "string" ? row.connection_id : null,
        channel: typeof row.channel === "string" ? row.channel : null,
      })),
    };
  }

  if (rpcError) {
    console.warn("[api/client/conversas] inbox RPC unavailable, fallback scan", rpcError.message);
  }

  let messagesQuery = sb
    .from("whatsapp_messages")
    .select("remote_jid, content, kind, direction, created_at, connection_id, channel")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(2500);
  if (connectionId) messagesQuery = messagesQuery.eq("connection_id", connectionId);

  const { data, error } = await messagesQuery;
  if (error) throw error;

  const seen = new Map<string, InboxLastMessage>();
  for (const row of data ?? []) {
    const jid = String(row.remote_jid ?? "");
    if (!jid || seen.has(jid)) continue;
    seen.set(jid, {
      remote_jid: jid,
      last_content: String(row.content ?? ""),
      last_kind: String(row.kind ?? "text"),
      last_direction: String(row.direction ?? "inbound"),
      last_at: String(row.created_at ?? ""),
      connection_id: typeof row.connection_id === "string" ? row.connection_id : null,
      channel: typeof row.channel === "string" ? row.channel : null,
    });
  }
  return { via: "scan", rows: Array.from(seen.values()) };
}

export async function GET(request: Request) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const connectionId = new URL(request.url).searchParams.get("connectionId");

  const sb = createSupabaseServiceClient();

  let lastMessages: InboxLastMessage[];
  try {
    const loaded = await loadLastMessages(sb, session.tenantId, connectionId);
    lastMessages = loaded.rows;
  } catch (error) {
    console.error("[api/client/conversas] GET messages", error);
    return NextResponse.json({ error: "Erro ao carregar conversas." }, { status: 503 });
  }

  const [{ data: states }, { data: leads }] = await Promise.all([
    sb
      .from("conversation_states")
      .select(
        "remote_jid, lead_id, is_hidden, archived_at, conversation_mode, human_paused, handoff_suggested, paused_reason, assigned_human_name, agent_id",
      )
      .eq("tenant_id", session.tenantId)
      .eq("channel", "whatsapp"),
    sb
      .from("leads")
      .select("id, phone, name, status, crm_funnel_id, suggested_next_action")
      .eq("tenant_id", session.tenantId),
  ]);

  type LeadSummary = {
    id: string;
    name: string | null;
    status: string | null;
    crmFunnelId: string | null;
    suggestedNextAction: string | null;
  };
  const phoneToLead = new Map<string, LeadSummary>();
  const leadById = new Map<string, LeadSummary>();
  for (const row of leads ?? []) {
    const id = String(row.id ?? "");
    const name = typeof row.name === "string" ? row.name.trim() || null : null;
    const summary: LeadSummary = {
      id,
      name,
      status: typeof row.status === "string" ? row.status : null,
      crmFunnelId: typeof row.crm_funnel_id === "string" ? row.crm_funnel_id : null,
      suggestedNextAction:
        typeof row.suggested_next_action === "string" ? row.suggested_next_action : null,
    };
    leadById.set(id, summary);
    const phone = digitsOnly(String(row.phone ?? ""));
    if (phone) phoneToLead.set(phone, summary);
  }

  const hiddenJids = new Set(
    (states ?? [])
      .filter((row) =>
        !isConversationVisibleInInbox({
          isHidden: row.is_hidden === true,
          archivedAt: typeof row.archived_at === "string" ? row.archived_at : null,
        }),
      )
      .map((row) => String(row.remote_jid)),
  );

  const stateByJid = new Map(
    (states ?? []).map((row) => [String(row.remote_jid), row as Record<string, unknown>]),
  );

  const conversations = lastMessages
    .filter((row) => row.remote_jid && !hiddenJids.has(row.remote_jid))
    .map((row) => {
      const stateRow = stateByJid.get(row.remote_jid);
      const conversation_mode = deriveConversationMode({
        conversationMode: typeof stateRow?.conversation_mode === "string" ? stateRow.conversation_mode : null,
        humanPaused: stateRow?.human_paused === true,
        handoffSuggested: stateRow?.handoff_suggested === true,
        pausedReason: typeof stateRow?.paused_reason === "string" ? stateRow.paused_reason : null,
      });

      let leadId = typeof stateRow?.lead_id === "string" ? stateRow.lead_id : null;
      if (!leadId) {
        const phone = phoneFromRemoteJid(row.remote_jid);
        if (phone) leadId = phoneToLead.get(phone)?.id ?? null;
      }
      const leadRecord = leadId
        ? leadById.get(leadId) ?? phoneToLead.get(phoneFromRemoteJid(row.remote_jid) ?? "")
        : null;

      return {
        remoteJid: row.remote_jid,
        lastContent: row.last_content,
        lastKind: row.last_kind,
        lastDirection: row.last_direction,
        lastAt: row.last_at,
        connectionId: row.connection_id,
        channel: row.channel === "meta_cloud" ? "meta_cloud" : row.channel === "evolution" ? "evolution" : null,
        unreadCount: row.last_direction === "inbound" ? 1 : 0,
        conversation_mode,
        assigned_human_name:
          typeof stateRow?.assigned_human_name === "string" ? stateRow.assigned_human_name : null,
        agent_id: typeof stateRow?.agent_id === "string" ? stateRow.agent_id : null,
        handoff_suggested: stateRow?.handoff_suggested === true,
        lead_id: leadId,
        lead_name: leadRecord?.name ?? null,
        lead_status: leadRecord?.status ?? null,
        lead_crm_funnel_id: leadRecord?.crmFunnelId ?? null,
        lead_suggested_next_action: leadRecord?.suggestedNextAction ?? null,
      };
    })
    .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());

  return NextResponse.json({ conversations }, { headers: { "Cache-Control": "no-store" } });
}
