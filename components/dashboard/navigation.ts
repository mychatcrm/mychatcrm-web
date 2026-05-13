export type DashboardNavItem = {
  href: string;
  label: string;
  /** Título no cabeçalho do painel quando diferente do rótulo do menu. */
  headerTitle?: string;
  short: string;
  masterOnly?: boolean;
  routeKey: string;
};

export type DashboardNavGroup = {
  title: string;
  items: DashboardNavItem[];
};

/** Itens sempre visíveis no topo da sidebar (sem título de secção). */
export const dashboardNavPinnedItems: DashboardNavItem[] = [
  { href: "/dashboard", label: "Relatório", short: "VG", routeKey: "overview" },
  { href: "/dashboard/crm", label: "CRM Kanban", short: "CRM", routeKey: "crm" },
  { href: "/dashboard/ofertas-ativas", label: "Ofertas ativas", short: "OA", routeKey: "ofertas-ativas" },
  { href: "/dashboard/agentes", label: "Agentes", short: "AG", routeKey: "agentes" },
  {
    href: "/dashboard/conversas",
    label: "Conversas",
    headerTitle: "Conversas em tempo real (WhatsApp)",
    short: "CV",
    routeKey: "conversas",
  },
  {
    href: "/dashboard/integracoes-leads",
    label: "Integrações de Leads",
    headerTitle: "Configurações para distribuição de leads",
    short: "IL",
    routeKey: "integracoes-leads",
  },
  {
    href: "/dashboard/colaboradores",
    label: "Colaboradores",
    headerTitle: "Colaboradores que recebem leads",
    short: "EQ",
    routeKey: "colaboradores",
  },
  {
    href: "/dashboard/disparos",
    label: "Disparos em Massa",
    short: "DM",
    routeKey: "disparos",
  },
  { href: "/dashboard/agenda", label: "Agenda", short: "AD", routeKey: "agenda" },
  {
    href: "/dashboard/lembretes",
    label: "Lembretes",
    short: "LB",
    routeKey: "lembretes",
  },
  { href: "/dashboard/integracoes", label: "Integrações", short: "IN", routeKey: "integracoes" },
  { href: "/dashboard/suporte", label: "Suporte", short: "SP", routeKey: "suporte" },
];

/** Secções colapsáveis (vazio: Integrações e Suporte passaram para o bloco fixo acima). */
export const dashboardNavGroups: DashboardNavGroup[] = [];

export function getDashboardRouteLabel(routeKey: string) {
  if (routeKey === "configuracoes") return "Configurações";
  const pinned = dashboardNavPinnedItems.find((entry) => entry.routeKey === routeKey);
  if (pinned) return pinned.headerTitle ?? pinned.label;
  for (const group of dashboardNavGroups) {
    const item = group.items.find((entry) => entry.routeKey === routeKey);
    if (item) return item.headerTitle ?? item.label;
  }
  return "Painel do cliente";
}
