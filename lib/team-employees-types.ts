/**
 * Tipos e constantes partilhados para colaboradores (hierarquia por tenant).
 */

export const MAX_ORG_DIRECTORS = 5;
export const MAX_ORG_MANAGERS = 25;
export const MAX_ORG_SELLERS = 625;

export const MAX_TEAM_EMPLOYEES = MAX_ORG_DIRECTORS + MAX_ORG_MANAGERS + MAX_ORG_SELLERS;

export const TEAM_EMPLOYEES_UPDATED_EVENT = "mychatcrm-team-employees-updated";

export const TEAM_EMPLOYEE_DELETE_CONFIRM_PHRASE = "QUERO APAGAR";

export type TeamHierarchyRole = "director" | "manager" | "seller";

export type TeamEmployee = {
  id: string;
  nome: string;
  email: string;
  funcao: string;
  /** Em disco no servidor; na API pública vem vazio com `hasInitialPassword`. */
  initialPassword: string;
  /** Presente nas respostas `GET /api/team-employees` (nunca envia a senha em claro). */
  hasInitialPassword?: boolean;
  ativo: boolean;
  hierarchyRole: TeamHierarchyRole;
  reportsToId?: string;
  accountSuspended?: boolean;
  /**
   * Titular da conta (quem assinou o plano). Um por tenant, garantido pelo
   * índice parcial `tenant_members_single_owner_per_tenant`. É o que dá o papel
   * `owner` na sessão — antes isso era inferido só para tenants Enterprise.
   */
  isOwner?: boolean;
};

export type AddTeamEmployeeInput = {
  nome: string;
  email: string;
  funcao: string;
  initialPassword: string;
  hierarchyRole: TeamHierarchyRole;
  reportsToId?: string;
};
