export type AdminNavItem = {
  href: string;
  label: string;
  routeKey: string;
  ownerOnly?: boolean;
};

export type AdminNavGroup = {
  title: string;
  items: AdminNavItem[];
};

export const adminNavGroups: AdminNavGroup[] = [
  {
    title: "Visão Geral",
    items: [
      { href: "/admin", label: "Inteligência da plataforma", routeKey: "dashboard" },
      { href: "/admin/analytics", label: "Analytics", routeKey: "analytics" },
    ],
  },
  {
    title: "Clientes",
    items: [
      { href: "/admin/clientes", label: "Todos os Clientes", routeKey: "clientes" },
      { href: "/admin/leads", label: "Novos Leads", routeKey: "leads" },
      { href: "/admin/leads-lancamento", label: "Leads (pré-lançamento)", routeKey: "leads-lancamento" },
      { href: "/admin/inadimplentes", label: "Inadimplentes", routeKey: "inadimplentes" },
      { href: "/admin/cancelamentos", label: "Cancelamentos", routeKey: "cancelamentos" },
    ],
  },
  {
    title: "Produto",
    items: [
      { href: "/admin/planos", label: "Planos", routeKey: "planos" },
      { href: "/admin/enterprise", label: "Enterprise (contas)", routeKey: "enterprise" },
      { href: "/admin/cupons", label: "Cupons e Descontos", routeKey: "cupons" },
      { href: "/admin/parcerias", label: "Parcerias & Afiliados", routeKey: "parcerias" },
      { href: "/admin/features", label: "Features", routeKey: "features" },
    ],
  },
  {
    title: "Financeiro",
    items: [
      { href: "/admin/financeiro", label: "Receita", routeKey: "financeiro" },
      { href: "/admin/faturas", label: "Faturas", routeKey: "faturas" },
      { href: "/admin/pagamentos", label: "Pagamentos", routeKey: "pagamentos" },
      { href: "/admin/churn", label: "Churn", routeKey: "churn" },
    ],
  },
  {
    title: "Operações",
    items: [
      { href: "/admin/suporte", label: "Suporte / Tickets", routeKey: "suporte" },
      { href: "/admin/comunicados", label: "Comunicados", routeKey: "comunicados" },
      { href: "/admin/notificacoes", label: "Notificações Push", routeKey: "notificacoes" },
    ],
  },
  {
    title: "Sistema",
    items: [
      { href: "/admin/configuracoes", label: "Configurações", routeKey: "configuracoes" },
      { href: "/admin/ia", label: "IA: consumo e custos", routeKey: "ia" },
      { href: "/admin/equipe", label: "Equipe", routeKey: "equipe" },
      { href: "/admin/apis", label: "API & Integrações", routeKey: "apis" },
      { href: "/admin/logs", label: "Auditoria operacional", routeKey: "logs", ownerOnly: true },
      { href: "/admin/system-agent", label: "Agente do Sistema", routeKey: "system-agent" },
      { href: "/admin/seguranca", label: "Segurança", routeKey: "seguranca" },
    ],
  },
];

export function getAdminRouteLabel(routeKey: string) {
  for (const group of adminNavGroups) {
    const item = group.items.find((entry) => entry.routeKey === routeKey);
    if (item) return item.label;
  }
  return "Painel administrativo";
}
