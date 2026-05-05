export type AdminRole =
  | "super_admin"
  | "admin"
  | "financeiro"
  | "suporte"
  | "marketing"
  | "desenvolvedor";

const ROLE_PERMISSION_MAP: Record<AdminRole, string[]> = {
  super_admin: ["*"],
  admin: [
    "dashboard",
    "analytics",
    "clientes",
    "leads",
    "inadimplentes",
    "cancelamentos",
    "planos",
    "enterprise",
    "cupons",
    "parcerias",
    "features",
    "financeiro",
    "faturas",
    "pagamentos",
    "churn",
    "suporte",
    "comunicados",
    "notificacoes",
    "configuracoes",
    "apis",
    "logs",
    "seguranca",
  ],
  financeiro: ["dashboard", "financeiro", "faturas", "pagamentos", "churn", "clientes", "inadimplentes", "parcerias"],
  suporte: ["dashboard", "clientes", "leads", "suporte", "comunicados"],
  marketing: ["dashboard", "analytics", "cupons", "parcerias", "comunicados", "notificacoes", "leads"],
  desenvolvedor: ["dashboard", "configuracoes", "apis", "logs", "seguranca"],
};

export function hasAdminAccessByRole(role: AdminRole, routeKey: string) {
  const allowed = ROLE_PERMISSION_MAP[role] ?? [];
  return allowed.includes("*") || allowed.includes(routeKey);
}
