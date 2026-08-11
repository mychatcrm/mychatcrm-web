import type { Agent, AgentFollowUpInteligente, AgentLeadOutcomeConfig } from "@/lib/types";
import { listAgentsForTenant } from "./registry";
import { sanitizeAgentResponseSettings } from "./response-settings";
import { sanitizeAgentSmartWaitSettings } from "./smart-wait-settings";
import type { AgentWizardDraft } from "./wizard-model";

/**
 * Destinos CRM da agenda. Ficam nulos quando o agente não pode mexer na agenda
 * ou quando o move daquele lado está desligado — assim uma config antiga nunca
 * volta a valer sozinha ao religar o toggle de Agenda.
 */
function agendaCrmMoveFields(
  draft: AgentWizardDraft,
): Pick<
  Agent,
  | "agendaCrmMoveOnScheduleEnabled"
  | "agendaCrmScheduleFunnelId"
  | "agendaCrmScheduleColumnId"
  | "agendaCrmMoveOnCancelEnabled"
  | "agendaCrmCancelFunnelId"
  | "agendaCrmCancelColumnId"
> {
  const agendaOn = draft.agendaAutomationEnabled ?? false;
  const scheduleOn = agendaOn && draft.agendaCrmMoveOnScheduleEnabled;
  const cancelOn = agendaOn && draft.agendaCrmMoveOnCancelEnabled;
  return {
    agendaCrmMoveOnScheduleEnabled: scheduleOn,
    agendaCrmScheduleFunnelId: scheduleOn ? draft.agendaCrmScheduleFunnelId : null,
    agendaCrmScheduleColumnId: scheduleOn ? draft.agendaCrmScheduleColumnId : null,
    agendaCrmMoveOnCancelEnabled: cancelOn,
    agendaCrmCancelFunnelId: cancelOn ? draft.agendaCrmCancelFunnelId : null,
    agendaCrmCancelColumnId: cancelOn ? draft.agendaCrmCancelColumnId : null,
  };
}

/**
 * Destino da primeira resposta do lead. Não depende do destino do primeiro
 * contato: o dono da conta pode querer mover só quando o lead responde. Funil e
 * coluna só são gravados com a opção ligada — desligar não guarda lixo.
 */
function leadReplyCrmMoveFields(
  draft: AgentWizardDraft,
): Pick<Agent, "crmMoveOnLeadReplyEnabled" | "crmReplyFunnelId" | "crmReplyColumnId"> {
  const replyOn = draft.crmMoveOnLeadReplyEnabled ?? false;
  return {
    crmMoveOnLeadReplyEnabled: replyOn,
    crmReplyFunnelId: replyOn ? draft.crmReplyFunnelId : null,
    crmReplyColumnId: replyOn ? draft.crmReplyColumnId : null,
  };
}

/**
 * Descarte de leads. Desligado zera critérios e destino.
 *
 * Mais rígido que os outros destinos por ser automação terminal: sem critérios
 * escritos ela nem chega a ficar ativa, e desligar não deixa texto guardado que
 * volte a valer se alguém religar o toggle sem reler o que estava ali.
 */
function leadOutcomeFields(config: AgentLeadOutcomeConfig | undefined): AgentLeadOutcomeConfig {
  const criterios = config?.criterios?.trim() ?? "";
  const ativo = config?.ativo === true && Boolean(criterios);
  if (!ativo) {
    return {
      ativo: false,
      criterios: "",
      funnelId: null,
      columnId: null,
      retomarAoVoltar: false,
      notificar: false,
    };
  }
  return {
    ativo: true,
    criterios,
    funnelId: config?.funnelId ?? null,
    columnId: config?.columnId ?? null,
    retomarAoVoltar: config?.retomarAoVoltar === true,
    notificar: config?.notificar === true,
  };
}

/**
 * Destinos de CRM do ciclo de follow-up (disparo, esgotamento e retorno do
 * lead). Mesma regra dos outros destinos: funil e coluna só ficam gravados com
 * a opção ligada, para desligar não deixar lixo que volte a valer sozinho.
 *
 * Todos zeram quando o follow-up está desligado — sem follow-up, nenhum desses
 * momentos chega a acontecer, e config órfã só confunde na próxima edição.
 */
