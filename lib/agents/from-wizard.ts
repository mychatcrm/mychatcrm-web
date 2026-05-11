import type { Agent } from "@/lib/types";
import { listAgentsForTenant } from "./registry";
import { agentObjectiveLabel, type AgentWizardDraft } from "./wizard-model";

/** Aplica o rascunho do wizard a um agente existente (mantém id, métricas, status, horário, etc.). */
export function agentFromWizardDraftUpdate(existing: Agent, draft: AgentWizardDraft): Agent {
  const stamp = new Date().toISOString();
  return {
    ...existing,
    whatsappSlotIndex: draft.whatsappSlotIndex ?? 0,
    nome: draft.nome.trim(),
    nomeProduto: `Modelo: ${agentObjectiveLabel(draft.objetivo)}`,
    cor: draft.cor,
    avatar: draft.avatar,
    genero: draft.genero,
    objetivo: draft.objetivo,
    tom: draft.tom,
    delayResposta: draft.delayResposta,
    temperatura: draft.temperatura,
    promptIdentidade: draft.promptIdentidade,
    promptObjetivo: draft.promptObjetivo,
    systemPrompt: draft.systemPrompt,
    promptRegrasAdicionais: draft.promptRegrasAdicionais,
    respostasProibidas: draft.respostasProibidas,
    comandoPausaConversa: draft.comandoPausaConversa,
    comandoRetomaConversa: draft.comandoRetomaConversa,
    idioma: draft.idioma,
    arquivosTreinamento: draft.arquivosTreinamento,
    origens: draft.origens,
    fluxo: draft.fluxo,
    funil: { ...draft.funil },
    followUps: draft.followUps,
    followUpInteligente: draft.followUpInteligente,
    atualizadoEm: stamp,
    voiceId: draft.voiceId || null,
    responseMode: draft.responseMode ?? "text",
  };
}

/** Monta um `Agent` de demonstração a partir do rascunho (clone do primeiro template + campos do wizard). */
export function agentFromWizardDraft(draft: AgentWizardDraft, tenantId: string): Agent {
  const templates = listAgentsForTenant(tenantId);
  const base = structuredClone(templates[0]!);
  const stamp = new Date().toISOString();
  return {
    ...base,
    id: `ag-novo-${Date.now()}`,
    clientId: tenantId,
    whatsappSlotIndex: draft.whatsappSlotIndex ?? 0,
    nome: draft.nome.trim(),
    nomeProduto: `Modelo: ${agentObjectiveLabel(draft.objetivo)}`,
    cor: draft.cor,
    avatar: draft.avatar,
    genero: draft.genero,
    objetivo: draft.objetivo,
    status: "inativo",
    tom: draft.tom,
    delayResposta: draft.delayResposta,
    temperatura: draft.temperatura,
    promptIdentidade: draft.promptIdentidade,
    promptObjetivo: draft.promptObjetivo,
    systemPrompt: draft.systemPrompt,
    promptRegrasAdicionais: draft.promptRegrasAdicionais,
    respostasProibidas: draft.respostasProibidas,
    comandoPausaConversa: draft.comandoPausaConversa,
    comandoRetomaConversa: draft.comandoRetomaConversa,
    idioma: draft.idioma,
    arquivosTreinamento: draft.arquivosTreinamento,
    origens: draft.origens,
    fluxo: draft.fluxo,
    funil: { ...draft.funil },
    followUps: draft.followUps,
    followUpInteligente: draft.followUpInteligente,
    metricas: {
      ...base.metricas,
      conversasHoje: 0,
      leadsConvertidos: 0,
      conversasAtivasAgora: 0,
      ultimaAtividade: "Agora",
    },
    criadoEm: stamp,
    atualizadoEm: stamp,
    voiceId: draft.voiceId || null,
    responseMode: draft.responseMode ?? "text",
  };
}
