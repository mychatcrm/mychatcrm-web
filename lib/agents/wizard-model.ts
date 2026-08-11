import { BRAND } from "@/lib/brand";
import {
  DEFAULT_CRM_FUNNELS,
  getCrmFunnelsSnapshot,
  isValidColunaForFunnel,
  type CrmFunnel,
} from "@/lib/crm-funnels";
import type {
  Agent,
  AgentAgendaDisponibilidade,
  AgentAgendaLembretes,
  AgentFollowUpInteligente,
  AgentOrigin,
  FollowUp,
  FlowStep,
  KeywordRule,
  OriginType,
} from "@/lib/types";
import { DEFAULT_SYSTEM_PROMPT_TEMPLATE } from "./default-system-prompt-template";
import { normalizeInstructionMode } from "./instruction-mode";
import { normalizeAgentCrmDestination } from "./crm-destination";
import { normalizeAgentResponseMode, normalizeAgentVoiceId, validateAgentResponseSettings } from "./response-settings";
import { DEFAULT_AGENT_SMART_WAIT, sanitizeAgentSmartWaitSettings } from "./smart-wait-settings";
import { DEFAULT_FOLLOW_UP_INTELIGENTE } from "@/lib/server/follow-up-settings";

export type AgentWizardDraft = {
  nome: string;
  avatar: string;
  cor: string;
  tom: string;
  delayResposta: number;
  /** Temperatura do modelo (0.01–1). */
  temperatura: number;
  /** Identidade e apresentação perante o cliente (texto curto). */
  instructionMode: "simple" | "pro";
  simplePrompt: string;
  promptIdentidade: string;
  promptObjetivo: string;
  systemPrompt: string;
  promptRegrasAdicionais: string;
  respostasProibidas: string;
  idioma: string;
  /** Fuso IANA (metadata.timezone na raiz; espelhado em followUpInteligente ao salvar). */
  timezone: string;
  arquivosTreinamento: Agent["arquivosTreinamento"];
  externalApiConnectorIds: string[];
  origens: AgentOrigin[];
  fluxo: FlowStep[];
  followUps: FollowUp[];
  followUpInteligente: AgentFollowUpInteligente;
  funil: Agent["funil"];
  /** Indice da linha WhatsApp (0 plano, 1+ extras) — ver Integracoes. */
  /** Se falso, CTA/handoff ficam só nas instruções (campos abaixo ocultos). */
  ctaHandoffAtivo: boolean;
  /** Se true, o agente pode alterar a agenda usando diretivas estruturadas. */
  agendaAutomationEnabled: boolean;
  /** Lembretes automáticos enviados antes do agendamento. */
  agendaLembretes: AgentAgendaLembretes;
  /** Janela de disponibilidade para agendamentos. */
  agendaDisponibilidade: AgentAgendaDisponibilidade;
  ctaFinal: string;
  handoffKeywords: string[];
  handoffMensagem: string;
  handoffNumero: string;
  /** Se falso, remove do prompt as frases prontas de tom/velocidade/idioma. */
  useSystemToneInstructions: boolean;
  /** Se falso, remove do prompt o guia de estilo WhatsApp de fábrica. */
  useSystemWhatsappStyleGuide: boolean;
  /** Se falso, o agente mantém o ritmo configurado mas não se passa por humano. */
  useHumanPersona: boolean;
  foraDaVez: "ignorar" | "padrao" | "mensagem";
  foraDaVezMensagem: string;
  /** Modo de resposta: texto (padrão) ou áudio via ElevenLabs TTS. */
  responseMode: "text" | "audio";
  /** ID da voz ElevenLabs para TTS (obrigatório quando responseMode === 'audio'). */
  voiceId: string;
  smartWaitEnabled: boolean;
  smartWaitInitialSeconds: number;
  smartWaitFollowupSeconds: number;
  smartWaitMaxSeconds: number;
  smartWaitDedupeRepeated: boolean;
  /** Se true, leads criados/atualizados por este agente são movidos no CRM. */
  crmAutoMoveEnabled: boolean;
  /** Funil de destino para movimento automático no CRM. */
  crmTargetFunnelId: string;
  /** Coluna/etapa de destino para movimento automático no CRM. */
  crmTargetColumnId: string;
  /** Move o card do lead quando ele responde pela primeira vez. */
  crmMoveOnLeadReplyEnabled: boolean;
  crmReplyFunnelId: string;
  crmReplyColumnId: string;
  /** Move o card do lead quando o agente confirma/remarca um agendamento. */
  agendaCrmMoveOnScheduleEnabled: boolean;
  agendaCrmScheduleFunnelId: string;
  agendaCrmScheduleColumnId: string;
  /** Move o card do lead quando o agendamento é cancelado. */
  agendaCrmMoveOnCancelEnabled: boolean;
  agendaCrmCancelFunnelId: string;
  agendaCrmCancelColumnId: string;
};