function followUpCrmMoveFields(followUp: AgentFollowUpInteligente): Partial<AgentFollowUpInteligente> {
  const followUpOn = followUp.ativo === true;
  const on = (flag: boolean | undefined) => followUpOn && flag === true;

  const disparoOn = on(followUp.crmMoveOnFollowUpEnabled);
  const esgotadoOn = on(followUp.crmMoveOnExhaustedEnabled);
  const retornoOn = on(followUp.crmMoveOnReturnAfterExhaustedEnabled);

  return {
    crmMoveOnFollowUpEnabled: disparoOn,
    crmFollowUpFunnelId: disparoOn ? (followUp.crmFollowUpFunnelId ?? null) : null,
    crmFollowUpColumnId: disparoOn ? (followUp.crmFollowUpColumnId ?? null) : null,
    crmMoveOnExhaustedEnabled: esgotadoOn,
    crmExhaustedFunnelId: esgotadoOn ? (followUp.crmExhaustedFunnelId ?? null) : null,
    crmExhaustedColumnId: esgotadoOn ? (followUp.crmExhaustedColumnId ?? null) : null,
    crmMoveOnReturnAfterExhaustedEnabled: retornoOn,
    crmReturnFunnelId: retornoOn ? (followUp.crmReturnFunnelId ?? null) : null,
    crmReturnColumnId: retornoOn ? (followUp.crmReturnColumnId ?? null) : null,
  };
}

function followUpAndTimezoneFromDraft(draft: AgentWizardDraft) {
  const timezone =
    (typeof draft.timezone === "string" && draft.timezone.trim()) ||
    draft.followUpInteligente?.timezone ||
    "UTC";
  return {
    timezone,
    followUpInteligente: {
      ...draft.followUpInteligente,
      timezone,
      ...followUpCrmMoveFields(draft.followUpInteligente),
    },
  };
}

/** Aplica o rascunho do wizard a um agente existente (mantém id, métricas, status, horário, etc.). */
export function agentFromWizardDraftUpdate(existing: Agent, draft: AgentWizardDraft): Agent {
  const stamp = new Date().toISOString();
  const responseSettings = sanitizeAgentResponseSettings(draft);
  const smartWait = sanitizeAgentSmartWaitSettings(draft);
  const { timezone, followUpInteligente } = followUpAndTimezoneFromDraft(draft);
  return {
    ...existing,
    nome: draft.nome.trim(),
    cor: draft.cor,
    avatar: draft.avatar,
    tom: draft.tom,
    delayResposta: draft.delayResposta,
    temperatura: draft.temperatura,
    instructionMode: draft.instructionMode,
    simplePrompt: draft.simplePrompt,
    promptIdentidade: draft.promptIdentidade,
    promptObjetivo: draft.promptObjetivo,
    systemPrompt: draft.systemPrompt,
    promptRegrasAdicionais: draft.promptRegrasAdicionais,
    respostasProibidas: draft.respostasProibidas,
    idioma: draft.idioma,
    timezone,
    arquivosTreinamento: draft.arquivosTreinamento,
    externalApiConnectorIds: draft.externalApiConnectorIds,
    origens: draft.origens,
    fluxo: draft.fluxo,
    funil: { ...draft.funil },
    followUps: draft.followUps,
    followUpInteligente,
    atualizadoEm: stamp,
    voiceId: responseSettings.voiceId,
    responseMode: responseSettings.responseMode,
    smartWaitEnabled: smartWait.enabled,
    smartWaitInitialSeconds: smartWait.initialSeconds,
    smartWaitFollowupSeconds: smartWait.followupSeconds,
    smartWaitMaxSeconds: smartWait.maxSeconds,
    smartWaitDedupeRepeated: smartWait.dedupeRepeated,
    crmAutoMoveEnabled: draft.crmAutoMoveEnabled,
    crmTargetFunnelId: draft.crmAutoMoveEnabled ? draft.crmTargetFunnelId : null,
    crmTargetColumnId: draft.crmAutoMoveEnabled ? draft.crmTargetColumnId : null,
    crmTargetStatus: draft.crmAutoMoveEnabled ? draft.crmTargetColumnId : null,
    ctaHandoffAtivo: draft.ctaHandoffAtivo ?? false,
    agendaAutomationEnabled: draft.agendaAutomationEnabled ?? false,
    useSystemToneInstructions: draft.useSystemToneInstructions ?? true,
    useSystemWhatsappStyleGuide: draft.useSystemWhatsappStyleGuide ?? true,
    useHumanPersona: draft.useHumanPersona ?? true,
    agendaLembretes: draft.agendaLembretes,
    agendaDisponibilidade: draft.agendaDisponibilidade,
    ...agendaCrmMoveFields(draft),
    ...leadReplyCrmMoveFields(draft),
    leadOutcomeDisqualified: leadOutcomeFields(draft.leadOutcomeDisqualified),
    leadOutcomeLostInterest: leadOutcomeFields(draft.leadOutcomeLostInterest),
    ctaFinal: draft.ctaFinal ?? "Transferir para humano",
    handoffKeywords: draft.handoffKeywords ?? ["humano", "especialista"],
    handoffMensagem: draft.handoffMensagem ?? "",
    handoffNumero: draft.handoffNumero ?? "",
  };
}

