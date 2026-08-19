/**
 * GET /api/client/whatsapp-campaigns/audience-preview?type=&value=
 * Contagem real de quantos leads o público bate e quantos já têm opt-in
 * WhatsApp ativo — substitui os números fixos (~12,4k etc.) que a tela de
 * Disparos mostrava antes.
 */
import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { leadMatchesWhatsAppCampaignAudience, type CampaignAudienceCrmFilter } from "@/lib/server/whatsapp-campaigns";

export const dynamic = "force-dynamic";

const CRM_FILTER_TYPES = new Set<CampaignAudienceCrmFilter>([
  "tag",
  "funnel_stage",
  "cadastro_dias",
  "cadastro_data",
]);

export async function GET(request: Request) {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;

  const params = new URL(request.url).searchParams;
  const rawType = params.get("type") as CampaignAudienceCrmFilter | null;
  const audienceType: CampaignAudienceCrmFilter = rawType && CRM_FILTER_TYPES.has(rawType) ? rawType : "all";
  const audienceValue = params.get("value")?.trim() || null;

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("leads")
    .select("id, status, profile_metadata, whatsapp_opt_in, whatsapp_opt_out_at, created_at")
    .eq("tenant_id", guard.session.tenantId)
    .not("phone", "is", null)
    .limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 503 });

  const matched = (data ?? []).filter((lead) =>
    leadMatchesWhatsAppCampaignAudience(lead as Record<string, unknown>, audienceType, audienceValue),
  );
  const optedIn = matched.filter((lead) => lead.whatsapp_opt_in === true && !lead.whatsapp_opt_out_at).length;

  return NextResponse.json(
    { totalMatched: matched.length, optedIn, notOptedIn: matched.length - optedIn },
    { headers: { "Cache-Control": "no-store" } },
  );
}
