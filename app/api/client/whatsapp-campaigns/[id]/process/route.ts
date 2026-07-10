/**
 * POST /api/client/whatsapp-campaigns/[id]/process
 * Roda uma passada de envio agora pra essa campanha, sem esperar o cron
 * diário — usado pelo botão "Enviar próximo lote agora" no histórico.
 */
import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { processDueWhatsAppCampaigns } from "@/lib/server/whatsapp-campaigns";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const campaignId = id?.trim();
  if (!campaignId) return NextResponse.json({ error: "id é obrigatório" }, { status: 400 });

  const sb = createSupabaseServiceClient();
  const { data: campaign } = await sb
    .from("whatsapp_campaigns")
    .select("id")
    .eq("tenant_id", guard.session.tenantId)
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign) return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });

  const result = await processDueWhatsAppCampaigns(sb, { campaignId });
  return NextResponse.json({ ok: true, ...result });
}
