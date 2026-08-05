import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { resolveOrganizationRole } from "@/lib/organization-role";
import { listExternalApiConnectors } from "@/lib/server/external-api-connectors";
import { executeAgentExternalApiLookup } from "@/lib/server/external-api-executor";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  if (resolveOrganizationRole(guard.session) !== "owner") return NextResponse.json({ error: "Apenas o titular pode testar APIs." }, { status: 403 });
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as { operationKey?: string; arguments?: Array<{ name: string; value: string }> };
  const connector = (await listExternalApiConnectors(guard.session.tenantId)).connectors.find((item) => item.id === id);
  const operationKey = body.operationKey || connector?.operations.find((operation) => operation.enabled)?.operationKey;
  if (!connector || !operationKey) return NextResponse.json({ error: "Conector ou operação não encontrado." }, { status: 404 });
  const result = await executeAgentExternalApiLookup({ tenantId: guard.session.tenantId, agentId: null,
    request: { connectorId: id, operationKey, arguments: body.arguments ?? [] }, skipAgentAuthorization: true });
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