const WIZARD_ORIGIN_ORDER: readonly OriginType[] = ["lead_ads", "ctw", "keyword", "organico", "crm"];

export const DEFAULT_AGENDA_LEMBRETES: AgentAgendaLembretes = {
  ativo: false,
  regras: [
    {
      offsetValor: 1,
      offsetUnidade: "dias",
      mensagem: "Olá {nome}, lembrete do seu agendamento amanhã às {hora}. Local: {local}.",
    },
  ],
};

export const DEFAULT_AGENDA_DISPONIBILIDADE: AgentAgendaDisponibilidade = {
  ativo: false,
  diasSemana: [1, 2, 3, 4, 5],
  horaInicio: "08:00",
  horaFim: "18:00",
  mensagemForaJanela: "",
  permitirAgendamentosSimultaneos: false,
};

function defaultWizardOriginRow(tipo: OriginType): AgentOrigin {
  switch (tipo) {
    case "lead_ads":
      return {
        tipo: "lead_ads",
        ativo: false,
        config: { formIds: [], enviarPrimeiro: true, delayPrimeiro: 0, mensagemInicial: "" },
      };
    case "ctw":
      return { tipo: "ctw", ativo: false, config: { adIds: [] } };
    case "keyword":
      return { tipo: "keyword", ativo: false, config: { keywords: [] as KeywordRule[] } };
    case "organico":
      return { tipo: "organico", ativo: true, config: {} };
    case "crm":
      return { tipo: "crm", ativo: false, config: {} };
  }
}

/** Garante as 5 origens esperidas pelo wizard (UI lê `lead_ads` e `ctw` sempre). */
export function normalizeOrigensForWizard(origens: AgentOrigin[]): AgentOrigin[] {
  const byTipo = new Map<OriginType, AgentOrigin>();
  for (const o of origens) {
    byTipo.set(o.tipo, o);
  }
  return WIZARD_ORIGIN_ORDER.map((tipo) => {
    const found = byTipo.get(tipo);
    return found ? ({ ...found, config: { ...found.config } } as AgentOrigin) : defaultWizardOriginRow(tipo);
  });
}

/** Origem por tipo com fallback (UI do passo 3 assume `lead_ads` e `ctw`). */
export function getWizardOrigin(draft: AgentWizardDraft, tipo: OriginType): AgentOrigin {
  return draft.origens.find((o) => o.tipo === tipo) ?? defaultWizardOriginRow(tipo);
}

