/**
 * POST /api/client/whatsapp-campaigns/reorder  { orderedIds }
 * Salva a ordem em que o cliente arrastou os cards na tela de Disparos.
 */
import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { reorderWhatsAppCampaigns } from "@/lib/server/whatsapp-campaigns";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as { orderedIds?: unknown };
  const orderedIds = Array.isArray(body.orderedIds)
    ? [...new Set(body.orderedIds.map((id) => String(id).trim()).filter(Boolean))]
    : [];
  if (orderedIds.length === 0) {
    return NextResponse.json({ error: "Nenhuma campanha informada." }, { status: 400 });
  }

  try {
    await reorderWhatsAppCampaigns({
      sb: createSupabaseServiceClient(),
      tenantId: guard.session.tenantId,
      orderedIds,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.warn("[whatsapp-campaigns] reorder_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Não foi possível salvar a ordem." }, { status: 503 });
  }
}
