/**
 * GET /api/admin/system-agent/conversations
 * Lista as conversas do agente do sistema (tenant interno), agrupadas por remote_jid,
 * com a última mensagem de cada uma. Read-only — para monitoramento no /admin/system-agent.
 */
import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { SYSTEM_TENANT_ID } from "@/lib/server/system-agent";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Row = {
  remote_jid: string;
  direction: string;
  kind: string;
  content: string;
  agent_id: string | null;
  created_at: string;
};

export async function GET() {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "system-agent")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const sb = createSupabaseServiceClient();
  // Puxa as mensagens recentes do tenant do sistema e agrupa por remote_jid no app.
  const { data, error } = await sb
    .from("whatsapp_messages")
    .select("remote_jid, direction, kind, content, agent_id, created_at")
    .eq("tenant_id", SYSTEM_TENANT_ID)
    .order("created_at", { ascending: false })
    .limit(400);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const byJid = new Map<
    string,
    { remoteJid: string; lastContent: string; lastKind: string; lastDirection: string; lastAt: string; count: number }
  >();
  for (const r of (data ?? []) as Row[]) {
    const existing = byJid.get(r.remote_jid);
    if (existing) {
      existing.count += 1;
      continue;
    }
    byJid.set(r.remote_jid, {
      remoteJid: r.remote_jid,
      lastContent: r.content ?? "",
      lastKind: r.kind ?? "text",
      lastDirection: r.direction ?? "inbound",
      lastAt: r.created_at,
      count: 1,
    });
  }

  const conversations = Array.from(byJid.values()).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  return NextResponse.json({ conversations }, { headers: { "Cache-Control": "no-store" } });
}
