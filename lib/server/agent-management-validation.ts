import "server-only";

import {
  validateAgentActivationContext,
  type AgentActivationContextFailure,
  type AgentActivationContextValidation,
} from "@/lib/ai/agent-context-activation";
import { resolveExplicitAgentTimezone } from "@/lib/agents/agent-datetime";
import type { Agent } from "@/lib/types";

const AGENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const VALID_STATUSES = new Set(["ativo", "pausado", "inativo"]);
const MAX_PROMPT_CHARS = 100_000;
const MANAGED_CONTEXT_REVIEW_REASONS = new Set([
  "agent_context_overflow",
  "agent_model_context_window_unknown",
  "agent_invalid_language",
  "agenda_timezone_required",
  "follow_up_timezone_required",
  "handoff_configuration_invalid",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value: unknown, label: string, max: number): string | null {
  if (typeof value !== "string" || !value.trim()) return `${label} é obrigatório.`;
  if (value.length > max) return `${label} excede o limite de ${max} caracteres.`;
  return null;
}

function optionalText(value: unknown, label: string, max: number): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return `${label} deve ser texto.`;
  if (value.length > max) return `${label} excede o limite de ${max} caracteres.`;
  return null;
}

export function validateAgentId(value: unknown): string | null {
  if (typeof value !== "string" || !AGENT_ID_RE.test(value)) {
    return "ID do agente inválido.";
  }
  return null;
}

/** Validação mínima e defensiva para payloads que chegam fora do wizard. */
export function validateAgentManagementPayload(
  value: unknown,
  options: { requireId: boolean; expectedId?: string; requireVersion?: boolean } = { requireId: true },
): { ok: true; agent: Agent } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: "Configuração do agente inválida." };

  if (options.requireId || value.id !== undefined) {
    const idError = validateAgentId(value.id);
    if (idError) return { ok: false, error: idError };
  }
  if (options.expectedId && value.id !== undefined && value.id !== options.expectedId) {
    return { ok: false, error: "O ID do corpo não corresponde ao agente da rota." };
  }

  const nameError = requiredText(value.nome, "Nome do agente", 120);
  if (nameError) return { ok: false, error: nameError };
  if (!VALID_STATUSES.has(String(value.status))) {
    return { ok: false, error: "Status do agente inválido." };
  }
  if (options.requireVersion) {
    if (typeof value.atualizadoEm !== "string" || !value.atualizadoEm.trim() || !Number.isFinite(Date.parse(value.atualizadoEm))) {
      return { ok: false, error: "Versão do agente inválida. Recarregue a página e tente novamente." };
    }
  }

  const instructionMode = value.instructionMode === "simple" ? "simple" : "pro";
  const promptError = instructionMode === "simple"
    ? requiredText(value.simplePrompt, "Prompt do agente", MAX_PROMPT_CHARS)
    : requiredText(value.systemPrompt, "Instruções do agente", MAX_PROMPT_CHARS);
  if (promptError) return { ok: false, error: promptError };

  for (const [field, label] of [
    ["promptIdentidade", "Identidade"],
    ["promptObjetivo", "Objetivo"],
    ["promptRegrasAdicionais", "Regras adicionais"],
    ["respostasProibidas", "Respostas proibidas"],
  ] as const) {
    const error = optionalText(value[field], label, MAX_PROMPT_CHARS);
    if (error) return { ok: false, error };
  }

  if (!Array.isArray(value.origens) || value.origens.length > 25) {
    return { ok: false, error: "Origens do agente inválidas." };
  }
  if (!Array.isArray(value.fluxo) || value.fluxo.length > 100) {
    return { ok: false, error: "Fluxo do agente inválido." };
  }
  if (!Array.isArray(value.arquivosTreinamento) || value.arquivosTreinamento.length > 100) {
    return { ok: false, error: "Materiais do agente inválidos." };
  }

  if (value.externalApiConnectorIds !== undefined) {
    if (
      !Array.isArray(value.externalApiConnectorIds) ||
      value.externalApiConnectorIds.length > 50 ||
      value.externalApiConnectorIds.some((id) => typeof id !== "string" || !id.trim() || id.length > 128)
    ) {
      return { ok: false, error: "Vínculos de APIs externas inválidos." };
    }
  }

  if (value.ctaHandoffAtivo === true) {
    const digits = typeof value.handoffNumero === "string" ? value.handoffNumero.replace(/\D/g, "") : "";
    if (digits.length < 8 || digits.length > 15) {
      return { ok: false, error: "Informe um número internacional válido para a transferência humana." };
    }
    const messageError = requiredText(value.handoffMensagem, "Mensagem de transferência", 1_000);
    if (messageError) return { ok: false, error: messageError };
    if (
      !Array.isArray(value.handoffKeywords) ||
      value.handoffKeywords.length === 0 ||
      value.handoffKeywords.length > 50 ||
      value.handoffKeywords.some(
        (item) => typeof item !== "string" || !item.trim() || item.length > 80,
      )
    ) {
      return { ok: false, error: "Palavras-chave de transferência inválidas." };
    }
  }

  return { ok: true, agent: value as unknown as Agent };
}

