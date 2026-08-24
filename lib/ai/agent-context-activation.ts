import { buildAgentSystemPrompt } from "@/lib/ai/agent-system-prompt";
import { AGENT_TURN_RESPONSE_FORMAT } from "@/lib/ai/agent-turn-plan";
import { compileAgentContextV2 } from "@/lib/ai/compiled-agent-context-v2";
import {
  budgetAiMessagesForModel,
  resolveAiRequestModel,
} from "@/lib/ai/context-budget";
import { buildAgentLanguageInstruction } from "@/lib/ai/language-detect";
import type { AiContextOverflow } from "@/lib/ai/types";
import type { Agent } from "@/lib/types";

const ACTIVATION_PROBE_MESSAGE = "Context validation probe.";

export type AgentActivationContextBudget = {
  ok: true;
  model: string;
  contextVersion: 2;
  contextWindowTokens: number;
  maxInputTokens: number;
  requiredTokens: number;
  outputReserveTokens: number;
};

export type AgentActivationContextFailure =
  | {
      ok: false;
      code: "agent_context_overflow";
      model: string;
      overflow: AiContextOverflow;
    }
  | {
      ok: false;
      code: "agent_model_context_window_unknown";
      model: string;
      correction: string;
    }
  | {
      ok: false;
      code: "agent_invalid_language";
      model: string;
      detail: string;
      correction: string;
    };

export type AgentActivationContextValidation =
  | AgentActivationContextBudget
  | AgentActivationContextFailure;

/**
 * Mede exatamente o conjunto obrigatório que uma configuração ativa envia ao
 * provedor: regras técnicas, prompt(s) soberano(s), schema e mensagem atual.
 * Conteúdo opcional não participa da aprovação porque o gateway pode removê-lo
 * de forma segura em cada turno; nenhuma parte obrigatória é truncada.
 */
export function validateAgentActivationContext(params: {
  agent: Partial<Agent>;
  model?: string | null;
  /** Overrides exclusivamente para teste do algoritmo; rotas usam o limite real. */
  contextWindowTokens?: number;
  outputReserveTokens?: number;
}): AgentActivationContextValidation {
  const model = resolveAiRequestModel(params.model);
  const language = buildAgentLanguageInstruction(
    params.agent.idioma,
    ACTIVATION_PROBE_MESSAGE,
  );
  if (!language.ok) {
    return {
      ok: false,
      code: "agent_invalid_language",
      model,
      detail: language.detail,
      correction: "Configure Automatic or a valid BCP-47 language tag.",
    };
  }

  const technicalSystemPrompt = buildAgentSystemPrompt({
    agent: params.agent,
    languageInstruction: language.instruction,
    includeClientInstructions: false,
    includeRuntimeData: false,
  });
  const compiled = compileAgentContextV2({
    agent: params.agent,
    technicalSystemPrompt,
    currentMessages: [{ role: "user", content: ACTIVATION_PROBE_MESSAGE }],
  });
  const budget = budgetAiMessagesForModel({
    model,
    messages: compiled.messages,
    responseFormat: AGENT_TURN_RESPONSE_FORMAT,
    contextWindowTokens: params.contextWindowTokens,
    outputReserveTokens: params.outputReserveTokens,
  });

  if (!budget.ok) {
    if (budget.code === "unsupported_model_context_window") {
      return {
        ok: false,
        code: "agent_model_context_window_unknown",
        model,
        correction:
          "Select an authorized model with a known context window or configure its exact context limit.",
      };
    }
    return {
      ok: false,
      code: "agent_context_overflow",
      model,
      overflow: budget.overflow,
    };
  }

  return {
    ok: true,
    model,
    contextVersion: 2,
    contextWindowTokens: budget.contextWindowTokens,
    maxInputTokens: budget.maxInputTokens,
    requiredTokens: budget.requiredTokens,
    outputReserveTokens: budget.outputReserveTokens,
  };
}
