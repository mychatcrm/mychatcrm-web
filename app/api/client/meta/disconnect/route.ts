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

  // Remove dependent mappings first, then the actual page connections for this tenant.
  const mappingResult = await sb.from("meta_form_agent_mapping").delete().eq("tenant_id", session.tenantId);
  if (mappingResult.error) {
    return NextResponse.json({ error: mappingResult.error.message }, { status: 500 });
  }

  const connResult = await sb.from("meta_connections").delete().eq("tenant_id", session.tenantId).select("page_id");
  if (connResult.error) {
    return NextResponse.json({ error: connResult.error.message }, { status: 500 });
  }

  const { count: remainingConnections, error: verifyError } = await sb
    .from("meta_connections")
    .select("page_id", { count: "exact", head: true })
    .eq("tenant_id", session.tenantId);

  if (verifyError) {
    return NextResponse.json({ error: verifyError.message }, { status: 500 });
  }

  if ((remainingConnections ?? 0) > 0) {
    return NextResponse.json({ error: "Meta connections could not be fully disconnected." }, { status: 500 });
  }

  console.info("[meta-disconnect]", {
    tenant_id: session.tenantId,
    deleted_connections: connResult.data?.length ?? 0,
    remaining_connections: remainingConnections ?? 0,
  });

  return NextResponse.json({
    ok: true,
    deleted_connections: connResult.data?.length ?? 0,
    remaining_connections: remainingConnections ?? 0,
  });
}
