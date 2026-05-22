import { NextRequest, NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { MetaLeadEventRow } from "@/lib/server/meta-lead-events-db";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(limitParam)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(limitParam)))
    : DEFAULT_LIMIT;

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("meta_lead_events")
    .select(
      "id, tenant_id, leadgen_id, page_id, form_id, ad_id, lead_id, name, phone, email, form_name, page_name, campaign_name, adset_name, ad_name, agent_id, agent_resolution_source, crm_sync_status, whatsapp_status, current_step, steps_log, form_fields, error_message, created_at, updated_at",
    )
    .eq("tenant_id", session.tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    const missing = error.code === "PGRST205" || error.code === "42P01";
    if (missing) {
      return NextResponse.json({ events: [] as MetaLeadEventRow[], tableReady: false });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    events: (data ?? []) as MetaLeadEventRow[],
    tableReady: true,
  });
}
