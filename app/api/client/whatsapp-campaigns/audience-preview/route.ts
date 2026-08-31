/**
 * POST /api/client/whatsapp-campaigns/audience-preview
 * Contagem real de quantos leads o bloco de público bate e quantos já têm
 * opt-in WhatsApp ativo. É POST (não GET) porque o bloco carrega escopo
 * (listas de funis/colunas) + período, que não cabem bem em query string.
 */
import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  CAMPAIGN_AUDIENCE_LEAD_COLUMNS,
  leadMatchesCrmAudienceBlock,
  parseCrmPeriod,
  parseCrmScope,
} from "@/lib/server/whatsapp-campaigns";
import { normalizeIanaTimezone } from "@/lib/agents/agent-datetime";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as {
    scope?: unknown;
    period?: unknown;
    timezone?: unknown;
  };
  const timezone = normalizeIanaTimezone(body.timezone);
  if (!timezone) {
    return NextResponse.json(
      { error: "Defina um fuso horário IANA válido para visualizar este público.", code: "campaign_timezone_required" },
      { status: 422 },
    );
  }
  const block = { scope: parseCrmScope(body.scope), period: parseCrmPeriod(body.period) };

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("leads")
    .select(`${CAMPAIGN_AUDIENCE_LEAD_COLUMNS}, whatsapp_opt_in, whatsapp_opt_out_at`)
    .eq("tenant_id", guard.session.tenantId)
    .not("phone", "is", null)
    .limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 503 });

  const matched = (data ?? []).filter((lead) =>
    leadMatchesCrmAudienceBlock(lead as Record<string, unknown>, block, timezone),
  );
  const optedIn = matched.filter((lead) => lead.whatsapp_opt_in === true && !lead.whatsapp_opt_out_at).length;

  return NextResponse.json(
    { totalMatched: matched.length, optedIn, notOptedIn: matched.length - optedIn },
    { headers: { "Cache-Control": "no-store" } },
  );
}
