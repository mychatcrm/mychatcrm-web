import { NextRequest, NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Remove um evento da inbox meta_lead_events (não remove o lead do CRM). */
export async function DELETE(_req: NextRequest, context: RouteContext): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const { id } = await context.params;
  const eventId = id?.trim();
  if (!eventId) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const sb = createSupabaseServiceClient();
  const { data: row, error: selectErr } = await sb
    .from("meta_lead_events")
    .select("id, tenant_id, leadgen_id")
    .eq("id", eventId)
    .eq("tenant_id", session.tenantId)
    .maybeSingle();

  if (selectErr) {
    const missing = selectErr.code === "PGRST205" || selectErr.code === "42P01";
    if (missing) return NextResponse.json({ error: "Inbox não disponível" }, { status: 503 });
    return NextResponse.json({ error: selectErr.message }, { status: 500 });
  }

  if (!row?.id) {
    return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
  }

  const { error: deleteErr } = await sb
    .from("meta_lead_events")
    .delete()
    .eq("id", eventId)
    .eq("tenant_id", session.tenantId);

  if (deleteErr) {
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });
  }

  console.info("[meta-lead-events] inbox_removed", {
    tenant_id: session.tenantId,
    event_id: eventId,
    leadgen_id: row.leadgen_id ?? null,
  });

  return NextResponse.json({ ok: true, id: eventId });
}
