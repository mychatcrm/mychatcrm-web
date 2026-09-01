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
    "ia",
    "equipe",
    "apis",
    "logs",
    "seguranca",
    "system-agent",
  ],
  financeiro: ["dashboard", "financeiro", "faturas", "pagamentos", "churn", "clientes", "inadimplentes", "parcerias", "ia"],
  suporte: ["dashboard", "clientes", "leads", "suporte", "comunicados"],
  marketing: ["dashboard", "analytics", "cupons", "parcerias", "comunicados", "notificacoes", "leads", "ia"],
  desenvolvedor: ["dashboard", "configuracoes", "apis", "logs", "seguranca", "ia", "system-agent"],
};

export function hasAdminAccessByRole(role: AdminRole, routeKey: string) {
  const allowed = ROLE_PERMISSION_MAP[role] ?? [];
  return allowed.includes("*") || allowed.includes(routeKey);
}
