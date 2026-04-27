import type { ClientPlan } from "@/lib/client-auth";
import type { PlanLimits } from "@/lib/plan-policy";
import {
  getPlanCollaboratorCaps,
  getPlanMaxCollaboratorsTotal,
  normalizeClientPlan,
} from "@/lib/plan-limits";
import type { AddTeamEmployeeInput, TeamEmployee } from "@/lib/team-employees-types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateTeamEmployeeInput(list: TeamEmployee[], input: AddTeamEmployeeInput): string | null {
  if (!input.nome?.trim()) return "O nome é obrigatório.";
  if (!input.email?.trim()) return "O email é obrigatório.";
  if (!EMAIL_RE.test(input.email.trim())) return "Indique um email válido.";
  if (!input.funcao?.trim()) return "A função / equipa é obrigatória.";
  if (!input.initialPassword?.trim()) return "A senha inicial é obrigatória.";
  if (input.initialPassword.trim().length < 5) return "A senha inicial deve ter pelo menos 5 caracteres.";

  const emailLc = input.email.trim().toLowerCase();
  if (list.some((e) => e.email.trim().toLowerCase() === emailLc)) {
    return "Já existe um colaborador com este email.";
  }

  if (input.hierarchyRole === "director") {
    if (input.reportsToId) return "Diretor não deve ter superior.";
  } else if (input.hierarchyRole === "manager") {
    if (!input.reportsToId) return "Selecione o diretor a quem o gerente reporta.";
    const sup = list.find((e) => e.id === input.reportsToId);
    if (!sup || sup.hierarchyRole !== "director") return "Superior inválido: escolha um diretor.";
  } else {
    if (!input.reportsToId) return "Selecione o gerente responsável pelo vendedor.";
    const sup = list.find((e) => e.id === input.reportsToId);
    if (!sup || sup.hierarchyRole !== "manager") return "Superior inválido: escolha um gerente.";
  }
  return null;
}

/** Actualização de cadastro (sem mudar papel nem hierarquia). */
export function validateTeamEmployeeUpdate(
  list: TeamEmployee[],
  employeeId: string,
  input: { nome: string; email: string; funcao: string; initialPassword?: string },
): string | null {
  if (!input.nome?.trim()) return "O nome é obrigatório.";
  if (!input.email?.trim()) return "O email é obrigatório.";
  if (!EMAIL_RE.test(input.email.trim())) return "Indique um email válido.";
  if (!input.funcao?.trim()) return "A função / equipa é obrigatória.";
  const pwd = input.initialPassword?.trim();
  if (pwd && pwd.length < 5) return "A nova senha inicial deve ter pelo menos 5 caracteres.";
  const emailLc = input.email.trim().toLowerCase();
  if (list.some((e) => e.id !== employeeId && e.email.trim().toLowerCase() === emailLc)) {
    return "Já existe um colaborador com este email.";
  }
  return null;
}

export function countByRole(list: TeamEmployee[], role: TeamEmployee["hierarchyRole"]): number {
  return list.filter((e) => e.hierarchyRole === role).length;
}

export function canAddRole(
  list: TeamEmployee[],
  role: TeamEmployee["hierarchyRole"],
  plan: ClientPlan | "profissional" | "master",
  operationalLimits?: PlanLimits | null,
): boolean {
  const p = normalizeClientPlan(plan);
  const caps = getPlanCollaboratorCaps(p, operationalLimits);
  const maxTotal = getPlanMaxCollaboratorsTotal(p, operationalLimits);
  if (list.length >= maxTotal) return false;
  if (role === "director") return countByRole(list, "director") < caps.maxDirectors;
  if (role === "manager") return countByRole(list, "manager") < caps.maxManagers;
  return countByRole(list, "seller") < caps.maxSellers;
}
