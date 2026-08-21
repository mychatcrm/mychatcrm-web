import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  CAMPAIGN_ACTIVE_LIMIT,
  createWhatsAppCampaign,
  processDueWhatsAppCampaigns,
} from "@/lib/server/whatsapp-campaigns";
import { listTenantWhatsappConnections } from "@/lib/server/tenant-whatsapp-connections";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const sb = createSupabaseServiceClient();
  const [campaigns, connections, agents, eligible] = await Promise.all([
    sb
      .from("whatsapp_campaigns")
      .select("*")
      .eq("tenant_id", guard.session.tenantId)
      // Ordem escolhida a dedo primeiro; quem nunca foi arrastado
      // (display_order NULL) vem depois, do mais recente pro mais antigo.
      .order("display_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(100),
    listTenantWhatsappConnections(guard.session.tenantId),
    // O disparo só conduz com agentes já criados em Meus Agentes — sem
    // categoria própria, sem criar por aqui. Evita o cliente acumulando
    // agentes isolados só pra usar uma vez numa campanha.
    sb
      .from("tenant_agents")
      .select("agent_id, display_name, active")
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

  const firstError = campaigns.error ?? agents.error ?? eligible.error;
  if (firstError) {
    return NextResponse.json({ error: firstError.message }, { status: 503 });
  }

  return NextResponse.json(
    {
      campaigns: campaigns.data ?? [],
      connections,
      agents: agents.data ?? [],
      eligibleRecipients: eligible.count ?? 0,
      activeCampaignLimit: CAMPAIGN_ACTIVE_LIMIT,
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
    const sb = createSupabaseServiceClient();
    const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";

    const throughput =
      body.throughput === "suave" || body.throughput === "acelerado" ? body.throughput : "normal";

    const campaign = await createWhatsAppCampaign({
      sb,
      tenantId: guard.session.tenantId,
      createdBy: guard.session.email,
      input: {
        name: typeof body.name === "string" ? body.name : "",
        connectionId: typeof body.connectionId === "string" ? body.connectionId : "",
        agentId,
        // Cru de propósito: quem valida é parseCampaignAudienceBlocks, dentro
        // de createWhatsAppCampaign — mesmo padrão do sendWindow logo abaixo.
        audienceBlocks: body.audienceBlocks,
        messageTemplate: typeof body.messageTemplate === "string" ? body.messageTemplate : "",
        metaTemplateName: typeof body.metaTemplateName === "string" ? body.metaTemplateName : null,
        metaTemplateLang: typeof body.metaTemplateLang === "string" ? body.metaTemplateLang : null,
        throughput,
        scheduledAt: typeof body.scheduledAt === "string" ? body.scheduledAt : null,
        // Cru de propósito: quem valida e normaliza é parseCampaignSendWindow,
        // um lugar só, usado tanto na gravação quanto na leitura do processador.
        sendWindow: body.sendWindow,
        // Cru de propósito: quem valida é parseCampaignLeadDestination, dentro
        // de createWhatsAppCampaign — mesmo padrão do sendWindow acima.
        leadDestination: body.leadDestination,
        continueWithAgent: body.continueWithAgent !== false,
      },
    });

    // Dispara a primeira leva de envio já na criação — não espera o cron diário.
    let firstBatch: Awaited<ReturnType<typeof processDueWhatsAppCampaigns>> | null = null;
    try {
      firstBatch = await processDueWhatsAppCampaigns(sb, { campaignId: String(campaign.id) });
    } catch (processError) {
      console.warn("[whatsapp-campaigns] initial_process_failed", {
        campaign_id: campaign.id,
        error: processError instanceof Error ? processError.message : String(processError),
      });
    }

    return NextResponse.json({ ok: true, campaign, firstBatch }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "campaign_create_failed";
    const messages: Record<string, string> = {
      omnichannel_journeys_disabled: "Campanhas omnichannel ainda não foram ativadas.",
      campaign_required_fields: "Preencha nome, conexão, agente e mensagem.",
      campaign_audience_required: "Adicione pelo menos um público — CRM, lista importada ou contato digitado.",
      campaign_message_too_long: "A mensagem ultrapassa 4.000 caracteres.",
      campaign_connection_not_available: "Selecione um WhatsApp conectado.",
      campaign_agent_not_available: "O agente selecionado não está ativo.",
      campaign_meta_template_required: "Escolha um modelo (template) aprovado pela Meta pra essa linha.",
      campaign_meta_template_not_approved: "Esse modelo ainda não está aprovado pela Meta — escolha outro ou aguarde a aprovação.",
      campaign_has_no_opted_in_recipients:
        "Nenhum lead deste público possui opt-in WhatsApp ativo.",
      campaign_owner_employee_invalid: "O vendedor escolhido não existe mais ou está inativo. Selecione outro.",
      campaign_active_limit_reached: `Limite de ${CAMPAIGN_ACTIVE_LIMIT} disparos ativos ao mesmo tempo atingido. Aguarde um terminar ou cancele algum antes de criar outro.`,
    };
    return NextResponse.json({ error: messages[code] ?? "Não foi possível criar a campanha.", code }, { status: 422 });
  }
}
