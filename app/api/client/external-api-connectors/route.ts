import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { resolveOrganizationRole } from "@/lib/organization-role";
import { listExternalApiConnectors, saveExternalApiConnector } from "@/lib/server/external-api-connectors";
import type { ExternalApiConnectorInput } from "@/lib/external-api/types";

export const dynamic = "force-dynamic";
const ownerOnly = (session: Parameters<typeof resolveOrganizationRole>[0]) => resolveOrganizationRole(session) === "owner";

export async function GET() {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  try {
    const result = await listExternalApiConnectors(guard.session.tenantId);
    return NextResponse.json({ ...result, canManage: ownerOnly(guard.session), extraMonthlyCents: 4990 }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[external-api-connectors] GET", error);
    return NextResponse.json({ error: "Não foi possível carregar as APIs externas." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  if (!ownerOnly(guard.session)) return NextResponse.json({ error: "Apenas o titular pode cadastrar APIs." }, { status: 403 });
  const input = await request.json().catch(() => null) as ExternalApiConnectorInput | null;
  if (!input) return NextResponse.json({ error: "Configuração inválida." }, { status: 400 });
  try {
    const id = await saveExternalApiConnector({ tenantId: guard.session.tenantId, input });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (error) {
    console.error("[external-api-connectors] POST", error);
    return NextResponse.json({ error: "Não foi possível salvar a API externa.", code: error instanceof Error ? error.message : "unknown" }, { status: 400 });
  }
}
