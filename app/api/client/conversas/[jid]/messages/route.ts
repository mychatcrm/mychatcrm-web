/**
 * GET /api/client/conversas/[jid]/messages
 * Retorna as últimas 50 mensagens de um remote_jid específico do tenant.
 * [jid] é URL-encoded (ex: 5562999999999%40s.whatsapp.net)
 */
import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { hideConversationsForTenant } from "@/lib/server/conversation-visibility";
import { getConversationState } from "@/lib/server/conversation-memory";
import { isConversationAutomationEnabled } from "@/lib/server/conversation-human-control";

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

  const { data, error } = await sb
    .from("whatsapp_messages")
    .select("id, direction, kind, content, media_url, agent_id, message_id, created_at")
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

  const state = await getConversationState({
    sb,
    tenantId: session.tenantId,
    remoteJid,
  });

  return NextResponse.json(
    {
      messages,
      automation: {
        enabled: isConversationAutomationEnabled(state),
        human_paused: state?.humanPaused ?? false,
        paused_by: state?.pausedBy ?? null,
        paused_reason: state?.pausedReason ?? null,
      },
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
