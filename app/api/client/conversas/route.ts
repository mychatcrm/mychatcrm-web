/**
 * GET /api/client/conversas
 * Lista todos os remote_jid únicos do tenant com última mensagem e timestamp.
 * Retorna conversas ordenadas por data da última mensagem (desc).
 */
import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isConversationVisibleInInbox } from "@/lib/server/conversation-visibility";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const sb = createSupabaseServiceClient();

  const [{ data, error }, { data: states }] = await Promise.all([
    sb
      .from("whatsapp_messages")
      .select("remote_jid, content, kind, direction, created_at")
      .eq("tenant_id", session.tenantId)
      .order("created_at", { ascending: false }),
    sb
      .from("conversation_states")
      .select("remote_jid, is_hidden, archived_at")
      .eq("tenant_id", session.tenantId)
      .eq("channel", "whatsapp"),
  ]);

  if (error) {
    console.error("[api/client/conversas] GET", error.code, error.message);
    return NextResponse.json({ error: "Erro ao carregar conversas." }, { status: 503 });
  }

  // Agrupa por remote_jid — mantém só a mais recente por conversa
  const hiddenJids = new Set(
    (states ?? [])
      .filter((row) => !isConversationVisibleInInbox({
        isHidden: row.is_hidden === true,
        archivedAt: typeof row.archived_at === "string" ? row.archived_at : null,
      }))
      .map((row) => String(row.remote_jid)),
  );

  const seen = new Map<string, { remoteJid: string; lastContent: string; lastKind: string; lastDirection: string; lastAt: string; unreadCount: number }>();
  for (const row of data ?? []) {
    if (hiddenJids.has(row.remote_jid)) continue;
    if (!seen.has(row.remote_jid)) {
      seen.set(row.remote_jid, {
        remoteJid: row.remote_jid,
        lastContent: row.content,
        lastKind: row.kind,
        lastDirection: row.direction,
        lastAt: row.created_at,
        unreadCount: row.direction === "inbound" ? 1 : 0,
      });
    } else if (row.direction === "inbound") {
      const existing = seen.get(row.remote_jid)!;
      existing.unreadCount += 1;
    }
  }

  const conversations = Array.from(seen.values());

  return NextResponse.json({ conversations }, { headers: { "Cache-Control": "no-store" } });
}
