import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { createWhatsAppCampaign } from "@/lib/server/whatsapp-campaigns";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const sb = createSupabaseServiceClient();
  const [campaigns, connections, agents, eligible] = await Promise.all([
    sb
      .from("whatsapp_campaigns")
      .select("*")
      .eq("tenant_id", guard.session.tenantId)
      .order("created_at", { ascending: false })
      .limit(100),
    sb
      .from("tenant_evolution_instances")
      .select("id, slot_index, instance_name, connection_state, wa_jid")
      .eq("tenant_id", guard.session.tenantId)
      .eq("connection_state", "open")
      .order("slot_index", { ascending: true }),
    sb
      .from("tenant_agents")
      .select("agent_id, display_name, active, metadata")
      .eq("tenant_id", guard.session.tenantId)
      .eq("active", true)
      .order("display_name", { ascending: true }),
    sb
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", guard.session.tenantId)
      .eq("whatsapp_opt_in", true)
      .is("whatsapp_opt_out_at", null),
  ]);

  const firstError = campaigns.error ?? connections.error ?? agents.error ?? eligible.error;
  if (firstError) {
    return NextResponse.json({ error: firstError.message }, { status: 503 });
  }
  return NextResponse.json(
    {
      campaigns: campaigns.data ?? [],
      connections: connections.data ?? [],
      agents: agents.data ?? [],
      eligibleRecipients: eligible.count ?? 0,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  try {
    const campaign = await createWhatsAppCampaign({
      sb: createSupabaseServiceClient(),
      tenantId: guard.session.tenantId,
      createdBy: guard.session.email,
      input: {
        name: typeof body.name === "string" ? body.name : "",
        connectionId: typeof body.connectionId === "string" ? body.connectionId : "",
        agentId: typeof body.agentId === "string" && body.agentId ? body.agentId : null,
        audienceType:
          body.audienceType === "tag" || body.audienceType === "funnel_stage"
            ? body.audienceType
            : "all",
        audienceValue: typeof body.audienceValue === "string" ? body.audienceValue : null,
        messageTemplate: typeof body.messageTemplate === "string" ? body.messageTemplate : "",
        scheduledAt: typeof body.scheduledAt === "string" ? body.scheduledAt : null,
      },
    });
    return NextResponse.json({ ok: true, campaign }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "campaign_create_failed";
    const messages: Record<string, string> = {
      omnichannel_journeys_disabled: "Campanhas omnichannel ainda não foram ativadas.",
      campaign_required_fields: "Preencha nome, conexão e mensagem.",
      campaign_message_too_long: "A mensagem ultrapassa 4.000 caracteres.",
      campaign_connection_not_available: "Selecione um WhatsApp conectado.",
      campaign_agent_not_available: "O agente selecionado não está ativo.",
      campaign_has_no_opted_in_recipients:
        "Nenhum lead deste público possui opt-in WhatsApp ativo.",
    };
    return NextResponse.json({ error: messages[code] ?? "Não foi possível criar a campanha.", code }, { status: 422 });
  }
}
