import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientSession } from "@/lib/client-auth";
import {
  canActorTargetEmployeeForAdminActions,
  creatableHierarchyRolesForSessionStrict,
} from "@/lib/organization-hierarchy";
import { organizationRoleCanAccessDashboardRoute } from "@/lib/organization-role";
import type { AddTeamEmployeeInput, TeamEmployee } from "@/lib/team-employees-types";
import { validateTeamEmployeeInput } from "@/lib/team-employees-validation";

const {
  requireActiveClientSessionMock,
  readTeamMembersFromDbMock,
  writeTeamMemberToDbMock,
  updateTeamMemberProfileInDbMock,
  updateTeamMemberPasswordInDbMock,
  deleteTeamMembersCascadeFromDbMock,
} = vi.hoisted(() => ({
  requireActiveClientSessionMock: vi.fn(),
  readTeamMembersFromDbMock: vi.fn(),
  writeTeamMemberToDbMock: vi.fn(),
  updateTeamMemberProfileInDbMock: vi.fn(),
  updateTeamMemberPasswordInDbMock: vi.fn(),
  deleteTeamMembersCascadeFromDbMock: vi.fn(),
}));

vi.mock("@/lib/server/client-session-guard", () => ({
  requireActiveClientSession: requireActiveClientSessionMock,
}));
vi.mock("@/lib/server/team-employees-db", () => ({
  readTeamMembersFromDb: readTeamMembersFromDbMock,
  writeTeamMemberToDb: writeTeamMemberToDbMock,
  updateTeamMemberProfileInDb: updateTeamMemberProfileInDbMock,
  updateTeamMemberPasswordInDb: updateTeamMemberPasswordInDbMock,
  deleteTeamMembersCascadeFromDb: deleteTeamMembersCascadeFromDbMock,
}));

import { DELETE, GET, PATCH, POST } from "@/app/api/team-employees/route";

function session(partial: Partial<ClientSession> = {}): ClientSession {
  return {
    token: "token",
    tenantId: "tenant-a",
    email: "owner@example.com",
    displayName: "Owner",
    companyName: "Company",
    plan: "equipa",
    planLabel: "Equipa",
    initials: "OW",
    status: "ativa",
    organizationRole: "owner",
    ...partial,
  };
}

const director: TeamEmployee = {
  id: "director-1",
  nome: "Diretora",
  email: "diretora@example.com",
  funcao: "Diretoria",
  initialPassword: "",
  ativo: true,
  hierarchyRole: "director",
};

function employeeInput(
  hierarchyRole: AddTeamEmployeeInput["hierarchyRole"],
  reportsToId?: string,
): AddTeamEmployeeInput {
  return {
    nome: "Pessoa",
    email: `${hierarchyRole}@example.com`,
    funcao: "Equipe",
    initialPassword: "senha-segura",
    hierarchyRole,
    reportsToId,
  };
}

function request(method: string, body: unknown) {
  return new Request("https://example.test/api/team-employees", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("collaborator owner-only management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readTeamMembersFromDbMock.mockResolvedValue([director]);
  });

  it("exposes dashboard/colaboradores only to the account owner", () => {
    expect(organizationRoleCanAccessDashboardRoute("owner", "colaboradores")).toBe(true);
    expect(organizationRoleCanAccessDashboardRoute("director", "colaboradores")).toBe(false);
    expect(organizationRoleCanAccessDashboardRoute("manager", "colaboradores")).toBe(false);
    expect(organizationRoleCanAccessDashboardRoute("seller", "colaboradores")).toBe(false);
  });

  it("allows only the owner to create or administrate collaborator records", () => {
    expect(creatableHierarchyRolesForSessionStrict(session())).toEqual(["director", "manager", "seller"]);
    expect(
      creatableHierarchyRolesForSessionStrict(
        session({ organizationRole: "director", employeeId: "director-1" }),
      ),
    ).toEqual([]);
    expect(canActorTargetEmployeeForAdminActions(session(), [director], director)).toBe(true);
    expect(
      canActorTargetEmployeeForAdminActions(
        session({ organizationRole: "manager", employeeId: "manager-1" }),
        [director],
        director,
      ),
    ).toBe(false);
  });

  it("accepts managers and sellers without a superior", () => {
    expect(validateTeamEmployeeInput([], employeeInput("manager"))).toBeNull();
    expect(validateTeamEmployeeInput([], employeeInput("seller"))).toBeNull();
  });

  it("keeps optional links type-safe when a superior is selected", () => {
    const manager: TeamEmployee = {
      ...director,
      id: "manager-1",
      email: "manager@example.com",
      hierarchyRole: "manager",
    };
    expect(validateTeamEmployeeInput([director], employeeInput("manager", director.id))).toBeNull();
    expect(validateTeamEmployeeInput([manager], employeeInput("seller", manager.id))).toBeNull();
    expect(validateTeamEmployeeInput([director], employeeInput("seller", director.id))).toBe(
      "Superior inválido: escolha um gerente.",
    );
  });

  it.each([
    ["POST", POST],
    ["PATCH", PATCH],
    ["DELETE", DELETE],
  ] as const)("blocks %s mutations before touching the database for non-owners", async (method, handler) => {
    requireActiveClientSessionMock.mockResolvedValue({
      ok: true,
      session: session({ organizationRole: "director", employeeId: "director-1" }),
    });

    const response = await handler(request(method, {}));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Apenas o titular da conta pode gerir colaboradores.",
    });
    expect(readTeamMembersFromDbMock).not.toHaveBeenCalled();
    expect(writeTeamMemberToDbMock).not.toHaveBeenCalled();
    expect(updateTeamMemberProfileInDbMock).not.toHaveBeenCalled();
    expect(deleteTeamMembersCascadeFromDbMock).not.toHaveBeenCalled();
  });

  it("keeps sanitized team reading available to authenticated collaborators for CRM scoping", async () => {
    requireActiveClientSessionMock.mockResolvedValue({
      ok: true,
      session: session({ organizationRole: "seller", employeeId: "seller-1" }),
    });

    const response = await GET();
    const body = (await response.json()) as { employees: TeamEmployee[] };

    expect(response.status).toBe(200);
    expect(body.employees[0]).toMatchObject({ id: director.id, initialPassword: "" });
    expect(readTeamMembersFromDbMock).toHaveBeenCalledWith("tenant-a", "owner@example.com");
  });
});
