export type UserRole = "client" | "admin";

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  role: UserRole;
  planId: "solo" | "equipa" | "escala" | "enterprise";
  companyName: string;
}

export interface Plan {
  id: string;
  name: string;
  priceMonthly: number;
  subscriberCount: number;
  status: "ativo" | "inativo";
  monthlyLeadLimit: number;
  features: string[];
  badge?: string;
  displayOrder: number;
  highlight?: boolean;
}

export interface ClientRow {
  id: string;
  name: string;
  email: string;
  company: string;
  plan: string;
  status: "ativo" | "inadimplente" | "cancelado";
  signupAt: string;
  nextCharge: string;
  leadsAttendedThisMonth: number;
  monthlyLeadLimit: number;
}

export interface PaymentRow {
  id: string;
  clientName: string;
  amount: number;
  plan: string;
  status: "pago" | "pendente" | "falhou";
  date: string;
}

export interface Ticket {
  id: string;
  clientName: string;
  subject: string;
  priority: "baixa" | "media" | "alta";
  status: "aberto" | "em_andamento" | "resolvido";
  openedAt: string;
  messages: { author: string; body: string; at: string }[];
}

export interface Conversation {
  id: string;
  contact: string;
  preview: string;
  status: "aberta" | "resolvida" | "manual";
  updatedAt: string;
}

export type KanbanColumnId = "novo" | "contato" | "proposta" | "negociacao" | "fechado" | "perdido";

export interface LeadMetric {
  day: string;
  count: number;
}

export interface IntegrationStatus {
  id: string;
  name: string;
  connected: boolean;
}

export type AgentStatus = "ativo" | "pausado" | "inativo";

export type AgentObjective =
  | "gerar_leads"
  | "vender"
  | "suporte"
  | "agendar"
  | "qualificar"
  | "reengajar"
  | "atendimento_geral";

export type OriginType = "lead_ads" | "ctw" | "keyword" | "organico" | "crm";

export type AgentGender = "feminino" | "masculino" | "neutro";

export type TrainingFileFormat =
  | "pdf"
  | "txt"
  | "docx"
  | "faq"
  | "xlsx"
  | "pptx"
  | "xml"
  | "md"
  | "adoc"
  | "html"
  | "csv"
  | "png"
  | "jpeg"
  | "tiff"
  | "bmp";

export interface TrainingFile {
  id: string;
  nome: string;
  tipo: TrainingFileFormat;
  status: "processando" | "ativo" | "erro";
  tamanhoKb: number;
}

export interface KeywordRule {
  id: string;
  tipo: "igual" | "contem";
  keyword: string;
  link: string;
  qrCode?: string;
}

export interface AgentOrigin {
  tipo: OriginType;
  ativo: boolean;
  config: {
    formIds?: string[];
    adIds?: string[];
    keywords?: KeywordRule[];
    enviarPrimeiro?: boolean;
    delayPrimeiro?: number;
    mensagemInicial?: string;
  };
}

export interface FlowAction {
  id: string;
  tipo: "kanban" | "tag" | "notificar_humano" | "enviar_material" | "follow_up";
  valor: string;
}

export interface FlowStep {
  id: string;
  nome: string;
  objetivo: string;
  perguntas: string[];
  condicaoAvancar: "perguntas" | "mensagens" | "manual";
  acoesAoCompletar: FlowAction[];
  ordem: number;
}

export interface FollowUp {
  ordem: number;
  delayHoras: number;
  mensagem: string;
}

/** Follow-up contextual por IA a partir do histórico completo (sem templates fixos). */
export interface AgentFollowUpInteligente {
  ativo: boolean;
  tentativasContato: number;
  intervaloVerificacaoMinutos: number;
}

export interface AgentSchedule {
  tipo: "sempre" | "comercial" | "customizado";
  diasAtivos: string[];
  inicio?: string;
  fim?: string;
  mensagemForaHorario?: string;
}

export interface AgentFunnel {
  /** Identificador do funil no CRM (`lib/crm-funnels`, armazenamento local até haver API). */
  funilId: string;
  nomeFunil: string;
  /** ID da etapa no pipeline do funil (`CrmFunnel.columns[].id` do funil vinculado). */
  colunaInicial: string;
  tagsEntrada: string[];
  origemRelatorio: string;
  valorEstimado: number;
  slaHoras: number;
  maxFollowUps: number;
}

export interface AgentMetrics {
  conversasHoje: number;
  leadsConvertidos: number;
  taxaResposta: number;
  handoffRate: number;
  satisfacaoMedia: number;
  tempoMedioMin: number;
  conversasAtivasAgora: number;
  ultimaAtividade: string;
}

export interface Agent {
  id: string;
  clientId: string;
  nome: string;
  nomeProduto: string;
  avatar?: string;
  cor: string;
  genero: AgentGender;
  objetivo: AgentObjective;
  status: AgentStatus;
  tom: string;
  delayResposta: number;
  /** Criatividade do modelo (0.01–1). Menor = mais direto; maior = mais variado. */
  temperatura?: number;
  /** Como o agente deve se identificar e se posicionar (mini prompt curto). */
  promptIdentidade?: string;
  /** Objetivo em texto livre (complementa o enum `objetivo`). */
  promptObjetivo?: string;
  systemPrompt: string;
  /** Regras e preferências extras em texto livre (além de `respostasProibidas`). */
  promptRegrasAdicionais?: string;
  arquivosTreinamento: TrainingFile[];
  respostasProibidas: string;
  /**
   * Texto exato enviado no chat (ex.: pelo humano no WhatsApp) que pausa o agente só naquela conversa.
   * Vazio = recurso desligado para este agente.
   */
  comandoPausaConversa?: string;
  /** Texto exato que reativa o agente na mesma conversa após pausa manual. */
  comandoRetomaConversa?: string;
  idioma: string;
  /**
   * Linha WhatsApp (0 = numero incluido no plano; 1+ = extras contratados).
   * O metodo QR/API define-se em Integracoes; o agente fica associado a este indice.
   */
  whatsappSlotIndex?: number;
  origens: AgentOrigin[];
  horario: AgentSchedule;
  fluxo: FlowStep[];
  funil: AgentFunnel;
  followUps: FollowUp[];
  /** Retomadas automáticas inferidas do fio de conversa (integração em backend). */
  followUpInteligente?: AgentFollowUpInteligente;
  metricas: AgentMetrics;
  criadoEm: string;
  atualizadoEm: string;
  /** ID da voz no ElevenLabs para respostas em áudio (TTS). Null = texto. */
  voiceId?: string | null;
  /** Modo de resposta do agente: 'text' (padrão) ou 'audio' (TTS via ElevenLabs). */
  responseMode?: "text" | "audio";
  /** Quando true, leads tocados por este agente são movidos para o destino CRM abaixo. */
  crmAutoMoveEnabled?: boolean;
  /** Funil CRM de destino para leads tocados por este agente. */
  crmTargetFunnelId?: string | null;
  /** Coluna/etapa CRM de destino para leads tocados por este agente. */
  crmTargetColumnId?: string | null;
  /** Alias do status/coluna usado pela tabela leads. */
  crmTargetStatus?: string | null;
}