/** Monta um `Agent` de demonstração a partir do rascunho (clone do primeiro template + campos do wizard). */
export function agentFromWizardDraft(draft: AgentWizardDraft, tenantId: string): Agent {
  const templates = listAgentsForTenant(tenantId);
  const baseFull = structuredClone(templates[0]!);
  const {
    comandoPausaConversa: _pause,
    comandoRetomaConversa: _resume,
    genero: _genero,
    ...base
  } = baseFull;
  const stamp = new Date().toISOString();
  const responseSettings = sanitizeAgentResponseSettings(draft);
  const smartWait = sanitizeAgentSmartWaitSettings(draft);
  const { timezone, followUpInteligente } = followUpAndTimezoneFromDraft(draft);
  return {
    ...base,
    id: `ag-novo-${Date.now()}`,
    clientId: tenantId,
    nome: draft.nome.trim(),
    cor: draft.cor,
    avatar: draft.avatar,
    status: "inativo",
    tom: draft.tom,
    delayResposta: draft.delayResposta,
    temperatura: draft.temperatura,
    instructionMode: draft.instructionMode,
    simplePrompt: draft.simplePrompt,
    promptIdentidade: draft.promptIdentidade,
    promptObjetivo: draft.promptObjetivo,
    systemPrompt: draft.systemPrompt,
    promptRegrasAdicionais: draft.promptRegrasAdicionais,
    respostasProibidas: draft.respostasProibidas,
    idioma: draft.idioma,
    timezone,
    arquivosTreinamento: draft.arquivosTreinamento,
    externalApiConnectorIds: draft.externalApiConnectorIds,
    origens: draft.origens,
    fluxo: draft.fluxo,
    funil: { ...draft.funil },
    followUps: draft.followUps,
    followUpInteligente,
    metricas: {
      ...base.metricas,
      conversasHoje: 0,
      leadsConvertidos: 0,
      conversasAtivasAgora: 0,
      ultimaAtividade: "Agora",
    },
    criadoEm: stamp,
    atualizadoEm: stamp,
    voiceId: responseSettings.voiceId,
    responseMode: responseSettings.responseMode,
    smartWaitEnabled: smartWait.enabled,
    smartWaitInitialSeconds: smartWait.initialSeconds,
    smartWaitFollowupSeconds: smartWait.followupSeconds,
    smartWaitMaxSeconds: smartWait.maxSeconds,
    smartWaitDedupeRepeated: smartWait.dedupeRepeated,
    crmAutoMoveEnabled: draft.crmAutoMoveEnabled,
    crmTargetFunnelId: draft.crmAutoMoveEnabled ? draft.crmTargetFunnelId : null,
    crmTargetColumnId: draft.crmAutoMoveEnabled ? draft.crmTargetColumnId : null,
    crmTargetStatus: draft.crmAutoMoveEnabled ? draft.crmTargetColumnId : null,
    ctaHandoffAtivo: draft.ctaHandoffAtivo ?? false,
    agendaAutomationEnabled: draft.agendaAutomationEnabled ?? false,
    useSystemToneInstructions: draft.useSystemToneInstructions ?? true,
    useSystemWhatsappStyleGuide: draft.useSystemWhatsappStyleGuide ?? true,
    useHumanPersona: draft.useHumanPersona ?? true,
    agendaLembretes: draft.agendaLembretes,
    agendaDisponibilidade: draft.agendaDisponibilidade,
    ...agendaCrmMoveFields(draft),
    ...leadReplyCrmMoveFields(draft),
    leadOutcomeDisqualified: leadOutcomeFields(draft.leadOutcomeDisqualified),
    leadOutcomeLostInterest: leadOutcomeFields(draft.leadOutcomeLostInterest),
    ctaFinal: draft.ctaFinal ?? "Transferir para humano",
    handoffKeywords: draft.handoffKeywords ?? ["humano", "especialista"],
    handoffMensagem: draft.handoffMensagem ?? "",
    handoffNumero: draft.handoffNumero ?? "",
  };
}
