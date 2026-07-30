/** Papel na conta: dono (pleno), direção, gestão ou vendedor (acesso restrito). */
export type OrganizationRole = "owner" | "director" | "manager" | "seller";

// "conversas" só entrou aqui depois que a inbox passou a ser recortada no
// servidor (lib/server/access-scope.ts): o vendedor vê apenas as conversas dos
// leads atribuídos a ele, e pode pausar o agente para assumir o atendimento.
const SELLER_ROUTE_KEYS = new Set([
  "crm",
  "conversas",
  "ofertas-ativas",
  "agenda",
  "lembretes",
  "suporte",
]);

const MANAGER_OR_DIRECTOR_ROUTE_KEYS = new Set([
  "overview",
  "crm",
  "ofertas-ativas",
  "agentes",
  "conversas",
  "integracoes-leads",
  "disparos",
  "agenda",
  "lembretes",
  "integracoes",
  "suporte",
]);

export function resolveOrganizationRole(session: {
  organizationRole?: OrganizationRole;
  /** Colaborador com sessão live: nunca assumir «dono» por omissão. */
  employeeId?: string;
}): OrganizationRole {
  if (session.organizationRole) return session.organizationRole;
  if (session.employeeId) return "seller";
  return "owner";
}

/** Rotas sob `/dashboard/:segment` (segmento vazio = relatório / overview). */
export function organizationRoleCanAccessDashboardRoute(role: OrganizationRole, routeKey: string): boolean {
  if (role === "owner") return true;
  if (role === "seller") return SELLER_ROUTE_KEYS.has(routeKey);
  if (role === "director" || role === "manager") return MANAGER_OR_DIRECTOR_ROUTE_KEYS.has(routeKey);
  return false;
}

export function organizationRoleCanAccessPersonalSettings(role: OrganizationRole): boolean {
  return role === "owner";
}

/** Titular da conta: role owner ou director raiz (sem superior na hierarquia). */
export function sessionCanAccessPersonalSettings(session: {
  organizationRole?: OrganizationRole;
  employeeId?: string;
  reportsToEmployeeId?: string;
}): boolean {
  const role = resolveOrganizationRole(session);
  return (
    organizationRoleCanAccessPersonalSettings(role) ||
    (role === "director" && !session.reportsToEmployeeId)
  );
}

/** Acesso a rotas do dashboard incluindo configurações do titular (director raiz). */
export function sessionCanAccessDashboardRoute(
  session: {
    organizationRole?: OrganizationRole;
    employeeId?: string;
    reportsToEmployeeId?: string;
  },
  routeKey: string,
): boolean {
  const role = resolveOrganizationRole(session);
  if (organizationRoleCanAccessDashboardRoute(role, routeKey)) return true;
  return routeKey === "configuracoes" && sessionCanAccessPersonalSettings(session);
}

/** Diretor, gerente e vendedor: ajustes pessoais rápidos na sidebar (sem rota de configurações completas do dono). */
export function organizationRoleCanUseSidebarProfilePopover(role: OrganizationRole): boolean {
  return role === "director" || role === "manager" || role === "seller";
}

export function defaultDashboardPathForOrganizationRole(role: OrganizationRole): string {
  if (role === "seller") return "/dashboard/crm";
  return "/dashboard";
}
