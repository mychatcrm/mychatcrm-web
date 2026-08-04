/**
 * Liberação de funis por colaborador — exclusivo do titular da conta.
 *
 * GET — mapa `{ employeeId: funnelId[] }` do tenant, para a tela de gestão.
 * PUT — substitui a liberação de UM colaborador. Lista vazia remove a
 *       restrição (volta ao comportamento padrão: todos os leads dele, em
 *       qualquer funil).
 */
import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { resolveOrganizationRole } from "@/lib/organization-role";
import { readTeamMembersFromDb } from "@/lib/server/team-employees-db";
import { listCrmFunnelsFromDb } from "@/lib/server/crm-funnels-db";
import {
  listFunnelAccessForTenant,
  replaceFunnelAccessForEmployee,
} from "@/lib/server/crm-funnel-access-db";

export const dynamic = "force-dynamic";

function ownerOnly(session: Parameters<typeof resolveOrganizationRole>[0]) {
  if (resolveOrganizationRole(session) === "owner") return null;
  return NextResponse.json(
    { error: "Apenas o titular da conta pode liberar funis." },
    { status: 403 },
  );
}

export async function GET() {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const denied = ownerOnly(guard.session);
  if (denied) return denied;

  const access = await listFunnelAccessForTenant(guard.session.tenantId);
  return NextResponse.json({ access }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const denied = ownerOnly(guard.session);
  if (denied) return denied;
  const { session } = guard;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido (JSON malformado)." }, { status: 400 });
  }

  const payload = body as { employeeId?: unknown; funnelIds?: unknown } | null;
  const employeeId = typeof payload?.employeeId === "string" ? payload.employeeId.trim() : "";
  if (!employeeId) {
    return NextResponse.json({ error: "Informe o colaborador." }, { status: 400 });
  }
  if (!Array.isArray(payload?.funnelIds)) {
    return NextResponse.json({ error: "`funnelIds` deve ser um array." }, { status: 400 });
  }

  const funnelIds = payload.funnelIds
    .filter((id): id is string => typeof id === "string")
    .map((id) => id.trim())
    .filter(Boolean);

  // O colaborador precisa ser do tenant, senão a liberação viraria uma linha
  // órfã apontando para gente de fora.
  const employees = await readTeamMembersFromDb(session.tenantId, session.email);
  if (!employees.some((employee) => employee.id === employeeId)) {
    return NextResponse.json({ error: "Colaborador não encontrado." }, { status: 404 });
  }

  // Idem para os funis: só vale liberar o que existe no tenant.
  const funnels = await listCrmFunnelsFromDb(session.tenantId);
  const known = new Set(funnels.map((funnel) => funnel.id));
  const unknown = funnelIds.filter((id) => !known.has(id));
  if (unknown.length) {
    return NextResponse.json(
      { error: "Algum funil selecionado não existe mais. Recarregue a página." },
      { status: 400 },
    );
  }

  const result = await replaceFunnelAccessForEmployee({
    tenantId: session.tenantId,
    employeeId,
    funnelIds,
  });
  if (!result.ok) {
    return NextResponse.json({ error: "Não foi possível salvar a liberação." }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    access: await listFunnelAccessForTenant(session.tenantId),
  });
}
