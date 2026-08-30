import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { resolveOrganizationRole } from "@/lib/organization-role";
import { syncExternalApiConnectorCatalog } from "@/lib/server/external-api-catalog-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  if (resolveOrganizationRole(guard.session) !== "owner") {
    return NextResponse.json({ error: "Apenas o titular pode sincronizar APIs." }, { status: 403 });
  }
  const { id } = await params;
  const result = await syncExternalApiConnectorCatalog({ tenantId: guard.session.tenantId, connectorId: id });
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
