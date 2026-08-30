import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { resolveOrganizationRole } from "@/lib/organization-role";
import { deleteExternalApiConnector, saveExternalApiConnector } from "@/lib/server/external-api-connectors";
import type { ExternalApiConnectorInput } from "@/lib/external-api/types";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

async function ownerGuard() {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard;
  return resolveOrganizationRole(guard.session) === "owner" ? guard : { ok: false as const, response: NextResponse.json({ error: "Apenas o titular pode alterar APIs." }, { status: 403 }) };
}

export async function PATCH(request: Request, context: Context) {
  const guard = await ownerGuard();
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  const input = await request.json().catch(() => null) as ExternalApiConnectorInput | null;
  if (!input) return NextResponse.json({ error: "Configuração inválida." }, { status: 400 });
  try {
    await saveExternalApiConnector({ tenantId: guard.session.tenantId, connectorId: id, actorId: guard.session.email, input });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: "Não foi possível atualizar a API.", code: error instanceof Error ? error.message : "unknown" }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: Context) {
  const guard = await ownerGuard();
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  await deleteExternalApiConnector(guard.session.tenantId, id, guard.session.email);
  return NextResponse.json({ ok: true });
}
