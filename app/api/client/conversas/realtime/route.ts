import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { filterConversationsInScope, resolveAccessScope } from "@/lib/server/access-scope";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET() {
  const session = await getClientSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401, headers: NO_STORE_HEADERS });
  }

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb.rpc("get_or_create_inbox_realtime_topic", {
    p_tenant_id: session.tenantId,
  });
  if (error || typeof data !== "string" || !data.startsWith("inbox:")) {
    console.error("[api/client/conversas/realtime] topic", {
      tenant_id: session.tenantId,
      reason: error?.message ?? "invalid_topic",
    });
    return NextResponse.json(
      { error: "Canal em tempo real indisponível." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json({ topic: data }, { headers: NO_STORE_HEADERS });
}

export async function POST(request: Request) {
  const session = await getClientSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401, headers: NO_STORE_HEADERS });
  }

  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids)
    ? Array.from(
        new Set(
          body.ids
            .filter((id): id is string => typeof id === "string" && UUID_RE.test(id))
            .slice(0, 50),
        ),
      )
    : [];
  if (!ids.length) {
    return NextResponse.json({ messages: [] }, { headers: NO_STORE_HEADERS });
  }

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("whatsapp_messages")
    .select(
      "id,tenant_id,remote_jid,lead_id,connection_id,channel,direction,kind,content,media_url,agent_id,created_at,received_at,client_temp_id,delivery_status",
    )
    .eq("tenant_id", session.tenantId)
    .in("id", ids);

  if (error) {
    console.error("[api/client/conversas/realtime] hydrate", {
      tenant_id: session.tenantId,
      count: ids.length,
      reason: error.message,
    });
    return NextResponse.json(
      { error: "Falha ao atualizar mensagens." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  // O tópico de broadcast é por conta, então chegam aqui ids de conversas que
  // quem pediu talvez não possa ver — e esta rota devolve o CONTEÚDO das
  // mensagens. Sem este recorte, um vendedor leria em tempo real a conversa de
  // qualquer colega. Id fora do alcance simplesmente não volta.
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const scope = await resolveAccessScope(sb, session);
  if (scope.kind === "all") {
    return NextResponse.json({ messages: rows }, { headers: NO_STORE_HEADERS });
  }

  const jids = Array.from(new Set(rows.map((row) => String(row.remote_jid ?? "")).filter(Boolean)));
  const allowedJids = new Set(await filterConversationsInScope(sb, session.tenantId, jids, scope));

  return NextResponse.json(
    { messages: rows.filter((row) => allowedJids.has(String(row.remote_jid ?? ""))) },
    { headers: NO_STORE_HEADERS },
  );
}
