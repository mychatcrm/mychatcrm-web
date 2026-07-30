import { describe, expect, it } from "vitest";
import {
  planSupportsTeams,
  roleAllowsMultipleTeams,
  teamIdsForEmployee,
  validateTeamInput,
  type Team,
} from "@/lib/teams-types";
import type { TeamEmployee, TeamHierarchyRole } from "@/lib/team-employees-types";

function employee(id: string, hierarchyRole: TeamHierarchyRole, nome = id): TeamEmployee {
  return {
    id,
    nome,
    email: `${id}@example.com`,
    funcao: "Comercial",
    initialPassword: "",
    ativo: true,
    hierarchyRole,
  };
}

function team(id: string, name: string, members: Array<[string, TeamHierarchyRole]>): Team {
  return {
    id,
    name,
    active: true,
    members: members.map(([employeeId, roleInTeam]) => ({ employeeId, roleInTeam })),
    createdAt: "2026-07-30T12:00:00.000Z",
  };
}

const EMPLOYEES = [
  employee("dir-1", "director", "Ana"),
  employee("dir-2", "director", "Bruno"),
  employee("man-1", "manager", "Carla"),
  employee("man-2", "manager", "Diego"),
  employee("sel-1", "seller", "Eva"),
  employee("sel-2", "seller", "Fábio"),
];

describe("planSupportsTeams", () => {
  it("libera equipes em Equipa, Escala e Enterprise", () => {
    expect(planSupportsTeams("equipa")).toBe(true);
    expect(planSupportsTeams("escala")).toBe(true);
    expect(planSupportsTeams("enterprise")).toBe(true);
  });

  it("bloqueia equipes no Solo (uso individual)", () => {
    expect(planSupportsTeams("solo")).toBe(false);
  });

  it("resolve os slugs legados de plano", () => {
    expect(planSupportsTeams("profissional")).toBe(true);
    expect(planSupportsTeams("master")).toBe(true);
  });
});

describe("roleAllowsMultipleTeams", () => {
  it("só o diretor participa de várias equipes", () => {
    expect(roleAllowsMultipleTeams("director")).toBe(true);
    expect(roleAllowsMultipleTeams("manager")).toBe(false);
    expect(roleAllowsMultipleTeams("seller")).toBe(false);
  });
});

describe("validateTeamInput", () => {
  it("aceita equipe válida com diretor, gerente e vendedor", () => {
    const result = validateTeamInput(
      { name: "Comercial Centro", memberIds: ["dir-1", "man-1", "sel-1"] },
      { employees: EMPLOYEES, teams: [] },
    );
    expect(result).toBeNull();
  });

  it("exige nome", () => {
    expect(
      validateTeamInput({ name: "   ", memberIds: [] }, { employees: EMPLOYEES, teams: [] }),
    ).toBe("O nome da equipe é obrigatório.");
  });

  it("rejeita nome duplicado no mesmo tenant", () => {
    const existing = [team("t1", "Comercial Centro", [])];
    expect(
      validateTeamInput(
        { name: "comercial centro", memberIds: [] },
        { employees: EMPLOYEES, teams: existing },
      ),
    ).toBe("Já existe uma equipe com este nome.");
  });

  it("permite manter o próprio nome ao editar a equipe", () => {
    const existing = [team("t1", "Comercial Centro", [])];
    expect(
      validateTeamInput(
        { name: "Comercial Centro", memberIds: [] },
        { employees: EMPLOYEES, teams: existing, teamId: "t1" },
      ),
    ).toBeNull();
  });

  it("rejeita colaborador repetido na mesma equipe", () => {
    expect(
      validateTeamInput(
        { name: "Equipe A", memberIds: ["sel-1", "sel-1"] },
        { employees: EMPLOYEES, teams: [] },
      ),
    ).toBe("Colaborador repetido na mesma equipe.");
  });

  it("rejeita colaborador que não é do tenant", () => {
    expect(
      validateTeamInput(
        { name: "Equipe A", memberIds: ["fantasma"] },
        { employees: EMPLOYEES, teams: [] },
      ),
    ).toBe("Colaborador não encontrado neste tenant.");
  });

  it("deixa o mesmo diretor em várias equipes", () => {
    const existing = [team("t1", "Equipe A", [["dir-1", "director"]])];
    expect(
      validateTeamInput(
        { name: "Equipe B", memberIds: ["dir-1"] },
        { employees: EMPLOYEES, teams: existing },
      ),
    ).toBeNull();
  });

  it("impede gerente em duas equipes", () => {
    const existing = [team("t1", "Equipe A", [["man-1", "manager"]])];
    expect(
      validateTeamInput(
        { name: "Equipe B", memberIds: ["man-1"] },
        { employees: EMPLOYEES, teams: existing },
      ),
    ).toBe('Gerente Carla já pertence à equipe "Equipe A". Gerente só pode estar em uma equipe.');
  });

  it("impede vendedor em duas equipes", () => {
    const existing = [team("t1", "Equipe A", [["sel-1", "seller"]])];
    expect(
      validateTeamInput(
        { name: "Equipe B", memberIds: ["sel-1"] },
        { employees: EMPLOYEES, teams: existing },
      ),
    ).toBe('Vendedor Eva já pertence à equipe "Equipe A". Vendedor só pode estar em uma equipe.');
  });

  it("permite manter gerente e vendedor ao editar a própria equipe", () => {
    const existing = [
      team("t1", "Equipe A", [
        ["man-1", "manager"],
        ["sel-1", "seller"],
      ]),
    ];
    expect(
      validateTeamInput(
        { name: "Equipe A", memberIds: ["man-1", "sel-1"] },
        { employees: EMPLOYEES, teams: existing, teamId: "t1" },
      ),
    ).toBeNull();
  });

  it("rejeita nome acima do limite de caracteres", () => {
    expect(
      validateTeamInput({ name: "x".repeat(61), memberIds: [] }, { employees: EMPLOYEES, teams: [] }),
    ).toContain("no máximo");
  });
});

describe("teamIdsForEmployee", () => {
  it("lista todas as equipes de um diretor", () => {
    const teams = [
      team("t1", "Equipe A", [["dir-1", "director"]]),
      team("t2", "Equipe B", [["dir-1", "director"]]),
      team("t3", "Equipe C", [["dir-2", "director"]]),
    ];
    expect(teamIdsForEmployee(teams, "dir-1")).toEqual(["t1", "t2"]);
  });

  it("devolve vazio para quem não está em equipe nenhuma", () => {
    expect(teamIdsForEmployee([team("t1", "Equipe A", [])], "sel-9")).toEqual([]);
  });
});
