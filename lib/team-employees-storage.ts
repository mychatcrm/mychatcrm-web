/**
 * Colaboradores: listagem em memória sincronizada com `GET /api/team-employees`.
 * Tipos e limites em `team-employees-types`; regras em `organization-hierarchy`.
 */

export {
  MAX_ORG_DIRECTORS,
  MAX_ORG_MANAGERS,
  MAX_ORG_SELLERS,
  MAX_TEAM_EMPLOYEES,
  TEAM_EMPLOYEE_DELETE_CONFIRM_PHRASE,
  TEAM_EMPLOYEES_UPDATED_EVENT,
  type AddTeamEmployeeInput,
  type TeamEmployee,
  type TeamHierarchyRole,
} from "@/lib/team-employees-types";

export { creatableHierarchyRolesForSessionStrict as creatableHierarchyRolesForSession } from "@/lib/organization-hierarchy";
export { collectSubtreeEmployeeIds, previewRemovalCascadeFromList } from "@/lib/organization-hierarchy";
export {
  countByRole as countTeamEmployeesByRole,
  validateTeamEmployeeInput,
  validateTeamEmployeeUpdate,
} from "@/lib/team-employees-validation";

import type { ClientPlan } from "@/lib/client-auth";
import type { PlanLimits } from "@/lib/plan-policy";
import { canAddRole } from "@/lib/team-employees-validation";
import { getTeamEmployeesCache } from "@/lib/team-employees-client-cache";
import type { TeamEmployee } from "@/lib/team-employees-types";

export function canAddTeamEmployeeOfRole(
  list: TeamEmployee[],
  role: TeamEmployee["hierarchyRole"],
  plan: ClientPlan | "profissional" | "master",
  operationalLimits?: PlanLimits | null,
) {
  return canAddRole(list, role, plan, operationalLimits);
}

export function loadTeamEmployees(tenantId: string): TeamEmployee[] {
  return getTeamEmployeesCache(tenantId) ?? [];
}
