import type { AdminRouteKey } from "@/lib/admin-data";

const ADMIN_FIRST_SEGMENT: Record<string, AdminRouteKey> = {
  dashboard: "dashboard",
  analytics: "analytics",
  clientes: "clientes",
  leads: "leads",
  inadimplentes: "inadimplentes",
  cancelamentos: "cancelamentos",
  planos: "planos",
  enterprise: "enterprise",
  cupons: "cupons",
  parcerias: "parcerias",
  features: "features",
  financeiro: "financeiro",
  faturas: "faturas",
  pagamentos: "pagamentos",
  churn: "churn",
  suporte: "suporte",
  comunicados: "comunicados",
  notificacoes: "notificacoes",
  configuracoes: "configuracoes",
  equipe: "equipe",
  ia: "ia",
  apis: "apis",
  logs: "logs",
  seguranca: "seguranca",
};

export function adminSegmentToRouteKey(segment: string): AdminRouteKey | null {
  const key = segment.trim().toLowerCase();
  return ADMIN_FIRST_SEGMENT[key] ?? null;
}
