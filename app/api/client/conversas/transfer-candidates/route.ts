import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { readTeamMembersFromDb } from "@/lib/server/team-employees-db";
import { collectSubtreeEmployeeIds } from "@/lib/organization-hierarchy";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = session.organizationRole ?? "seller";
  if (role === "seller") return NextResponse.json({ candidates: [] });

  const employees = await readTeamMembersFromDb(session.tenantId);
  const active = employees.filter((e) => e.ativo && !e.accountSuspended);

  let candidates = active;
  if (role !== "owner" && session.employeeId) {
    const subtreeIds = collectSubtreeEmployeeIds(employees, session.employeeId);
    candidates = active.filter((e) => subtreeIds.has(e.id));
  }

  return NextResponse.json({
    candidates: candidates.map((e) => ({
      id: e.id,
      nome: e.nome,
      funcao: e.funcao,
      hierarchyRole: e.hierarchyRole,
    })),
  });
}