export function draftFromAgent(agent: Agent): AgentWizardDraft {
  const funnels = getCrmFunnelsSnapshot();
  const fallbackFunnel = funnels[0] ?? DEFAULT_CRM_FUNNELS[0]!;
  const fallbackColumn = fallbackFunnel.columns[0]?.id ?? DEFAULT_CRM_FUNNELS[0]!.columns[0]!.id;
  const legacyFunil = agent.funil ?? {
    funilId: fallbackFunnel.id,
    nomeFunil: fallbackFunnel.nome,
    colunaInicial: fallbackColumn,
    tagsEntrada: [],
    origemRelatorio: "Não definido",
    valorEstimado: 0,
    slaHoras: 2,
    maxFollowUps: 0,
  };
  const crmDestination = normalizeAgentCrmDestination(agent);
  const targetFunnel = funnels.find((f) => f.id === crmDestination.crmTargetFunnelId) ?? fallbackFunnel;
  const targetColumn =
    targetFunnel.columns.find((column) => column.id === crmDestination.crmTargetColumnId)?.id ??
    targetFunnel.columns[0]?.id ??
    fallbackColumn;
  const smartWait = sanitizeAgentSmartWaitSettings({
    enabled: agent.smartWaitEnabled,
    initialSeconds: agent.smartWaitInitialSeconds,
    followupSeconds: agent.smartWaitFollowupSeconds,
    maxSeconds: agent.smartWaitMaxSeconds,
    dedupeRepeated: agent.smartWaitDedupeRepeated,
  });
  const timezone =
    (typeof agent.timezone === "string" && agent.timezone.trim()) ||
    agent.followUpInteligente?.timezone ||
    DEFAULT_FOLLOW_UP_INTELIGENTE.timezone ||
    "UTC";
  const followUpInteligente = agent.followUpInteligente
    ? { ...DEFAULT_FOLLOW_UP_INTELIGENTE, ...agent.followUpInteligente, timezone }
    : { ...DEFAULT_FOLLOW_UP_INTELIGENTE, timezone };
  return {
    nome: agent.nome,
    avatar: agent.avatar ?? "bot",
    cor: agent.cor,
    tom: agent.tom,
    delayResposta: agent.delayResposta,
    temperatura: agent.temperatura ?? 0.2,
    instructionMode: normalizeInstructionMode(agent.instructionMode),
    simplePrompt: agent.simplePrompt ?? "",
    promptIdentidade: agent.promptIdentidade ?? "",
    promptObjetivo: agent.promptObjetivo ?? "",
    systemPrompt: agent.systemPrompt,
    promptRegrasAdicionais: agent.promptRegrasAdicionais ?? "",
    respostasProibidas: agent.respostasProibidas,
    idioma: agent.idioma,
    arquivosTreinamento: agent.arquivosTreinamento,
    externalApiConnectorIds: agent.externalApiConnectorIds ?? [],
    origens: normalizeOrigensForWizard(agent.origens),
    fluxo: agent.fluxo,
    followUps: agent.followUps,
    timezone,
    followUpInteligente,
    funil: { ...legacyFunil },
    ctaHandoffAtivo: agent.ctaHandoffAtivo ?? false,
    agendaAutomationEnabled: agent.agendaAutomationEnabled ?? false,
    useSystemToneInstructions: agent.useSystemToneInstructions ?? true,
    useSystemWhatsappStyleGuide: agent.useSystemWhatsappStyleGuide ?? true,
    useHumanPersona: agent.useHumanPersona ?? true,
    agendaLembretes: agent.agendaLembretes ?? { ...DEFAULT_AGENDA_LEMBRETES, regras: [...DEFAULT_AGENDA_LEMBRETES.regras] },
    agendaDisponibilidade: {
      ...DEFAULT_AGENDA_DISPONIBILIDADE,
      ...(agent.agendaDisponibilidade ?? {}),
      diasSemana: [...(agent.agendaDisponibilidade?.diasSemana ?? DEFAULT_AGENDA_DISPONIBILIDADE.diasSemana)],
    },
    ctaFinal: agent.ctaFinal ?? "Transferir para humano",
    handoffKeywords: agent.handoffKeywords ?? ["humano", "especialista"],
    handoffMensagem: agent.handoffMensagem ?? "",
    handoffNumero: agent.handoffNumero ?? "",
    foraDaVez: "padrao",
    foraDaVezMensagem: "",
    responseMode: normalizeAgentResponseMode(agent.responseMode),
    voiceId: normalizeAgentVoiceId(agent.voiceId) ?? "",
    smartWaitEnabled: smartWait.enabled,
    smartWaitInitialSeconds: smartWait.initialSeconds,
    smartWaitFollowupSeconds: smartWait.followupSeconds,
    smartWaitMaxSeconds: smartWait.maxSeconds,
    smartWaitDedupeRepeated: smartWait.dedupeRepeated,
    crmAutoMoveEnabled: crmDestination.crmAutoMoveEnabled,
    crmTargetFunnelId: crmDestination.crmTargetFunnelId ?? targetFunnel.id,
    crmTargetColumnId: crmDestination.crmTargetColumnId ?? targetColumn,
    crmMoveOnLeadReplyEnabled: agent.crmMoveOnLeadReplyEnabled ?? false,
    crmReplyFunnelId: agent.crmReplyFunnelId ?? targetFunnel.id,
    crmReplyColumnId: agent.crmReplyColumnId ?? targetColumn,
    agendaCrmMoveOnScheduleEnabled: agent.agendaCrmMoveOnScheduleEnabled ?? false,
    agendaCrmScheduleFunnelId: agent.agendaCrmScheduleFunnelId ?? targetFunnel.id,
    agendaCrmScheduleColumnId: agent.agendaCrmScheduleColumnId ?? targetColumn,
    agendaCrmMoveOnCancelEnabled: agent.agendaCrmMoveOnCancelEnabled ?? false,
    agendaCrmCancelFunnelId: agent.agendaCrmCancelFunnelId ?? targetFunnel.id,
    agendaCrmCancelColumnId: agent.agendaCrmCancelColumnId ?? targetColumn,
  };
}

