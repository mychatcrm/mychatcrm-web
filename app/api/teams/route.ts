/**
 * CRUD de equipes — exclusivo do titular da conta.
 *
 * GET é liberado a qualquer sessão autenticada (o painel precisa resolver nomes
 * de equipe e o escopo de quem está logado), no mesmo padrão de
 * `GET /api/team-employees`. Escrita exige `organizationRole === "owner"`.
 */
import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { resolveOrganizationRole } from "@/lib/organization-role";
import { readTeamMembersFromDb } from "@/lib/server/team-employees-db";
import { createTeam, deleteTeam, listTeams, updateTeam } from "@/lib/server/teams-db";
import type { TeamMemberLink, TeamUpsertInput } from "@/lib/teams-types";
import { planSupportsTeams, TEAM_DELETE_CONFIRM_PHRASE, validateTeamInput } from "@/lib/teams-types";

export const dynamic = "force-dynamic";

type SessionLike = Parameters<typeof resolveOrganizationRole>[0] & {
  tenantId: string;
  email: string;
  plan: Parameters<typeof planSupportsTeams>[0];
};

function ownerOnlyResponse(session: SessionLike) {
  if (resolveOrganizationRole(session) === "owner") return null;
  return NextResponse.json(
    { error: "Apenas o titular da conta pode gerir equipes." },
    { status: 403 },
  );
}

function planGateResponse(session: SessionLike) {
  if (planSupportsTeams(session.plan)) return null;
  return NextResponse.json(
    { error: "O plano Solo é individual e não usa equipes. Faça upgrade para Equipa ou Escala." },
    { status: 403 },
  );
}

/** Resolve o papel de cada colaborador para gravar em `role_in_team`. */
async function buildMemberLinks(
  tenantId: string,
  actorEmail: string,
  memberIds: string[],
): Promise<{ links: TeamMemberLink[]; employees: Awaited<ReturnType<typeof readTeamMembersFromDb>> }> {
  const employees = await readTeamMembersFromDb(tenantId, actorEmail);
  const links: TeamMemberLink[] = [];
  for (const employeeId of memberIds) {
    const employee = employees.find((e) => e.id === employeeId);
    if (!employee) continue;
    links.push({ employeeId, roleInTeam: employee.hierarchyRole });
  }
  return { links, employees };
}

function parseUpsertBody(body: unknown): TeamUpsertInput | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as Record<string, unknown>;
  if (typeof raw.name !== "string") return null;
  const memberIds = Array.isArray(raw.memberIds)
    ? raw.memberIds.filter((id): id is string => typeof id === "string")
    : [];
  return {
    name: raw.name,
    active: typeof raw.active === "boolean" ? raw.active : true,
    memberIds,
  };
}

function errorToResponse(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : "";
  if (message === "SINGLE_TEAM_VIOLATION") {
    return NextResponse.json(
      { error: "Gerente e vendedor só podem pertencer a uma equipe." },
      { status: 409 },
    );
  }
  if (message === "DUPLICATE_TEAM_NAME") {
    return NextResponse.json({ error: "Já existe uma equipe com este nome." }, { status: 409 });
  }
  console.error("[api/teams]", message || err);
  return NextResponse.json({ error: "Erro ao gravar a equipe." }, { status: 500 });
}

export async function GET() {
  const auth = await requireActiveClientSession();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  if (!planSupportsTeams(session.plan)) return NextResponse.json({ teams: [] });
  try {
    return NextResponse.json({ teams: await listTeams(session.tenantId) });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function POST(request: Request) {
  const auth = await requireActiveClientSession();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const gated = planGateResponse(session) ?? ownerOnlyResponse(session);
  if (gated) return gated;

  const input = parseUpsertBody(await request.json().catch(() => null));
  if (!input) return NextResponse.json({ error: "Dados incompletos." }, { status: 400 });

  try {
    const [{ links, employees }, teams] = await Promise.all([
      buildMemberLinks(session.tenantId, session.email, input.memberIds),
      listTeams(session.tenantId),
    ]);
    const invalid = validateTeamInput(input, { employees, teams });
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    const team = await createTeam(session.tenantId, {
      name: input.name.trim(),
      active: input.active ?? true,
      members: links,
    });
    return NextResponse.json({ team });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function PATCH(request: Request) {
  const auth = await requireActiveClientSession();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const gated = planGateResponse(session) ?? ownerOnlyResponse(session);
  if (gated) return gated;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const teamId = typeof body?.id === "string" ? body.id : "";
  if (!teamId) return NextResponse.json({ error: "Equipe não informada." }, { status: 400 });

  const input = parseUpsertBody(body);
  if (!input) return NextResponse.json({ error: "Dados incompletos." }, { status: 400 });

  try {
    const [{ links, employees }, teams] = await Promise.all([
      buildMemberLinks(session.tenantId, session.email, input.memberIds),
      listTeams(session.tenantId),
    ]);
    if (!teams.some((t) => t.id === teamId)) {
      return NextResponse.json({ error: "Equipe não encontrada." }, { status: 404 });
    }
    const invalid = validateTeamInput(input, { employees, teams, teamId });
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    await updateTeam(session.tenantId, teamId, {
      name: input.name.trim(),
      active: input.active,
      members: links,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function DELETE(request: Request) {
  const auth = await requireActiveClientSession();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const gated = planGateResponse(session) ?? ownerOnlyResponse(session);
  if (gated) return gated;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const teamId = typeof body?.id === "string" ? body.id : "";
  if (!teamId) return NextResponse.json({ error: "Equipe não informada." }, { status: 400 });
  if (body?.confirm !== TEAM_DELETE_CONFIRM_PHRASE) {
    return NextResponse.json(
      { error: `Escreva ${TEAM_DELETE_CONFIRM_PHRASE} para confirmar.` },
      { status: 400 },
    );
  }

  try {
    await deleteTeam(session.tenantId, teamId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorToResponse(err);
  }
}
