import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { data, error } = await createSupabaseServiceClient()
    .from("tenant_evolution_instances")
    .select("id, slot_index, instance_name, connection_state, wa_jid")
    .eq("tenant_id", guard.session.tenantId)
    .order("slot_index", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 503 });
  return NextResponse.json({ connections: data ?? [] });
}
