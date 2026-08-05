import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { resolveOrganizationRole } from "@/lib/organization-role";
import { setExternalApiPrimary } from "@/lib/server/external-api-connectors";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  if (resolveOrganizationRole(guard.session) !== "owner") return NextResponse.json({ error: "Apenas o titular pode alterar APIs." }, { status: 403 });
  const { id } = await params;
  await setExternalApiPrimary(guard.session.tenantId, id);
  return NextResponse.json({ ok: true });
}
