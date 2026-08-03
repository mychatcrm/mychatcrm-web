import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { notifyTenantIntegrationDisconnected } from "@/lib/server/integration-disconnect-notifications";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type DisconnectedPage = { page_id?: string; page_name?: string | null };

/** Atomically tombstones OAuth and removes only this tenant's local Meta access. */
export async function DELETE(): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;
  const sb = createSupabaseServiceClient();

  const { data, error } = await sb.rpc("disconnect_meta_lead_tenant", {
    p_tenant_id: session.tenantId,
  });
  if (error || !Array.isArray(data)) {
    return NextResponse.json(
      { error: error?.message ?? "Meta connections could not be disconnected." },
      { status: 500 },
    );
  }

  const pages = data as DisconnectedPage[];
  await Promise.allSettled(
    pages.map((page) =>
      notifyTenantIntegrationDisconnected({
        tenantId: session.tenantId,
        integration: "facebook",
        source: "meta_manual_disconnect",
        sourceKey: String(page.page_id ?? "unknown"),
        pageId: String(page.page_id ?? ""),
        pageName: page.page_name ?? null,
        state: "deleted",
        manual: true,
        metadata: {
          provider_grant_revoked: false,
          reason: "local_tenant_disconnect",
        },
      }),
    ),
  );

  console.info("[meta-disconnect]", {
    tenant_id: session.tenantId,
    deleted_connections: pages.length,
    provider_grant_revoked: false,
  });
  return NextResponse.json({
    ok: true,
    deleted_connections: pages.length,
    remaining_connections: 0,
    provider_grant_revoked: false,
  });
}
