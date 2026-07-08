/**
 * GET  /api/admin/system-agent/conversations  — lista conversas do agente do sistema.
 * DELETE /api/admin/system-agent/conversations?jid=<encoded>  — apaga uma conversa.
 * DELETE /api/admin/system-agent/conversations?all=true       — apaga todas.
 */
import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { SYSTEM_AGENT_ID, SYSTEM_TENANT_ID } from "@/lib/server/system-agent";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Row = {
  remote_jid: string;
  direction: string;
  kind: string;
  content: string;
  agent_id: string | null;
  created_at: string;
  channel: string | null;
};

async function authAdmin() {
  const session = await getAdminSessionFromCookies();
  if (!session) return null;
  if (!hasAdminAccess(session, "system-agent")) return null;
  return session;
}

/** Canal opcional (?channel=evolution|meta_cloud) para os 3 filtros do painel "Conversas ao vivo". */
function parseChannelFilter(url: URL): "evolution" | "meta_cloud" | null {
  const raw = url.searchParams.get("channel");
  return raw === "evolution" || raw === "meta_cloud" ? raw : null;
}

export async function GET(request: Request) {
  if (!(await authAdmin())) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });

  const channel = parseChannelFilter(new URL(request.url));

  const sb = createSupabaseServiceClient();
  let query = sb
    .from("whatsapp_messages")
    .select("remote_jid, direction, kind, content, agent_id, created_at, channel")
    .eq("tenant_id", SYSTEM_TENANT_ID)
    .eq("agent_id", SYSTEM_AGENT_ID)
    .order("created_at", { ascending: false })
    .limit(400);
  if (channel) query = query.eq("channel", channel);
  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byJid = new Map<
    string,
    {
      remoteJid: string;
      lastContent: string;
      lastKind: string;
      lastDirection: string;
      lastAt: string;
      count: number;
      channel: string | null;
    }
  >();
  for (const r of (data ?? []) as Row[]) {
    const existing = byJid.get(r.remote_jid);
    if (existing) {
      existing.count += 1;
      continue;
    }
    // Ordenado por created_at desc — a primeira ocorrência de cada jid é a mais
    // recente, então o canal dela representa o canal "atual" da conversa.
    byJid.set(r.remote_jid, {
      remoteJid: r.remote_jid,
      lastContent: r.content ?? "",
      lastKind: r.kind ?? "text",
      lastDirection: r.direction ?? "inbound",
      lastAt: r.created_at,
      count: 1,
      channel: r.channel ?? null,
    });
  }

  const conversations = Array.from(byJid.values()).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  return NextResponse.json({ conversations }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  if (!(await authAdmin())) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });

  const url = new URL(request.url);
  const jid = url.searchParams.get("jid");
  const all = url.searchParams.get("all") === "true";

  const sb = createSupabaseServiceClient();
  const base = sb
    .from("whatsapp_messages")
    .delete()
    .eq("tenant_id", SYSTEM_TENANT_ID)
    .eq("agent_id", SYSTEM_AGENT_ID);

  let q;
  if (all) {
    q = base;
  } else if (jid) {
    q = base.eq("remote_jid", decodeURIComponent(jid));
  } else {
    return NextResponse.json({ error: "Informe jid ou all=true." }, { status: 400 });
  }

  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
