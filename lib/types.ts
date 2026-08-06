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
  /** Tamanho em bytes quando conhecido (ex.: API knowledge-files); senão usar tamanhoKb. */
  sizeBytes?: number;
  /** Estado da extração de texto para o agente (materiais no R2). */
  extractedTextStatus?: "pending" | "processing" | "ready" | "failed" | "unsupported";
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

/** Follow-up contextual por IA — todas as regras são controladas por estas flags (nada obrigatório no código). */
export interface AgentFollowUpInteligente {
  /** Master switch: desligado = zero jobs, zero envios, zero avaliações ativas. */
  ativo: boolean;
  tentativasContato: number;
  intervaloVerificacaoMinutos: number;
  modo: "agressivo" | "moderado" | "suave";
  /** Aplicar cooldown mínimo entre follow-ups (anti-spam). */
  cooldownAtivo: boolean;
  cooldownMinutos: number;
  /** Restringir envios à janela horária/dias configurados. */
  usarHorarioComercial: boolean;
  horaInicio: number;
  /** Minutos do início da janela (0-59). Padrão: 0. */
  minutoInicio?: number;
  horaFim: number;
  /** Minutos do fim da janela (0-59). Padrão: 0. */
  minutoFim?: number;
  diasAtivos: number[];
  /** Bloquear quando humano pausou, modo humano ou humano respondeu recentemente. */
  respeitarHumanoAtivo: boolean;
  retomadaApenasSeHumanoAbandonou: boolean;
  bloquearSeLeadRespondeu: boolean;
  bloquearTarefaFutura: boolean;
  bloquearStatusPerdido: boolean;
  /** Priorizar retomada quando SLA (horas) for ultrapassado. */
  permitirSlaVencido: boolean;
  slaHorasResposta: number | null;
  /** Ao esgotar tentativas, limpar agendamento e marcar follow-up inativo no lead. */
  desativarAposEncerrar: boolean;
  usarDadosFormularioMeta: boolean;
  usarHistoricoCrm: boolean;
  usarHistoricoWhatsapp: boolean;
  /** Fuso horário IANA usado para interpretar horaInicio/horaFim/diasAtivos. Padrão: "UTC". */
  timezone?: string;
  /**
   * Tempo mínimo de silêncio do humano (em valor+unidade) para considerar abandono.
   * null = sem restrição adicional de tempo (comportamento pré-existente preservado).
   * Só é avaliado quando retomadaApenasSeHumanoAbandonou = true.
   */
  retomadaHumanoTempoValor?: number | null;
  retomadaHumanoTempoUnidade?: "minutos" | "horas" | "dias";
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

/** Uma regra de lembrete automático para agendamentos (ex.: "1 dia antes"). */
export type AgentAgendaLembreteRegra = {
  /** Quantidade de tempo antes do evento para enviar o lembrete. */
  offsetValor: number;
  /** Unidade do offset. */
  offsetUnidade: "minutos" | "horas" | "dias";
  /** Template da mensagem. Variáveis: {nome}, {data}, {hora}, {local}, {titulo}. */
  mensagem?: string;
};

/** Configuração de lembretes automáticos de agendamento por agente. */
export type AgentAgendaLembretes = {
  ativo: boolean;
  /** Até 3 regras de lembrete. */
  regras: AgentAgendaLembreteRegra[];
};

/** Janela de disponibilidade para aceitar agendamentos via agente. */
export type AgentAgendaDisponibilidade = {
  ativo: boolean;
  /** Dias da semana aceitos: 0=Dom, 1=Seg, …, 6=Sáb. */
  diasSemana: number[];
  /** Horário de início da janela, formato "HH:MM". */
  horaInicio: string;
  /** Horário de fim da janela, formato "HH:MM". */
  horaFim: string;
  /** Mensagem enviada quando o lead pede horário fora da janela. Vazio = mensagem padrão dinâmica. */
  mensagemForaJanela?: string;
  /** Permite mais de um agendamento no mesmo horário. undefined = permite (agentes antigos). */
  permitirAgendamentosSimultaneos?: boolean;
};

export interface Agent {
  id: string;
  clientId: string;
  nome: string;
  nomeProduto: string;
  avatar?: string;
  cor: string;
  /** Legado — não editável no wizard; pode existir em metadata antiga. */
  genero?: AgentGender;
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
  /** Modo de edição das instruções: campos separados (pro) ou prompt único (simple). */
  instructionMode?: "simple" | "pro";
  /** Prompt único usado quando `instructionMode === "simple"`. */
  simplePrompt?: string;
  systemPrompt: string;
  /** Regras e preferências extras em texto livre (além de `respostasProibidas`). */
  promptRegrasAdicionais?: string;
  arquivosTreinamento: TrainingFile[];
  /** Conectores REST/JSON de consulta explicitamente vinculados pelo titular. */
  externalApiConnectorIds?: string[];
  respostasProibidas: string;
  /**
   * Texto exato enviado no chat (ex.: pelo humano no WhatsApp) que pausa o agente só naquela conversa.
   * Vazio = recurso desligado para este agente.
   */
  comandoPausaConversa?: string;
  /** Texto exato que reativa o agente na mesma conversa após pausa manual. */
  comandoRetomaConversa?: string;
  idioma: string;
  /** Fuso IANA do agente (prompt, horários de follow-up). Padrão: UTC. */
  timezone?: string;
  /**
   * @deprecated Não é mais lido em runtime nem editável no painel. Quem define
   * a linha do agente é a regra em Integrações de Leads, e a linha de envio dos
   * lembretes é derivada da conexão que recebeu a conversa. Mantido só porque
   * agentes já gravados carregam o campo em `tenant_agents.metadata`.
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
  smartWaitEnabled?: boolean;
  smartWaitInitialSeconds?: number;
  smartWaitFollowupSeconds?: number;
  smartWaitMaxSeconds?: number;
  smartWaitDedupeRepeated?: boolean;
  /** Quando true, leads tocados por este agente são movidos para o destino CRM abaixo. */
  crmAutoMoveEnabled?: boolean;
  /** Funil CRM de destino para leads tocados por este agente. */
  crmTargetFunnelId?: string | null;
  /** Coluna/etapa CRM de destino para leads tocados por este agente. */
  crmTargetColumnId?: string | null;
  /** Alias do status/coluna usado pela tabela leads. */
  crmTargetStatus?: string | null;
  /** Se true, CTA/handoff estruturado está ativo para este agente. */
  ctaHandoffAtivo?: boolean;
  /** Se true, o agente pode criar, remarcar e cancelar compromissos pela conversa. */
  agendaAutomationEnabled?: boolean;
  /** Regras de lembrete automático ligadas a agendamentos criados pelo agente. */
  agendaLembretes?: AgentAgendaLembretes;
  /** Janela de disponibilidade para agendamentos (dias da semana + horários). */
  agendaDisponibilidade?: AgentAgendaDisponibilidade;
  /**
   * Move o card do lead no CRM quando o agente confirma (ou remarca) um
   * agendamento. Depende de `agendaAutomationEnabled`.
   */
  agendaCrmMoveOnScheduleEnabled?: boolean;
  agendaCrmScheduleFunnelId?: string | null;
  agendaCrmScheduleColumnId?: string | null;
  /**
   * Move o card do lead no CRM quando o agendamento é cancelado — pela conversa
   * ou pelo painel da agenda. Destino independente do de agendamento.
   */
  agendaCrmMoveOnCancelEnabled?: boolean;
  agendaCrmCancelFunnelId?: string | null;
  agendaCrmCancelColumnId?: string | null;
  /** CTA final configurado no wizard (ex.: transferir para humano). */
  ctaFinal?: string;
  /** Palavras-chave adicionais que disparam handoff automático. */
  handoffKeywords?: string[];
  /** Mensagem enviada ao cliente na transição para humano. */
  handoffMensagem?: string;
  /** Número WhatsApp do atendente humano para notificação de handoff. */
  handoffNumero?: string;
  /** undefined/true = injeta frases prontas de tom/velocidade/idioma no prompt; false = só o que o operador escrever. */
  useSystemToneInstructions?: boolean;
  /** undefined/true = injeta o guia de estilo WhatsApp de fábrica no prompt; false = só o que o operador escrever. */
  useSystemWhatsappStyleGuide?: boolean;
  /**
   * undefined/true = o agente se apresenta como atendente humano e nunca revela
   * que é uma IA (comportamento histórico, disparado pela velocidade de resposta).
   * false = mantém o ritmo configurado, mas sem se passar por humano — usado por
   * quem precisa de transparência sobre automação.
   */
  useHumanPersona?: boolean;
}
