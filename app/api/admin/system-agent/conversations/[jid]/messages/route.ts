/**
 * GET /api/admin/system-agent/conversations/[jid]/messages
 * Últimas 80 mensagens de uma conversa do agente do sistema (read-only).
 * [jid] é URL-encoded (ex: 5562999999999%40s.whatsapp.net).
 */
import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { SYSTEM_TENANT_ID } from "@/lib/server/system-agent";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { jid: string } }) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "system-agent")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const remoteJid = decodeURIComponent(params.jid);
  if (!remoteJid) return NextResponse.json({ error: "jid em falta" }, { status: 400 });

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("whatsapp_messages")
    .select("id, direction, kind, content, media_url, agent_id, created_at, delivery_status")
    .eq("tenant_id", SYSTEM_TENANT_ID)
    .eq("remote_jid", remoteJid)
    .order("created_at", { ascending: false })
    .limit(80);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const messages = (data ?? []).reverse();
  return NextResponse.json({ messages }, { headers: { "Cache-Control": "no-store" } });
}
