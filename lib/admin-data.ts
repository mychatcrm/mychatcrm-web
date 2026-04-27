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
  | "apis"
  | "logs"
  | "seguranca";

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
  agentConversationsDaily: { dia: string; mariana: number; carlos: number; verao: number }[];
};

const baseDataset: AdminDataset = {
  clients: [
    {
      id: "cl-1",
      nome: "Marina Costa",
      email: "marina@odontoprime.com",
      empresa: "Odonto Prime",
      plano: "Master",
      status: "ativo",
      mrr: 369.9,
      cadastro: "03/01/2026",
      ultimoAcesso: "Hoje, 09:42",
      monthlyLeadUsagePct: 82,
      saude: 86,
      agentesAtivos: 3,
      limiteAgentes: 30,
      agentesMaisAtivos: ["Mariana - Apartamentos Zona Sul", "Carlos - Suporte Técnico"],
    },
    {
      id: "cl-2",
      nome: "Lucas Rios",
      email: "lucas@riosauto.com",
      empresa: "Rios Auto Center",
      plano: "Profissional",
      status: "inadimplente",
      mrr: 269.9,
      cadastro: "14/02/2026",
      ultimoAcesso: "Ontem, 16:14",
      monthlyLeadUsagePct: 61,
      saude: 47,
      agentesAtivos: 2,
      limiteAgentes: 3,
      agentesMaisAtivos: ["Bot Campanha Verão 2025"],
    },
    {
      id: "cl-3",
      nome: "Patricia Alves",
      email: "patricia@bella.com",
      empresa: "Bella Estetica",
      plano: "Master",
      status: "ativo",
      mrr: 369.9,
      cadastro: "26/12/2025",
      ultimoAcesso: "Hoje, 11:10",
      monthlyLeadUsagePct: 93,
      saude: 78,
      agentesAtivos: 4,
      limiteAgentes: 30,
      agentesMaisAtivos: ["Mariana - Apartamentos Zona Sul", "Bot Campanha Verão 2025"],
    },
  ],
  executiveStats: [
    { label: "MRR", value: "R$ 128.430", helper: "+8,4% vs mes anterior" },
    { label: "ARR", value: "R$ 1,54 mi", helper: "Base anualizada atual" },
    { label: "Clientes ativos", value: "348", helper: "+19 novos no mes" },
    { label: "Churn rate", value: "2,8%", helper: "-0,6 p.p. no mes" },
    { label: "LTV medio", value: "R$ 8.940", helper: "CAC medio R$ 1.120" },
    { label: "NPS", value: "72", helper: "Pesquisa trimestral" },
    { label: "Ticket medio", value: "R$ 338", helper: "Maior peso no plano Master" },
    { label: "Upgrade rate", value: "12,9%", helper: "Profissional para Master" },
    { label: "Clientes com risco", value: "18", helper: "Health score abaixo de 50" },
    { label: "Pagamentos falhos", value: "7", helper: "Ultimas 24h" },
  ],
  monthlyBars: [
    { label: "Jan", value: 42, color: "bg-sky-500" },
    { label: "Fev", value: 49, color: "bg-sky-500" },
    { label: "Mar", value: 61, color: "bg-sky-500" },
    { label: "Abr", value: 72, color: "bg-sky-500" },
    { label: "Mai", value: 88, color: "bg-sky-500" },
  ],
  alerts: [
    "12 clientes acima de 90% da cota mensal de leads atendidos",
    "3 bots offline ha mais de 1 hora",
    "4 tickets sem resposta ha mais de 4 horas",
    "7 renovacoes criticas nos proximos 7 dias",
  ],
  planDistribution: ["Master · 46%", "Profissional · 38%", "Trial · 16%"],
  channelRevenue: [
    "Organico · R$ 51.000",
    "Pago · R$ 42.000",
    "Indicacao · R$ 23.000",
    "Direto · R$ 12.430",
  ],
  recentActivity: [
    "Novo cliente cadastrado · Bella Estetica",
    "Upgrade realizado · Odonto Prime",
    "Cancelamento solicitado · Rios Auto Center",
    "Pagamento confirmado · ID Consultoria",
  ],
  analyticsStats: [
    { label: "Visitantes unicos", value: "42.180", helper: "GA mockado" },
    { label: "Landing > cadastro", value: "7,2%", helper: "Conversao principal" },
    { label: "Cadastro > pagante", value: "18,4%", helper: "Trial para assinatura" },
    { label: "Clientes em risco", value: "26", helper: "Sem login ha 7 dias" },
  ],
  acquisitionBars: [
    { label: "Organico", value: 43 },
    { label: "Pago", value: 31 },
    { label: "Referral", value: 17 },
    { label: "Direto", value: 9 },
  ],
  retentionBars: [
    { label: "Cohort Jan", value: 82 },
    { label: "Cohort Fev", value: 79 },
    { label: "Cohort Mar", value: 75 },
  ],
  revenueBars: [
    { label: "Novo MRR", value: 38 },
    { label: "Expansao", value: 22 },
    { label: "Contracao", value: 9 },
    { label: "Churn", value: 7 },
  ],
  teamMembers: [
    "Renato Lagares · Super Admin · ultimo acesso agora",
    "Ana Suporte · Suporte · ultimo acesso hoje 09:12",
    "Bruno Financeiro · Financeiro · ultimo acesso ontem 18:20",
  ],
  securitySessions: [
    "Chrome macOS · 187.32.20.11 · agora",
    "Safari iPhone · 191.55.14.8 · hoje 08:12",
  ],
  topAgents: [
    { nome: "Mariana - Apartamentos Zona Sul", cliente: "Odonto Prime", conversasDia: 89, origemPrincipal: "Lead Ads" },
    { nome: "Bot Campanha Verão 2025", cliente: "Bella Estetica", conversasDia: 74, origemPrincipal: "CTW" },
    { nome: "Carlos - Suporte Técnico", cliente: "Rios Auto Center", conversasDia: 58, origemPrincipal: "Keyword" },
  ],
  agentDistribution: [
    { faixa: "1 agente", totalClientes: 82 },
    { faixa: "2-5 agentes", totalClientes: 151 },
    { faixa: "6-15 agentes", totalClientes: 63 },
    { faixa: "16-30 agentes", totalClientes: 19 },
  ],
  agentOriginShare: [
    { origem: "Lead Ads", percentual: 42 },
    { origem: "CTW", percentual: 27 },
    { origem: "Keyword", percentual: 21 },
    { origem: "Orgânico", percentual: 10 },
  ],
  agentConversationsDaily: [
    { dia: "Seg", mariana: 55, carlos: 38, verao: 49 },
    { dia: "Ter", mariana: 60, carlos: 42, verao: 58 },
    { dia: "Qua", mariana: 63, carlos: 41, verao: 61 },
    { dia: "Qui", mariana: 71, carlos: 44, verao: 66 },
    { dia: "Sex", mariana: 68, carlos: 39, verao: 62 },
  ],
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
