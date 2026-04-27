import type { ClientSession } from "@/lib/client-auth";
import { isMasterClient } from "@/lib/client-auth";

export type DashboardRouteKey =
  | "overview"
  | "agentes"
  | "conversas"
  | "integracoes-leads"
  | "colaboradores"
  | "crm"
  | "agenda"
  | "disparos"
  | "lembretes"
  | "integracoes"
  | "configuracoes"
  | "suporte";

/** Atribuição de marketing / canais (demo; em produção vem do integrador). */
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
  /**
   * Data em que o lead entrou no CRM (calendário local), `YYYY-MM-DD`.
   * Em demo, é gerada de forma determinística por id; em produção viria do backend.
   */
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
  /**
   * Agente (chatbot filho) que está a atender o lead neste momento.
   * Em demo inicia igual a `agenteEntrada`; com transferências ou automações pode divergir.
   */
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

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** Data local de entrada simulada por lead (demo), relativa a `anchor`. */
function demoLeadDataEntradaISO(leadId: string, anchor: Date) {
  const daysAgoById: Record<string, number> = {
    "lead-1": 0,
    "lead-2": 1,
    "lead-3": 0,
    "lead-4": 2,
    "lead-5": 5,
  };
  const d = new Date(anchor);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - (daysAgoById[leadId] ?? 12));
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

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
  leads: [
    {
      id: "lead-1",
      funilId: "funil-default",
      dataEntradaISO: "",
      nome: "Marina Costa",
      empresa: "Odonto Prime",
      telefone: "(62) 99911-2200",
      email: "marina@odontoprime.com",
      valor: 6800,
      status: "novo",
      tag: "Inbound",
      agenteEntrada: "Clara · Comercial",
      agenteAtendendo: "Clara · Comercial",
      responsavel: "Renato",
      ultimoContato: "Hoje, 10:20",
      proximaAcao: "Enviar proposta",
      origem: "WhatsApp orgânico",
      origemMarketing: {
        midia: "WhatsApp",
        campanha: "—",
        pagina: "Link wa.me / perfil da clínica",
        formulario: "—",
        tipoCliente: "Particular",
      },
      tags: ["Inbound", "Quente", "Demo"],
    },
    {
      id: "lead-2",
      funilId: "funil-default",
      dataEntradaISO: "",
      nome: "Lucas Rios",
      empresa: "Rios Auto Center",
      telefone: "(11) 99111-7733",
      email: "lucas@riosauto.com",
      valor: 9200,
      status: "contato",
      tag: "WhatsApp",
      agenteEntrada: "Max · Vendas",
      agenteAtendendo: "Max · Vendas",
      responsavel: "Camila",
      ultimoContato: "Ontem, 17:40",
      proximaAcao: "Agendar demo",
      origem: "Indicação",
      origemMarketing: {
        midia: "Facebook",
        campanha: "[13/04/26][MCMV][Goiânia 20 km][Ambos Sex de 25 a 44]",
        pagina: "Renato Lagares",
        formulario: "[#01][Formulário MCMV][My Broker Office]",
        tipoCliente: "",
      },
      tags: ["WhatsApp", "B2B"],
    },
    {
      id: "lead-3",
      funilId: "funil-default",
      dataEntradaISO: "",
      nome: "Patricia Alves",
      empresa: "Bella Estetica",
      telefone: "(31) 98888-5512",
      email: "patricia@bella.com",
      valor: 4300,
      status: "negociacao",
      tag: "Campanha",
      agenteEntrada: "Luma · Suporte",
      agenteAtendendo: "Luma · Suporte",
      responsavel: "Renato",
      ultimoContato: "Hoje, 08:15",
      proximaAcao: "Follow-up no WhatsApp",
      origem: "Meta Lead Ads",
      origemMarketing: {
        midia: "Instagram / Meta",
        campanha: "[Campanha][Salão][Lookalike 1%][Mulheres 25–54]",
        pagina: "Bella Estética Oficial",
        formulario: "[#12][Lead Ads instantâneo]",
        tipoCliente: "B2C",
      },
      tags: ["Campanha", "Salão", "Humano"],
    },
    {
      id: "lead-4",
      funilId: "funil-default",
      dataEntradaISO: "",
      nome: "Fabio Nunes",
      empresa: "Nunes Imoveis",
      telefone: "(21) 97777-2244",
      email: "fabio@nunesimoveis.com",
      valor: 12400,
      status: "proposta",
      tag: "Premium",
      agenteEntrada: "Max · Vendas",
      agenteAtendendo: "Max · Vendas",
      responsavel: "Lia",
      ultimoContato: "2 dias atras",
      proximaAcao: "Revisar contrato",
      origem: "Landing page",
      origemMarketing: {
        midia: "Google / orgânico",
        campanha: "—",
        pagina: "Landing «Imóveis premium ZS»",
        formulario: "[#03][Formulário qualificado]",
        tipoCliente: "Investidor",
      },
      tags: ["Premium", "Imóveis"],
    },
    {
      id: "lead-5",
      funilId: "funil-default",
      dataEntradaISO: "",
      nome: "Isabela Duarte",
      empresa: "ID Consultoria",
      telefone: "(41) 99888-4400",
      email: "isa@idconsultoria.com",
      valor: 5600,
      status: "fechado",
      tag: "B2B",
      agenteEntrada: "Clara · Comercial",
      /** Demo: transferência entre agentes modelo (entrada ≠ atende). */
      agenteAtendendo: "Max · Vendas",
      responsavel: "Camila",
      ultimoContato: "Hoje, 11:45",
      proximaAcao: "Onboarding",
      origem: "Formulário site",
      origemMarketing: {
        midia: "Site",
        campanha: "—",
        pagina: "mychatcrm.com / contato",
        formulario: "[#99][Contato B2B]",
        tipoCliente: "Empresa",
      },
      tags: ["B2B", "Ganho"],
    },
  ],
  quickReplies: [
    { id: "qr-1", titulo: "/boasvindas", mensagem: "Ola! Obrigado pelo contato. Posso te mostrar como a plataforma funciona." },
    { id: "qr-2", titulo: "/precos", mensagem: "Temos planos Profissional e Master. Posso te enviar um comparativo rapido." },
    { id: "qr-3", titulo: "/demo", mensagem: "Perfeito. Qual horario funciona melhor para uma demonstracao de 20 minutos?" },
  ],
  trainingFiles: [
    { nome: "faq-clinica.pdf", status: "ativo" },
    { nome: "objeções-comerciais.docx", status: "processando" },
    { nome: "lista-planos.csv", status: "erro" },
  ],
  overviewMetrics: [
    { label: "Conversas concluídas", value: "184", helper: "Atendimentos encerrados no período. +12% vs. período anterior (demo)." },
    { label: "Contatos ativos", value: "1.247", helper: "Pessoas diferentes que falaram com você no WhatsApp neste intervalo." },
    { label: "Pico de demanda", value: "5.912", helper: "Maior volume diário registrado — ajuda a dimensionar equipe e horário." },
    { label: "Novos leads", value: "23", helper: "Entraram no funil agora. Ex.: 7 vindos de campanha (dados de demonstração)." },
    { label: "Resposta do bot", value: "93,8%", helper: "Das mensagens recebidas, quantas o bot respondeu sozinho, sem fila." },
    { label: "Leads em oportunidade", value: "14,6%", helper: "Percentual que avançou para proposta ou negociação neste período." },
    { label: "Mensagens trocadas", value: "18.430", helper: "Total automático + manual no período. Inclui envios da equipe (demo)." },
  ],
  conversationBars: [
    { label: "Semana 1", value: 42 },
    { label: "Semana 2", value: 57 },
    { label: "Semana 3", value: 69 },
    { label: "Semana 4", value: 78 },
    { label: "Ultimos 2 dias", value: 64 },
  ],
  funnelBars: [
    { label: "Novo Lead", value: 28, secondary: 18 },
    { label: "Contato Feito", value: 35, secondary: 15 },
    { label: "Proposta", value: 22, secondary: 10 },
    { label: "Negociacao", value: 16, secondary: 6 },
  ],
  recentConversations: [
    ["Julia da Costa", "respondido"],
    ["Arthur Clinica", "pendente"],
    ["Bianca Leads", "handoff"],
    ["Rafael Auto", "respondido"],
    ["Fernanda Estudio", "pendente"],
  ],
  alerts: [
    "Uso de leads acima de 80% da cota mensal",
    "Integracao Gmail com 2 falhas nas ultimas 24h",
    "Bot entrou em modo manual ontem as 19:12",
  ],
  agendaItems: [
    "13:30 · Demo com Odonto Prime",
    "15:00 · Follow-up Bella Estetica",
    "17:40 · Reuniao de onboarding",
  ],
  historyContacts: ["Marina Costa", "Lucas Rios", "Patricia Alves", "Isabela Duarte"],
  supportTickets: [
    "#SUP-1024 · Integracao Gmail · Em andamento",
    "#SUP-1017 · Ajuste de horario do bot · Resolvido",
    "#SUP-1008 · Duvida de faturamento · Resolvido",
  ],
  knowledgeBase: [
    "Como conectar o WhatsApp oficial",
    "Como treinar a IA com arquivos",
    "Como criar campanhas em massa",
  ],
  integrationGroups: {
    "CRM e Vendas": ["Google Agenda", "Pipedrive", "HubSpot", "RD Station"],
    Automacao: ["Zapier", "Make", "n8n"],
    Comunicacao: ["Gmail", "Outlook SMTP"],
    Personalizado: ["Webhook proprio", "API Key do cliente"],
  },
  reportRows: [
    ["Relatorio de conversas", "Ultimos 30 dias", "CSV"],
    ["Relatorio de leads", "Status, origem, valor", "CSV"],
    ["Conversao do funil", "Etapas e perdas", "PDF mockado"],
    ["Leads atendidos", "Consumo por dia", "CSV"],
    ["Performance do bot", "Resposta e satisfacao", "PDF mockado"],
  ],
  reminderItems: [
    "Renovacao D-7 · ativo",
    "Lead sem resposta por 3 dias · ativo",
    "Follow-up semanal de oportunidades · pausado",
  ],
  campaignItems: ["Campanha Abril", "Reativacao Base Fria", "Clientes VIP"],
  funnelSteps: ["Novo Lead", "Qualificacao", "Proposta enviada", "Negociacao", "Fechamento"],
  funnelMetrics: [
    { label: "Novo Lead", value: 92 },
    { label: "Qualificacao", value: 71 },
    { label: "Proposta enviada", value: 54 },
    { label: "Negociacao", value: 38 },
    { label: "Fechamento", value: 24 },
  ],
};

export function getDashboardDataset(session: ClientSession): DashboardDataset {
  const entradaAnchor = new Date();
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
    leads: baseDataset.leads.map((lead) => ({
      ...lead,
      dataEntradaISO: demoLeadDataEntradaISO(lead.id, entradaAnchor),
      /** Garante coerência se o backend enviar só entrada; o CRM Kanban usa `agenteAtendendo`. */
      agenteAtendendo: lead.agenteAtendendo || lead.agenteEntrada,
      empresa: session.companyName === "MyChatCRM Demo" ? lead.empresa : `${lead.empresa} · ${session.companyName}`,
    })),
    integrationGroups: Object.fromEntries(
      Object.entries(baseDataset.integrationGroups).map(([key, values]) => [key, [...values]]),
    ),
  };

  if (isMasterClient(session)) {
    dataset.reportRows = [
      ...dataset.reportRows.slice(0, 4),
      ["Campanhas", "Disparos e respostas", "CSV"],
      ...dataset.reportRows.slice(4),
    ];
  }

  return dataset;
}
