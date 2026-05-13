import type { ClientSession } from "@/lib/client-auth";
import { isMasterClient } from "@/lib/client-auth";

export type DashboardRouteKey =
  | "overview"
  | "agentes"
  | "conversas"
  | "integracoes-leads"
  | "colaboradores"
  | "crm"
  | "ofertas-ativas"
  | "agenda"
  | "disparos"
  | "lembretes"
  | "integracoes"
  | "configuracoes"
  | "suporte";

/** Atribuição de marketing / canais (preenchida quando o integrador estiver ligado). */
export type CrmLeadOrigemMarketing = {
  midia?: string;
  campanha?: string;
  pagina?: string;
  formulario?: string;
  tipoCliente?: string;
};

/** Texto de «responsável» quando o colaborador foi removido — o lead permanece no CRM para reatribuição manual. */
export const CRM_LEAD_SEM_OWNER_LABEL = "(Sem responsável)";

export type ClientLead = {
  id: string;
  /** Funil de vendas (CRM) a que este lead pertence — id em `lib/crm-funnels`. */
  funilId: string;
  /** Data em que o lead entrou no CRM (calendário local), `YYYY-MM-DD`. */
  dataEntradaISO: string;
  nome: string;
  empresa: string;
  telefone: string;
  email: string;
  valor: number;
  /** Id da coluna do pipeline deste funil (`CrmFunnelColumn.id`). */
  status: string;
  tag: string;
  /** Agente (chatbot filho / IA) que recebeu o contacto na entrada (canal ou regra de entrada). */
  agenteEntrada: string;
  /** Agente (chatbot filho) que está a atender o lead neste momento. */
  agenteAtendendo: string;
  responsavel: string;
  /** Colaborador humano (id em Colaboradores). Opcional: leads antigos usam só o nome em `responsavel`. */
  ownerEmployeeId?: string;
  ultimoContato: string;
  proximaAcao: string;
  origem: string;
  /** Detalhe de origem (mídia, campanha, página, formulário). */
  origemMarketing?: CrmLeadOrigemMarketing;
  tags: string[];
};

const EMPTY_HELPER =
  "Sem dados agregados neste período. Os números passam a refletir a operação quando as integrações e o CRM estiverem em uso.";

export type DashboardDataset = {
  tenantId: string;
  kanbanColumns: string[];
  leads: ClientLead[];
  quickReplies: { id: string; titulo: string; mensagem: string }[];
  trainingFiles: { nome: string; status: string }[];
  overviewMetrics: { label: string; value: string; helper: string }[];
  conversationBars: { label: string; value: number }[];
  funnelBars: { label: string; value: number; secondary?: number }[];
  recentConversations: [string, string][];
  alerts: string[];
  agendaItems: string[];
  historyContacts: string[];
  supportTickets: string[];
  knowledgeBase: string[];
  integrationGroups: Record<string, string[]>;
  reportRows: [string, string, string][];
  reminderItems: string[];
  campaignItems: string[];
  funnelSteps: string[];
  funnelMetrics: { label: string; value: number }[];
};

const baseDataset: DashboardDataset = {
  tenantId: "tenant-demo",
  kanbanColumns: ["Novo Lead", "Contato Feito", "Proposta", "Negociacao", "Ganho", "Perdido"],
  leads: [],
  quickReplies: [],
  trainingFiles: [],
  overviewMetrics: [
    { label: "Conversas concluídas", value: "0", helper: EMPTY_HELPER },
    { label: "Contatos ativos", value: "0", helper: EMPTY_HELPER },
    { label: "Pico de demanda", value: "—", helper: EMPTY_HELPER },
    { label: "Novos leads", value: "0", helper: EMPTY_HELPER },
    { label: "Resposta do bot", value: "—", helper: EMPTY_HELPER },
    { label: "Leads em oportunidade", value: "—", helper: EMPTY_HELPER },
    { label: "Mensagens trocadas", value: "0", helper: EMPTY_HELPER },
  ],
  conversationBars: [],
  funnelBars: [],
  recentConversations: [],
  alerts: [],
  agendaItems: [],
  historyContacts: [],
  supportTickets: [],
  knowledgeBase: [],
  integrationGroups: {},
  reportRows: [],
  reminderItems: [],
  campaignItems: [],
  funnelSteps: ["Novo Lead", "Qualificacao", "Proposta enviada", "Negociacao", "Fechamento"],
  funnelMetrics: [],
};

export function getDashboardDataset(session: ClientSession): DashboardDataset {
  const dataset: DashboardDataset = {
    ...baseDataset,
    tenantId: session.tenantId,
    quickReplies: [...baseDataset.quickReplies],
    trainingFiles: [...baseDataset.trainingFiles],
    overviewMetrics: [...baseDataset.overviewMetrics],
    conversationBars: [...baseDataset.conversationBars],
    funnelBars: [...baseDataset.funnelBars],
    recentConversations: [...baseDataset.recentConversations],
    alerts: [...baseDataset.alerts],
    agendaItems: [...baseDataset.agendaItems],
    historyContacts: [...baseDataset.historyContacts],
    supportTickets: [...baseDataset.supportTickets],
    knowledgeBase: [...baseDataset.knowledgeBase],
    reportRows: [...baseDataset.reportRows],
    reminderItems: [...baseDataset.reminderItems],
    campaignItems: [...baseDataset.campaignItems],
    funnelSteps: [...baseDataset.funnelSteps],
    funnelMetrics: [...baseDataset.funnelMetrics],
    kanbanColumns: [...baseDataset.kanbanColumns],
    leads: [],
    integrationGroups: Object.fromEntries(
      Object.entries(baseDataset.integrationGroups).map(([key, values]) => [key, [...values]]),
    ),
  };

  if (isMasterClient(session)) {
    dataset.reportRows = [
      ...dataset.reportRows,
      ["Campanhas", "Disparos e respostas", "CSV"],
    ];
  }

  return dataset;
}
