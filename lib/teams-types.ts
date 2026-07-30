/**
 * Equipes do tenant — agrupam colaboradores e são a fronteira de isolamento de
 * dados (leads, conversas, agenda). Só o titular da conta cria e edita equipes.
 */

import type { ClientPlan } from "@/lib/client-auth";
import { normalizeClientPlan } from "@/lib/plan-limits";
import type { TeamEmployee, TeamHierarchyRole } from "@/lib/team-employees-types";

export const TEAMS_UPDATED_EVENT = "mychatcrm-teams-updated";

export const TEAM_DELETE_CONFIRM_PHRASE = "QUERO APAGAR";

export const MAX_TEAM_NAME_LENGTH = 60;

export type Team = {
  id: string;
  name: string;
  active: boolean;
  /** Colaboradores vinculados, com o papel que exercem nesta equipe. */
  members: TeamMemberLink[];
  createdAt: string;
};

export type TeamMemberLink = {
  employeeId: string;
  roleInTeam: TeamHierarchyRole;
};

export type TeamUpsertInput = {
  name: string;
  active?: boolean;
  memberIds: string[];
};

/**
 * Equipes são um recurso de operação em time — plano Solo é uso individual e
 * não expõe o recurso (nem menu, nem rota, nem API).
 */
export function planSupportsTeams(plan: ClientPlan | "profissional" | "master"): boolean {
  return normalizeClientPlan(plan) !== "solo";
}

/**
 * Diretor pode estar em quantas equipes o titular quiser; gerente e vendedor
 * pertencem a no máximo uma. A mesma regra é garantida no banco pelo índice
 * parcial `team_members_one_team_for_manager_seller`.
 */
export function roleAllowsMultipleTeams(role: TeamHierarchyRole): boolean {
  return role === "director";
}

export function validateTeamInput(
  input: TeamUpsertInput,
  context: {
    /** Todos os colaboradores do tenant (para resolver o papel de cada id). */
    employees: TeamEmployee[];
    /** Equipes já existentes, para detectar nome duplicado e vínculo repetido. */
    teams: Team[];
    /** Preenchido ao editar, para a equipe não conflitar consigo mesma. */
    teamId?: string;
  },
): string | null {
  const name = input.name?.trim() ?? "";
  if (!name) return "O nome da equipe é obrigatório.";
  if (name.length > MAX_TEAM_NAME_LENGTH) {
    return `O nome da equipe deve ter no máximo ${MAX_TEAM_NAME_LENGTH} caracteres.`;
  }

  const nameLc = name.toLowerCase();
  if (context.teams.some((t) => t.id !== context.teamId && t.name.trim().toLowerCase() === nameLc)) {
    return "Já existe uma equipe com este nome.";
  }

  const memberIds = input.memberIds ?? [];
  if (new Set(memberIds).size !== memberIds.length) {
    return "Colaborador repetido na mesma equipe.";
  }

  for (const employeeId of memberIds) {
    const employee = context.employees.find((e) => e.id === employeeId);
    if (!employee) return "Colaborador não encontrado neste tenant.";
    if (roleAllowsMultipleTeams(employee.hierarchyRole)) continue;

    const conflict = context.teams.find(
      (t) => t.id !== context.teamId && t.members.some((m) => m.employeeId === employeeId),
    );
    if (conflict) {
      const label = employee.hierarchyRole === "manager" ? "Gerente" : "Vendedor";
      return `${label} ${employee.nome} já pertence à equipe "${conflict.name}". ${label} só pode estar em uma equipe.`;
    }
  }

  return null;
}

/** Ids das equipes em que o colaborador está vinculado. */
export function teamIdsForEmployee(teams: Team[], employeeId: string): string[] {
  return teams.filter((t) => t.members.some((m) => m.employeeId === employeeId)).map((t) => t.id);
}