export function isAgentArchivedMetadata(metadata: unknown): boolean {
  if (!isRecord(metadata)) return false;
  const lifecycle = metadata.managementLifecycle;
  return isRecord(lifecycle) && typeof lifecycle.archivedAt === "string" && Boolean(lifecycle.archivedAt.trim());
}

export type AgentContextSaveDecision = {
  validation: AgentActivationContextValidation;
  blocked: boolean;
  reviewStatus: "ready" | "action_required";
  reviewReasons: string[];
};

function normalizedReviewReasons(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter(
    (value): value is string =>
      typeof value === "string" && /^[a-z0-9_:-]{1,96}$/.test(value),
  ))];
}

/**
 * Configuração inválida nunca é ativada. Em modo pausado/inativo, porém, ela
 * continua persistível como rascunho com diagnóstico para correção posterior.
 */
export function resolveAgentContextSaveDecision(params: {
  agent: Agent;
  model?: string | null;
  existingReviewReasons?: unknown;
}): AgentContextSaveDecision {
  const validation = validateAgentActivationContext({
    agent: params.agent,
    model: params.model,
  });
  const reviewReasons = normalizedReviewReasons(params.existingReviewReasons).filter(
    (reason) => !MANAGED_CONTEXT_REVIEW_REASONS.has(reason),
  );
  if (!validation.ok) reviewReasons.push(validation.code);
  const explicitTimezone = resolveExplicitAgentTimezone(params.agent);
  if (params.agent.agendaAutomationEnabled === true && !explicitTimezone) {
    reviewReasons.push("agenda_timezone_required");
  }
  if (
    params.agent.followUpInteligente?.ativo === true &&
    params.agent.followUpInteligente.usarHorarioComercial !== false &&
    !explicitTimezone
  ) {
    reviewReasons.push("follow_up_timezone_required");
  }

  return {
    validation,
    blocked: params.agent.status === "ativo" && !validation.ok,
    reviewStatus: reviewReasons.length > 0 ? "action_required" : "ready",
    reviewReasons,
  };
}

export function describeAgentContextFailure(failure: AgentActivationContextFailure): {
  error: string;
  code: AgentActivationContextFailure["code"];
  contextValidation: AgentActivationContextFailure;
} {
  if (failure.code === "agent_context_overflow") {
    return {
      error:
        `O contexto obrigatório usa ${failure.overflow.requiredTokens} tokens, ` +
        `mas o modelo ${failure.model} aceita ${failure.overflow.maxInputTokens} tokens de entrada. ` +
        `Reduza ${failure.overflow.overflowTokens} tokens dos prompts configurados ou selecione um modelo autorizado com contexto maior.`,
      code: failure.code,
      contextValidation: failure,
    };
  }
  if (failure.code === "agent_invalid_language") {
    return {
      error: "O idioma configurado é inválido. Use Automático ou uma tag BCP-47 válida.",
      code: failure.code,
      contextValidation: failure,
    };
  }
  return {
    error: `O limite real de contexto do modelo ${failure.model} não está configurado.`,
    code: failure.code,
    contextValidation: failure,
  };
}
