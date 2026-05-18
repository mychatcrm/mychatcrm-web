import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Disconnects all Meta pages for the authenticated tenant. */
export async function DELETE(): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const sb = createSupabaseServiceClient();

  // Remove all connections and form mappings for this tenant
  const [connResult, mappingResult] = await Promise.all([
    sb.from("meta_connections").delete().eq("tenant_id", session.tenantId),
    sb.from("meta_form_agent_mapping").delete().eq("tenant_id", session.tenantId),
  ]);

  if (connResult.error) {
    return NextResponse.json({ error: connResult.error.message }, { status: 500 });
  }
  if (mappingResult.error) {
    return NextResponse.json({ error: mappingResult.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
