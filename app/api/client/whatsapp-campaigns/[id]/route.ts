import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  const sb = createSupabaseServiceClient();
  const now = new Date().toISOString();
  const { data, error } = await sb
    .from("whatsapp_campaigns")
    .update({ status: "cancelled", cancelled_at: now, updated_at: now })
    .eq("tenant_id", guard.session.tenantId)
    .eq("id", id)
    .in("status", ["draft", "scheduled", "processing"])
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 503 });
  if (!data) return NextResponse.json({ error: "Campanha não encontrada ou já finalizada." }, { status: 404 });
  await sb
    .from("whatsapp_campaign_recipients")
    .update({ status: "cancelled", updated_at: now })
    .eq("tenant_id", guard.session.tenantId)
    .eq("campaign_id", id)
    .in("status", ["pending", "processing", "failed"]);
  return NextResponse.json({ ok: true });
}
