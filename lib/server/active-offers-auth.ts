import type { ClientSession } from "@/lib/client-auth";
import { resolveOrganizationRole } from "@/lib/organization-role";

export type ActiveOfferAccessRow = {
  id: string;
  tenant_id: string;
  created_by: string | null;
  created_via: string | null;
  archived_at: string | null;
};

/**
 * Gerente tem o mesmo poder do diretor sobre listas de ligação — criar, gerir e
 * arquivar —, só que restrito à equipe dele. O recorte de *quais leads* entram
 * na lista vem de `lib/server/access-scope.ts`, então aqui basta liberar o
 * papel: um gerente sem equipe simplesmente não alcança lead nenhum.
 */
export function canCreateActiveOffer(session: ClientSession): boolean {
  const role = resolveOrganizationRole(session);
  return role === "owner" || role === "director" || role === "manager";
}

export function canManageActiveOffer(session: ClientSession): boolean {
  return canCreateActiveOffer(session);
}

export function isSellerSession(session: ClientSession): boolean {
  return resolveOrganizationRole(session) === "seller";
}

export function isManagerSession(session: ClientSession): boolean {
  return resolveOrganizationRole(session) === "manager";
}

export function canViewActiveOfferProgress(session: ClientSession): boolean {
  const role = resolveOrganizationRole(session);
  return role === "owner" || role === "director" || role === "manager";
}

export function offerVisibleToEmployee(params: {
  assigneeIds: string[];
  employeeId: string | undefined;
  isCreatorOrManager: boolean;
}): boolean {
  if (params.isCreatorOrManager) return true;
  if (!params.employeeId) return false;
  if (!params.assigneeIds.length) return true;
  return params.assigneeIds.includes(params.employeeId);
}

export function canDispositionLead(params: {
  session: ClientSession;
  assigneeIds: string[];
  assignedEmployeeId: string | null;
  distributionMode: string;
}): boolean {
  const role = resolveOrganizationRole(params.session);
  // Gerente dispõe leads como o diretor; o alcance dele já está limitado à
  // própria equipe pelo escopo aplicado ao montar e ler a lista.
  if (role === "owner" || role === "director" || role === "manager") return true;
  if (role !== "seller" || !params.session.employeeId) return false;
  if (params.assigneeIds.length && !params.assigneeIds.includes(params.session.employeeId)) return false;
  if (params.distributionMode === "split_evenly" && params.assignedEmployeeId) {
    return params.assignedEmployeeId === params.session.employeeId;
  }
  return true;
}