export function createPromptFromBusiness(context: string, draft: AgentWizardDraft): string {
  const identidade = draft.promptIdentidade.trim();
  return `Você é ${draft.nome || "um agente de IA"}.
${identidade ? `Identidade e apresentação:\n${identidade}\n\n` : ""}Tom de voz: ${draft.tom}.

Contexto do negócio (produto/serviço, oferta e detalhes — complemente o campo «Objetivo» se precisar):
${context || "Sem contexto adicional."}

Regras base:
- Responder em ${draft.idioma}.
- Nunca falar sobre: ${draft.respostasProibidas || "sem restrições explícitas"}.
- Objetivo final e transferência humana: seguir as instruções específicas escritas pelo gestor para este agente.
${
  draft.followUpInteligente.ativo
    ? `
- Follow-up inteligente (ativado): ao retomar conversas sem resposta, usar todo o histórico com aquele cliente para redigir uma mensagem nova e precisa — retomar exatamente o assunto, tom e pendências já discutidos; não usar frases genéricas nem modelos fixos.`
    : ""
}
`;
}

/** Validação ao salvar o formulário compacto (uma tela). */
export function validateCompactAgentDraft(
  draft: AgentWizardDraft,
  crmFunnels?: readonly CrmFunnel[],
): string | null {
  if (!draft.nome.trim()) return "Informe o nome do agente.";
  if (draft.instructionMode === "simple") {
    if (!draft.simplePrompt.trim()) return "Preencha o prompt do agente.";
  } else if (!draft.systemPrompt.trim()) {
    return "Preencha as instruções do agente.";
  }
  if (!draft.origens.some((origin) => origin?.ativo)) return "Ative pelo menos uma origem em «Ativação e origens».";
  if (!draft.fluxo.length) return "Mantenha ao menos uma etapa no fluxo.";
  const followUpInteligente = draft.followUpInteligente;
  if (followUpInteligente?.ativo) {
    if ((followUpInteligente.tentativasContato ?? 0) < 1) {
      return "Em «Configurações de Follow-up», defina pelo menos 1 tentativa de contato.";
    }
    if ((followUpInteligente.intervaloVerificacaoMinutos ?? 0) < 1) {
      return "Em «Configurações de Follow-up», o intervalo de verificação deve ser de pelo menos 1 minuto.";
    }
  }
  const responseSettingsError = validateAgentResponseSettings(draft);
  if (responseSettingsError) return responseSettingsError;
  if (draft.crmAutoMoveEnabled) {
    if (!crmFunnels?.length) return "Carregue os funis do CRM antes de configurar o destino automático.";
    const targetFunnel = crmFunnels.find((f) => f.id === draft.crmTargetFunnelId);
    if (!targetFunnel) return "Escolha um funil válido em «Destino do lead no CRM».";
    if (!isValidColunaForFunnel(draft.crmTargetColumnId, targetFunnel)) {
      return "Escolha uma coluna válida em «Destino do lead no CRM».";
    }
  }
  // Destino da primeira resposta: independente do de cima — o dono da conta
  // pode querer mover só quando o lead responde, sem mover no primeiro contato.
  if (draft.crmMoveOnLeadReplyEnabled) {
    if (!crmFunnels?.length) return "Carregue os funis do CRM antes de configurar o destino automático.";
    const replyFunnel = crmFunnels.find((f) => f.id === draft.crmReplyFunnelId);
    if (!replyFunnel) return "Escolha um funil válido em «Quando o lead responder».";
    if (!isValidColunaForFunnel(draft.crmReplyColumnId, replyFunnel)) {
      return "Escolha uma coluna válida em «Quando o lead responder».";
    }
  }
  // Os destinos da agenda só existem quando o agente pode mexer na agenda.
  if (draft.agendaAutomationEnabled) {
    for (const rule of [
      {
        enabled: draft.agendaCrmMoveOnScheduleEnabled,
        funnelId: draft.agendaCrmScheduleFunnelId,
        columnId: draft.agendaCrmScheduleColumnId,
        label: "ao agendar",
      },
      {
        enabled: draft.agendaCrmMoveOnCancelEnabled,
        funnelId: draft.agendaCrmCancelFunnelId,
        columnId: draft.agendaCrmCancelColumnId,
        label: "ao cancelar",
      },
    ]) {
      if (!rule.enabled) continue;
      if (!crmFunnels?.length) return "Carregue os funis do CRM antes de configurar o destino da agenda.";
      const funnel = crmFunnels.find((f) => f.id === rule.funnelId);
      if (!funnel) return `Escolha um funil válido em «Agenda» (${rule.label}).`;
      if (!isValidColunaForFunnel(rule.columnId, funnel)) {
        return `Escolha uma coluna válida em «Agenda» (${rule.label}).`;
      }
    }
  }
  return null;
}

