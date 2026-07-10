/**
 * POST /api/client/whatsapp-campaigns/audience-opt-in
 * Autoriza (opt-in WhatsApp) em massa todos os leads que baterem o público
 * escolhido e ainda não tiverem autorização — mesmas colunas e mesmo formato
 * que app/api/client/crm/leads/[id]/whatsapp-opt-in/route.ts (intocada) já
 * grava, só que pra vários leads de uma vez em vez de um por um. Não mexe em
 * nenhum arquivo do CRM.
 */
import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { leadMatchesWhatsAppCampaignAudience } from "@/lib/server/whatsapp-campaigns";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as { audienceType?: unknown; audienceValue?: unknown };
  const audienceType =
    body.audienceType === "tag" || body.audienceType === "funnel_stage" ? body.audienceType : "all";
  const audienceValue = typeof body.audienceValue === "string" ? body.audienceValue.trim() || null : null;

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("leads")
    .select("id, status, profile_metadata, whatsapp_opt_in, whatsapp_opt_out_at")
    .eq("tenant_id", guard.session.tenantId)
    .not("phone", "is", null)
    .limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 503 });

  const notOptedIn = (data ?? [])
    .filter((lead) => leadMatchesWhatsAppCampaignAudience(lead as Record<string, unknown>, audienceType, audienceValue))
    .filter((lead) => lead.whatsapp_opt_in !== true || lead.whatsapp_opt_out_at)
    .map((lead) => lead.id);

  if (notOptedIn.length === 0) {
    return NextResponse.json({ ok: true, optedInCount: 0 });
  }

  const now = new Date().toISOString();
  const { error: updateError } = await sb
    .from("leads")
    .update({
      whatsapp_opt_in: true,
      whatsapp_opt_in_at: now,
      whatsapp_opt_in_source: "disparos_bulk_opt_in",
      whatsapp_opt_out_at: null,
      updated_at: now,
    })
    .eq("tenant_id", guard.session.tenantId)
    .in("id", notOptedIn);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 503 });

  return NextResponse.json({ ok: true, optedInCount: notOptedIn.length });
}
