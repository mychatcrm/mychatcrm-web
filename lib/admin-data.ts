import type { AdminRole, AdminSession } from "@/lib/admin-auth";

export type AdminRouteKey =
  | "dashboard"
  | "analytics"
  | "clientes"
  | "leads"
  | "inadimplentes"
  | "cancelamentos"
  | "planos"
  | "enterprise"
  | "cupons"
  | "parcerias"
  | "features"
  | "financeiro"
  | "faturas"
  | "pagamentos"
  | "churn"
  | "suporte"
  | "comunicados"
  | "notificacoes"
  | "configuracoes"
  | "equipe"
  | "ia"
  | "apis"
  | "logs"
  | "seguranca"
  | "system-agent";

export type AdminClientRow = {
  id: string;
  nome: string;
  email: string;
  empresa: string;
  plano: "Profissional" | "Master";
  status: "ativo" | "inadimplente" | "cancelado" | "trial";
  mrr: number;
  cadastro: string;
  ultimoAcesso: string;
  /** Percentagem aproximada da cota mensal de leads atendidos já utilizada (0–100). */
  monthlyLeadUsagePct: number;
  saude: number;
  agentesAtivos: number;
  limiteAgentes: number;
  agentesMaisAtivos: string[];
};

export type AdminDataset = {
  clients: AdminClientRow[];
  executiveStats: { label: string; value: string; helper: string }[];
  monthlyBars: { label: string; value: number; color?: string }[];
  alerts: string[];
  planDistribution: string[];
  channelRevenue: string[];
  recentActivity: string[];
  analyticsStats: { label: string; value: string; helper: string }[];
  acquisitionBars: { label: string; value: number }[];
  retentionBars: { label: string; value: number }[];
  revenueBars: { label: string; value: number }[];
  teamMembers: string[];
  securitySessions: string[];
  topAgents: { nome: string; cliente: string; conversasDia: number; origemPrincipal: string }[];
  agentDistribution: { faixa: string; totalClientes: number }[];
  agentOriginShare: { origem: string; percentual: number }[];
  agentConversationsDaily: { dia: string; counts: Record<string, number> }[];
};

const ADMIN_EMPTY_HELPER =
  "Sem dados agregados. Conecte fontes reais (billing, analytics, CRM) para preencher estes indicadores.";

const baseDataset: AdminDataset = {
  clients: [],
  executiveStats: [
    { label: "MRR", value: "—", helper: ADMIN_EMPTY_HELPER },
    { label: "ARR", value: "—", helper: ADMIN_EMPTY_HELPER },
    { label: "Clientes ativos", value: "0", helper: ADMIN_EMPTY_HELPER },
    { label: "Churn rate", value: "—", helper: ADMIN_EMPTY_HELPER },
    { label: "LTV medio", value: "—", helper: ADMIN_EMPTY_HELPER },
    { label: "NPS", value: "—", helper: ADMIN_EMPTY_HELPER },
    { label: "Ticket medio", value: "—", helper: ADMIN_EMPTY_HELPER },
    { label: "Upgrade rate", value: "—", helper: ADMIN_EMPTY_HELPER },
    { label: "Clientes com risco", value: "0", helper: ADMIN_EMPTY_HELPER },
    { label: "Pagamentos falhos", value: "0", helper: ADMIN_EMPTY_HELPER },
  ],
  monthlyBars: [],
  alerts: [],
  planDistribution: [],
  channelRevenue: [],
  recentActivity: [],
  analyticsStats: [
    { label: "Visitantes unicos", value: "—", helper: ADMIN_EMPTY_HELPER },
    { label: "Landing > cadastro", value: "—", helper: ADMIN_EMPTY_HELPER },
    { label: "Cadastro > pagante", value: "—", helper: ADMIN_EMPTY_HELPER },
    { label: "Clientes em risco", value: "0", helper: ADMIN_EMPTY_HELPER },
  ],
  acquisitionBars: [],
  retentionBars: [],
  revenueBars: [],
  teamMembers: [],
  securitySessions: [],
  topAgents: [],
  agentDistribution: [],
  agentOriginShare: [],
  agentConversationsDaily: [],
};

function roleClientView(role: AdminRole) {
  switch (role) {
    case "financeiro":
      return baseDataset.clients.filter((client) => client.status !== "trial");
    case "suporte":
      return baseDataset.clients.map((client) => ({
        ...client,
        mrr: client.mrr,
        monthlyLeadUsagePct: client.monthlyLeadUsagePct,
      }));
    default:
      return baseDataset.clients;
  }
}

export function getAdminDataset(session: AdminSession): AdminDataset {
  return {
    ...baseDataset,
    clients: roleClientView(session.role).map((client) => ({ ...client })),
    executiveStats: [...baseDataset.executiveStats],
    monthlyBars: [...baseDataset.monthlyBars],
    alerts: [...baseDataset.alerts],
    planDistribution: [...baseDataset.planDistribution],
    channelRevenue: [...baseDataset.channelRevenue],
    recentActivity: [...baseDataset.recentActivity],
    analyticsStats: [...baseDataset.analyticsStats],
    acquisitionBars: [...baseDataset.acquisitionBars],
    retentionBars: [...baseDataset.retentionBars],
    revenueBars: [...baseDataset.revenueBars],
    teamMembers: [...baseDataset.teamMembers],
    securitySessions: [...baseDataset.securitySessions],
    topAgents: [...baseDataset.topAgents],
    agentDistribution: [...baseDataset.agentDistribution],
    agentOriginShare: [...baseDataset.agentOriginShare],
    agentConversationsDaily: [...baseDataset.agentConversationsDaily],
  };
}