export const defaultWizardDraft: AgentWizardDraft = {
  nome: "",
  avatar: "bot",
  cor: BRAND.orange,
  tom: "Profissional",
  delayResposta: 2,
  temperatura: 0.2,
  instructionMode: "pro",
  simplePrompt: "",
  promptIdentidade: "",
  promptObjetivo: "",
  systemPrompt: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
  promptRegrasAdicionais: "",
  respostasProibidas: "",
  idioma: "Português BR",
  timezone: DEFAULT_FOLLOW_UP_INTELIGENTE.timezone ?? "UTC",
  arquivosTreinamento: [],
  externalApiConnectorIds: [],
  origens: [
    { tipo: "lead_ads", ativo: false, config: { formIds: [], enviarPrimeiro: true, delayPrimeiro: 0, mensagemInicial: "" } },
    { tipo: "ctw", ativo: false, config: { adIds: [] } },
    { tipo: "keyword", ativo: false, config: { keywords: [] as KeywordRule[] } },
    { tipo: "organico", ativo: true, config: {} },
    { tipo: "crm", ativo: false, config: {} },
  ],
  fluxo: [
    {
      id: "wf-1",
      nome: "Boas-vindas",
      objetivo: "Saudar e identificar intenção principal",
      perguntas: ["Como posso te ajudar hoje?"],
      condicaoAvancar: "perguntas",
      acoesAoCompletar: [{ id: "wfa-1", tipo: "tag", valor: "boas-vindas" }],
      ordem: 1,
    },
  ],
  followUps: [],
  followUpInteligente: { ...DEFAULT_FOLLOW_UP_INTELIGENTE },
  funil: {
    funilId: DEFAULT_CRM_FUNNELS[0]!.id,
    nomeFunil: DEFAULT_CRM_FUNNELS[0]!.nome,
    colunaInicial: DEFAULT_CRM_FUNNELS[0]!.columns[0]!.id,
    tagsEntrada: [],
    origemRelatorio: "Não definido",
    valorEstimado: 0,
    slaHoras: 2,
    maxFollowUps: 0,
  },
  ctaHandoffAtivo: true,
  agendaAutomationEnabled: false,
  useSystemToneInstructions: true,
  useSystemWhatsappStyleGuide: true,
  useHumanPersona: true,
  agendaLembretes: { ...DEFAULT_AGENDA_LEMBRETES, regras: [...DEFAULT_AGENDA_LEMBRETES.regras] },
  agendaDisponibilidade: { ...DEFAULT_AGENDA_DISPONIBILIDADE, diasSemana: [...DEFAULT_AGENDA_DISPONIBILIDADE.diasSemana] },
  ctaFinal: "Transferir para humano",
  handoffKeywords: ["humano", "atendente", "falar com pessoa"],
  handoffMensagem: "Perfeito! Vou te conectar com nosso especialista agora. Um momento.",
  handoffNumero: "",
  foraDaVez: "padrao",
  foraDaVezMensagem: "",
  responseMode: "text",
  voiceId: "",
  smartWaitEnabled: DEFAULT_AGENT_SMART_WAIT.enabled,
  smartWaitInitialSeconds: DEFAULT_AGENT_SMART_WAIT.initialSeconds,
  smartWaitFollowupSeconds: DEFAULT_AGENT_SMART_WAIT.followupSeconds,
  smartWaitMaxSeconds: DEFAULT_AGENT_SMART_WAIT.maxSeconds,
  smartWaitDedupeRepeated: DEFAULT_AGENT_SMART_WAIT.dedupeRepeated,
  crmAutoMoveEnabled: false,
  crmTargetFunnelId: DEFAULT_CRM_FUNNELS[0]!.id,
  crmTargetColumnId: DEFAULT_CRM_FUNNELS[0]!.columns[0]!.id,
  crmMoveOnLeadReplyEnabled: false,
  crmReplyFunnelId: DEFAULT_CRM_FUNNELS[0]!.id,
  crmReplyColumnId: DEFAULT_CRM_FUNNELS[0]!.columns[0]!.id,
  agendaCrmMoveOnScheduleEnabled: false,
  agendaCrmScheduleFunnelId: DEFAULT_CRM_FUNNELS[0]!.id,
  agendaCrmScheduleColumnId: DEFAULT_CRM_FUNNELS[0]!.columns[0]!.id,
  agendaCrmMoveOnCancelEnabled: false,
  agendaCrmCancelFunnelId: DEFAULT_CRM_FUNNELS[0]!.id,
  agendaCrmCancelColumnId: DEFAULT_CRM_FUNNELS[0]!.columns[0]!.id,
};
