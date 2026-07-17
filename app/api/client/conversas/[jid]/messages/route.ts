/**
 * GET /api/client/conversas/[jid]/messages
 * Retorna as últimas 50 mensagens de um remote_jid específico do tenant.
 * [jid] é URL-encoded (ex: 5562999999999%40s.whatsapp.net)
 */
import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { hideConversationsForTenant } from "@/lib/server/conversation-visibility";
import {
  loadStateOperationRow,
  operationFromStateRow,
} from "@/lib/server/conversation-operation";
import { reconcilePendingEvolutionDeliveries } from "@/lib/server/evolution-customer-delivery";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { jid: string } },
) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const remoteJid = decodeURIComponent(params.jid);
  if (!remoteJid) return NextResponse.json({ error: "jid em falta" }, { status: 400 });

  const sb = createSupabaseServiceClient();

  // Reconciliação de delivery não pode atrasar o histórico — status chega
  // depois via Realtime UPDATE ou poll do painel.
  void reconcilePendingEvolutionDeliveries({
    sb,
    tenantId: session.tenantId,
    remoteJid,
  }).catch((reconcileError) => {
    console.warn("[api/client/conversas/jid/messages] delivery reconciliation", reconcileError);
  });

  const { data, error } = await sb
    .from("whatsapp_messages")
    .select("id, direction, kind, content, media_url, agent_id, message_id, created_at, client_temp_id, delivery_status")
    .eq("tenant_id", session.tenantId)
    .eq("remote_jid", remoteJid)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[api/client/conversas/jid/messages] GET", error.code, error.message);
    return NextResponse.json({ error: "Erro ao carregar mensagens." }, { status: 503 });
  }

  // Retorna em ordem cronológica (mais antigas primeiro)
  const messages = (data ?? []).reverse();

  const stateRow = await loadStateOperationRow({
    sb,
    tenantId: session.tenantId,
    remoteJid,
  });
  const operation = operationFromStateRow(stateRow);

  return NextResponse.json(
    {
      messages,
      automation: {
        enabled: operation.conversation_mode === "automation",
        human_paused: operation.human_paused,
        paused_by: stateRow && typeof stateRow.paused_by === "string" ? stateRow.paused_by : null,
        paused_reason: operation.paused_reason,
        conversation_mode: operation.conversation_mode,
        can_human_send: operation.can_human_send,
        assigned_human_name: operation.assigned_human_name,
        agent_id: operation.agent_id,
        handoff_suggested: operation.handoff_suggested,
      },
      operation,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE(
  _request: Request,
  { params }: { params: { jid: string } },
) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const remoteJid = decodeURIComponent(params.jid);
  if (!remoteJid) return NextResponse.json({ error: "jid em falta" }, { status: 400 });

  const sb = createSupabaseServiceClient();
  const count = await hideConversationsForTenant({
    sb,
    tenantId: session.tenantId,
    remoteJids: [remoteJid],
    archive: true,
    hiddenBy: "conversas_panel",
  });

  return NextResponse.json({ ok: true, hidden: count > 0 });
}
