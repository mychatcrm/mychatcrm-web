/**
 * POST /api/client/whatsapp-campaigns/[id]/control  { action }
 *
 * Play, pause e "começar do zero" — as três ações do card na tela de Disparos.
 * Uma rota só porque as três são a mesma coisa do ponto de vista de
 * autorização e formato; quem decide o que cada uma faz é
 * `controlWhatsAppCampaign`.
 *
 * O play também roda a primeira leva na hora, em vez de esperar a próxima
 * passada do cron: quem clicou em play espera ver o disparo começar.
 */
import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  controlWhatsAppCampaign,
  processDueWhatsAppCampaigns,
  type CampaignControlAction,
} from "@/lib/server/whatsapp-campaigns";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ACTIONS = new Set<CampaignControlAction>(["start", "pause", "reset"]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { action?: unknown };
  const action = body.action as CampaignControlAction | undefined;
  if (!action || !ACTIONS.has(action)) {
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  }

  try {
    const sb = createSupabaseServiceClient();
    const campaign = await controlWhatsAppCampaign({
      sb,
      tenantId: guard.session.tenantId,
      campaignId: id,
      action,
    });

    let firstBatch: Awaited<ReturnType<typeof processDueWhatsAppCampaigns>> | null = null;
    if (action === "start") {
      try {
        firstBatch = await processDueWhatsAppCampaigns(sb, { campaignId: id });
      } catch (processError) {
        // O play já valeu: a campanha está na fila e o cron pega na próxima
        // passada. Falhar aqui não pode desfazer isso.
        console.warn("[whatsapp-campaigns] start_first_batch_failed", {
          campaign_id: id,
          error: processError instanceof Error ? processError.message : String(processError),
        });
      }
    }

    return NextResponse.json({ ok: true, campaign, firstBatch });
  } catch (error) {
    const code = error instanceof Error ? error.message : "campaign_control_failed";
    const messages: Record<string, string> = {
      campaign_not_found: "Campanha não encontrada.",
      campaign_not_running: "Essa campanha não está enviando agora.",
      campaign_not_startable: "Só dá pra iniciar uma campanha parada ou pausada.",
      campaign_rule_not_authorized:
        "Esta campanha precisa de uma regra ativa que autorize exatamente o mesmo agente e a mesma conexão.",
      campaign_timezone_required:
        "Esta campanha precisa de um fuso horário IANA válido antes de ser iniciada. Edite o disparo e escolha o fuso.",
    };
    const known = messages[code];
    return NextResponse.json({ error: known ?? "Não foi possível executar a ação.", code }, { status: known ? 422 : 503 });
  }
}
