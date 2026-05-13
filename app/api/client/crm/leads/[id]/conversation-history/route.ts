import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function normalizePhone(value: unknown): string {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const leadId = params.id;
  if (!leadId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  const sb = createSupabaseServiceClient();
  const { data: lead, error: leadError } = await sb
    .from("leads")
    .select("id, phone")
    .eq("tenant_id", session.tenantId)
    .eq("id", leadId)
    .maybeSingle();

  if (leadError) {
    console.error("[api/client/crm/leads/history] lead", leadError.code, leadError.message);
    return NextResponse.json({ error: "Erro ao carregar lead." }, { status: 503 });
  }
  if (!lead) return NextResponse.json({ error: "Lead não encontrado." }, { status: 404 });

  const phone = normalizePhone((lead as { phone?: unknown }).phone);
  if (!phone) {
    return NextResponse.json({ messages: [], summary: null }, { headers: { "Cache-Control": "no-store" } });
  }

  const [{ data: messages, error: messagesError }, { data: summaries, error: summaryError }] = await Promise.all([
    sb
      .from("whatsapp_messages")
      .select("id, remote_jid, direction, kind, content, media_url, agent_id, created_at")
      .eq("tenant_id", session.tenantId)
      .ilike("remote_jid", `${phone}%`)
      .order("created_at", { ascending: true })
      .limit(120),
    sb
      .from("conversation_summaries")
      .select("summary, customer_intent, lead_temperature, suggested_next_action, objections, important_facts, created_at")
      .eq("tenant_id", session.tenantId)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  if (messagesError) {
    console.error("[api/client/crm/leads/history] messages", messagesError.code, messagesError.message);
    return NextResponse.json({ error: "Erro ao carregar histórico." }, { status: 503 });
  }
  if (summaryError) {
    console.warn("[api/client/crm/leads/history] summary", summaryError.code, summaryError.message);
  }

  return NextResponse.json(
    {
      messages: messages ?? [],
      summary: summaryError ? null : (summaries?.[0] ?? null),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
