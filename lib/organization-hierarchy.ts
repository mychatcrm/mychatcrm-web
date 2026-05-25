/**
 * Regras de hierarquia Dono > Diretor > Gerente > Vendedor e escopo de gestão.
 * Módulo puro (sem I/O) — reutilizável no cliente e em Route Handlers.
 */

import type { ClientSession } from "@/lib/client-auth";
import { getPlanCollaboratorCapsForSession, normalizeClientPlan } from "@/lib/plan-limits";
import type { ClientLead } from "@/lib/dashboard-data";
import type { OrganizationRole } from "@/lib/organization-role";
import { resolveOrganizationRole } from "@/lib/organization-role";
import type { TeamEmployee, TeamHierarchyRole } from "@/lib/team-employees-types";

export function hierarchyRoleToOrganizationRole(role: TeamHierarchyRole): Exclude<OrganizationRole, "owner"> {
  return role;
}

/** Subordinados directos (reportsToId === parentId). */
export function directReports(employees: TeamEmployee[], parentId: string): TeamEmployee[] {
  return employees.filter((e) => e.reportsToId === parentId);
}

/** Recolhe ids do nó raiz e de toda a subárvore (descendentes). */
export function collectSubtreeEmployeeIds(employees: TeamEmployee[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of employees) {
      if (e.reportsToId && ids.has(e.reportsToId) && !ids.has(e.id)) {
        ids.add(e.id);
        grew = true;
      }
    }
  }
  return ids;
}

export function previewRemovalCascadeFromList(employees: TeamEmployee[], rootId: string): TeamEmployee[] {
  const ids = collectSubtreeEmployeeIds(employees, rootId);
  return employees.filter((e) => ids.has(e.id));
}

/** Diretor/gerente autenticado com `employeeId`: ids de colaboradores cujos dados (ex.: CRM) pode ver além do próprio. */
export function visibleManagedEmployeeIds(employees: TeamEmployee[], actorEmployeeId: string): Set<string> {
  return collectSubtreeEmployeeIds(employees, actorEmployeeId);
}

/**
 * Escopo de visualização de leads por `ownerEmployeeId`.
 * `null` = sem filtro por dono (dono ou diretor/gerente demo sem vínculo a registo).
 */
export function crmOwnerIdScopeForSession(
  session: ClientSession,
  employees: TeamEmployee[],
): Set<string> | null {
  const org = resolveOrganizationRole(session);
  if (org === "owner") return null;
  if (org === "seller") {
    if (!session.employeeId) return new Set(); // sem vínculo: nenhum lead por id
    return new Set([session.employeeId]);
  }
  if (org === "director" || org === "manager") {
    if (!session.employeeId) return null; // contas demo estáticas: vê tudo como hoje
    const sub = visibleManagedEmployeeIds(employees, session.employeeId);
    sub.add(session.employeeId);
    return sub;
  }
  return null;
}

export function leadMatchesOwnerScope(lead: ClientLead, scope: Set<string> | null): boolean {
  if (scope === null) return true;
  // Leads criados automaticamente ainda podem não ter responsável
  // humano. Mantê-los visíveis no CRM do tenant evita que oportunidades novas
  // sumam antes de alguém assumir/atribuir o atendimento.
  if (!lead.ownerEmployeeId && isAutomaticInboundLead(lead)) return true;
  if (lead.ownerEmployeeId && scope.has(lead.ownerEmployeeId)) return true;
  return false;
}

