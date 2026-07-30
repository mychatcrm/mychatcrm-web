import type { DashboardRouteKey } from "@/lib/dashboard-data";

const DASHBOARD_FIRST_SEGMENT: Record<string, DashboardRouteKey> = {
  overview: "overview",
  agentes: "agentes",
  conversas: "conversas",
  "integracoes-leads": "integracoes-leads",
  colaboradores: "colaboradores",
  equipes: "equipes",
  crm: "crm",
  "ofertas-ativas": "ofertas-ativas",
  agenda: "agenda",
  disparos: "disparos",
  lembretes: "lembretes",
  integracoes: "integracoes",
  configuracoes: "configuracoes",
  suporte: "suporte",
};

export function dashboardSegmentToRouteKey(segment: string): DashboardRouteKey | null {
  const key = segment.trim().toLowerCase();
  return DASHBOARD_FIRST_SEGMENT[key] ?? null;
}
