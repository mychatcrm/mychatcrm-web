import type { Agent } from "@/lib/types";
import { listAgentsForTenant } from "./registry";
import { sanitizeAgentResponseSettings } from "./response-settings";
import { sanitizeAgentSmartWaitSettings } from "./smart-wait-settings";
import type { AgentWizardDraft } from "./wizard-model";

function followUpAndTimezoneFromDraft(draft: AgentWizardDraft) {
  const timezone =
    (typeof draft.timezone === "string" && draft.timezone.trim()) ||
    draft.followUpInteligente?.timezone ||
    "UTC";
  return {
    timezone,
    followUpInteligente: { ...draft.followUpInteligente, timezone },
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
    whatsappSlotIndex: draft.whatsappSlotIndex ?? 0,
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
    whatsappSlotIndex: draft.whatsappSlotIndex ?? 0,
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
    ctaFinal: draft.ctaFinal ?? "Transferir para humano",
    handoffKeywords: draft.handoffKeywords ?? ["humano", "especialista"],
    handoffMensagem: draft.handoffMensagem ?? "",
    handoffNumero: draft.handoffNumero ?? "",
  };
}