function normalizeLeadSource(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

export function isAutomaticInboundLead(lead: ClientLead): boolean {
  const haystack = [
    lead.origem,
    lead.tag,
    lead.agenteEntrada,
    lead.agenteAtendendo,
    ...lead.tags,
  ]
    .map(normalizeLeadSource)
    .join(" ");

  return (
    haystack.includes("whatsapp") ||
    haystack.includes("meta") ||
    haystack.includes("facebook") ||
    haystack.includes("lead ads") ||
    haystack.includes("lead_ads") ||
    haystack.includes("formulario") ||
    haystack.includes("form")
  );
}

export function filterLeadsForSession(session: ClientSession, employees: TeamEmployee[], leads: ClientLead[]): ClientLead[] {
  const scope = crmOwnerIdScopeForSession(session, employees);
  if (scope === null) return leads;
  return leads.filter((l) => leadMatchesOwnerScope(l, scope));
}

/** Dono ou papel estático demo (sem employeeId) pode gerir qualquer colaborador do tenant. */
export function isBroadTenantAdmin(session: ClientSession): boolean {
  const org = resolveOrganizationRole(session);
  if (org === "owner") return true;
  if ((org === "director" || org === "manager") && !session.employeeId) return true;
  return false;
}

export function findEmployeeById(employees: TeamEmployee[], id: string): TeamEmployee | undefined {
  return employees.find((e) => e.id === id);
}

/**
 * Quem o actor pode bloquear/apagar como alvo (não inclui cascata de apagar filhos — só o alvo directo).
 * Dono: todos. Diretor: gerentes e vendedores na sua árvore, não outro diretor. Gerente: só vendedores que reportam a ele.
 */
export function canActorTargetEmployeeForAdminActions(
  session: ClientSession,
  employees: TeamEmployee[],
  target: TeamEmployee,
): boolean {
  const org = resolveOrganizationRole(session);
  if (org === "seller") return false;
  if (session.employeeId && session.employeeId === target.id) return false;
  if (org === "owner") return true;

  if (isBroadTenantAdmin(session)) {
    if (org === "director") return target.hierarchyRole !== "director";
    if (org === "manager") return target.hierarchyRole === "seller";
  }

  if (!session.employeeId) return false;
  const actor = findEmployeeById(employees, session.employeeId);
  if (!actor || actor.accountSuspended) return false;

  if (actor.hierarchyRole === "manager") {
    if (target.hierarchyRole !== "seller") return false;
    return target.reportsToId === actor.id;
  }
  if (actor.hierarchyRole === "director") {
    if (target.hierarchyRole === "director") return false;
    const subtree = collectSubtreeEmployeeIds(employees, actor.id);
    return subtree.has(target.id) && target.id !== actor.id;
  }
  return false;
}

export function canActorCreateRole(session: ClientSession, newRole: TeamHierarchyRole): boolean {
  return creatableHierarchyRolesForSessionStrict(session).includes(newRole);
}

export function creatableHierarchyRolesForSessionStrict(session: ClientSession): TeamHierarchyRole[] {
  const org = resolveOrganizationRole(session);
  const caps = getPlanCollaboratorCapsForSession(session);
  const ownerRoles: TeamHierarchyRole[] = [];
  if (caps.maxDirectors > 0) ownerRoles.push("director");
  if (caps.maxManagers > 0) ownerRoles.push("manager");
  if (caps.maxSellers > 0) ownerRoles.push("seller");

  if (org === "owner") {
    const p = normalizeClientPlan(session.plan);
    if (p === "solo") return [];
    return ownerRoles;
  }
  if (org === "director") return caps.maxManagers > 0 ? ["manager"] : [];
  if (org === "manager") return caps.maxSellers > 0 ? ["seller"] : [];
  return [];
}

/** Quem cria o registo deve ser o superior directo (exceto dono / sessões demo amplas). */
export function validateCreatorReportsToSelf(session: ClientSession, input: { hierarchyRole: TeamHierarchyRole; reportsToId?: string }): string | null {
  if (resolveOrganizationRole(session) === "owner") return null;
  if (isBroadTenantAdmin(session)) return null;
  if (!session.employeeId) return "Sessão sem vínculo a colaborador: não é possível criar subordinados.";
  if (input.hierarchyRole === "manager") {
    if (input.reportsToId !== session.employeeId) return "O gerente deve reportar ao seu diretor (si).";
  } else if (input.hierarchyRole === "seller") {
    if (input.reportsToId !== session.employeeId) return "O vendedor deve reportar ao seu gerente (si).";
  }
  return null;
}

export function canTransferLeadToEmployee(
  session: ClientSession,
  employees: TeamEmployee[],
  lead: ClientLead,
  targetEmployeeId: string,
): boolean {
  const org = resolveOrganizationRole(session);
  if (org === "owner" || isBroadTenantAdmin(session)) return true;
  if (org === "seller") return false;
  if (!session.employeeId) return org === "director" || org === "manager";
  const actor = findEmployeeById(employees, session.employeeId);
  const target = findEmployeeById(employees, targetEmployeeId);
  if (!actor || !target || target.hierarchyRole !== "seller") return false;
  const subtree = collectSubtreeEmployeeIds(employees, actor.id);
  if (!subtree.has(target.id)) return false;
  if (lead.ownerEmployeeId) {
    const fromEmp = findEmployeeById(employees, lead.ownerEmployeeId);
    if (!fromEmp || fromEmp.hierarchyRole !== "seller") return false;
    return subtree.has(fromEmp.id);
  }
  return true;
}

export function assertEmployeePassword(emp: TeamEmployee, password: string): boolean {
  if (emp.accountSuspended) return false;
  return emp.initialPassword === password;
}
