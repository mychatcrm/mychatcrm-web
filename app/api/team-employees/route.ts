import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import {
  canActorTargetEmployeeForAdminActions,
  collectSubtreeEmployeeIds,
  creatableHierarchyRolesForSessionStrict,
} from "@/lib/organization-hierarchy";
import { resolveOrganizationRole } from "@/lib/organization-role";
import {
  deleteTeamMembersCascadeFromDb,
  readTeamMembersFromDb,
  updateTeamMemberPasswordInDb,
  updateTeamMemberProfileInDb,
  writeTeamMemberToDb,
} from "@/lib/server/team-employees-db";
import type { AddTeamEmployeeInput, TeamEmployee } from "@/lib/team-employees-types";
import { TEAM_EMPLOYEE_DELETE_CONFIRM_PHRASE } from "@/lib/team-employees-types";
import { canAddRole, validateTeamEmployeeInput, validateTeamEmployeeUpdate } from "@/lib/team-employees-validation";
import { teamEmployeeForPublicResponse } from "@/lib/server/team-employees-public";

function ownerOnlyResponse(session: { organizationRole?: "owner" | "director" | "manager" | "seller"; employeeId?: string }) {
  if (resolveOrganizationRole(session) === "owner") return null;
  return NextResponse.json(
    { error: "Apenas o titular da conta pode gerir colaboradores." },
    { status: 403 },
  );
}

export async function GET() {
  const auth = await requireActiveClientSession();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const employees = (await readTeamMembersFromDb(session.tenantId, session.email)).map(teamEmployeeForPublicResponse);
  return NextResponse.json({ employees });
}

export async function POST(request: Request) {
  const auth = await requireActiveClientSession();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const forbidden = ownerOnlyResponse(session);
  if (forbidden) return forbidden;
  const body = (await request.json().catch(() => null)) as Partial<AddTeamEmployeeInput> | null;
  if (!body?.nome || !body.email || !body.funcao || !body.initialPassword || !body.hierarchyRole) {
    return NextResponse.json({ error: "Dados incompletos." }, { status: 400 });
  }
  const input: AddTeamEmployeeInput = {
    nome: String(body.nome),
    email: String(body.email),
    funcao: String(body.funcao),
    initialPassword: String(body.initialPassword),
    hierarchyRole: body.hierarchyRole as AddTeamEmployeeInput["hierarchyRole"],
    reportsToId: typeof body.reportsToId === "string" ? body.reportsToId : undefined,
  };

  if (!creatableHierarchyRolesForSessionStrict(session).includes(input.hierarchyRole)) {
    return NextResponse.json({ error: "Sem permissão para criar este papel." }, { status: 403 });
  }

  const list = await readTeamMembersFromDb(session.tenantId, session.email);
  if (!canAddRole(list, input.hierarchyRole, session.plan, session.operationalLimits)) {
    return NextResponse.json({ error: "Limite de colaboradores deste tipo atingido." }, { status: 409 });
  }
  const err = validateTeamEmployeeInput(list, input);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const id = `emp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const created: TeamEmployee = {
    id,
    nome: input.nome.trim(),
    email: input.email.trim(),
    funcao: input.funcao.trim(),
    initialPassword: "",
    ativo: true,
    hierarchyRole: input.hierarchyRole,
    reportsToId: input.reportsToId,
    accountSuspended: false,
  };

  await writeTeamMemberToDb(session.tenantId, {
    ...created,
    plainPassword: input.initialPassword.trim(),
  });
  return NextResponse.json({ employee: teamEmployeeForPublicResponse(created) });
}

export async function PATCH(request: Request) {
  const auth = await requireActiveClientSession();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const forbidden = ownerOnlyResponse(session);
  if (forbidden) return forbidden;
  const body = (await request.json().catch(() => null)) as {
    id?: string;
    accountSuspended?: boolean;
    nome?: string;
    email?: string;
    funcao?: string;
    initialPassword?: string;
  } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Id obrigatório." }, { status: 400 });
  const list = await readTeamMembersFromDb(session.tenantId, session.email);
  const target = list.find((e) => e.id === id);
  if (!target) return NextResponse.json({ error: "Colaborador não encontrado." }, { status: 404 });
  if (!canActorTargetEmployeeForAdminActions(session, list, target)) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const wantsProfilePatch =
    typeof body?.nome === "string" ||
    typeof body?.email === "string" ||
    typeof body?.funcao === "string" ||
    typeof body?.initialPassword === "string";

  if (wantsProfilePatch && body) {
    const nome = typeof body.nome === "string" ? body.nome : target.nome;
    const email = typeof body.email === "string" ? body.email : target.email;
    const funcao = typeof body.funcao === "string" ? body.funcao : target.funcao;
    const pwdRaw = typeof body.initialPassword === "string" ? body.initialPassword.trim() : "";

    const err = validateTeamEmployeeUpdate(list, id, {
      nome,
      email,
      funcao,
      initialPassword: pwdRaw || undefined,
    });
    if (err) return NextResponse.json({ error: err }, { status: 400 });

    await updateTeamMemberProfileInDb(id, {
      nome: nome.trim(),
      email: email.trim(),
      funcao: funcao.trim(),
    });
    if (pwdRaw) {
      await updateTeamMemberPasswordInDb(id, pwdRaw);
    }
  }

  if (typeof body?.accountSuspended === "boolean") {
    await updateTeamMemberProfileInDb(id, { accountSuspended: body.accountSuspended });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const auth = await requireActiveClientSession();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const forbidden = ownerOnlyResponse(session);
  if (forbidden) return forbidden;
  const body = (await request.json().catch(() => null)) as { id?: string; confirmPhrase?: string } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const phrase = typeof body?.confirmPhrase === "string" ? body.confirmPhrase.trim() : "";
  if (!id) return NextResponse.json({ error: "Id obrigatório." }, { status: 400 });
  if (phrase !== TEAM_EMPLOYEE_DELETE_CONFIRM_PHRASE) {
    return NextResponse.json({ error: "Confirmação inválida." }, { status: 400 });
  }
  const list = await readTeamMembersFromDb(session.tenantId, session.email);
  const root = list.find((e) => e.id === id);
  if (!root) return NextResponse.json({ error: "Colaborador não encontrado." }, { status: 404 });
  if (!canActorTargetEmployeeForAdminActions(session, list, root)) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }
  const cascade = collectSubtreeEmployeeIds(list, id);
  const removedProfiles = list.filter((e) => cascade.has(e.id));
  await deleteTeamMembersCascadeFromDb([...cascade]);
  return NextResponse.json({
    ok: true,
    removedIds: [...cascade],
    removedProfiles: removedProfiles.map(teamEmployeeForPublicResponse),
  });
}
