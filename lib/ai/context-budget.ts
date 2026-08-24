import { encodingForModel, getEncoding, type Tiktoken } from "js-tiktoken";

import type {
  AiContextOverflow,
  AiMessage,
  AiMessageRetention,
  AiMessageSource,
} from "@/lib/ai/types";

export const DEFAULT_AI_MODEL = "gpt-4o-mini";
const DEFAULT_OUTPUT_RESERVE_TOKENS = 4_096;
const MESSAGE_OVERHEAD_TOKENS = 4;
const REQUEST_PRIMER_TOKENS = 3;

/**
 * Limites de contexto dos modelos que o produto aceita hoje. Modelos datados
 * herdam o limite da família. Um modelo desconhecido falha fechado, a menos
 * que o operador configure um limite explícito por variável de ambiente.
 */
const MODEL_CONTEXT_WINDOWS: ReadonlyArray<readonly [RegExp, number]> = [
  [/^gpt-4o(?:-mini)?(?:-|$)/, 128_000],
  [/^gpt-4\.1(?:-mini|-nano)?(?:-|$)/, 1_047_576],
  [/^gpt-4-turbo(?:-|$)/, 128_000],
  [/^gpt-3\.5-turbo(?:-|$)/, 16_385],
  [/^o(?:1|3|4)(?:-mini|-preview)?(?:-|$)/, 200_000],
];

export type BudgetedAiMessages = {
  ok: true;
  messages: AiMessage[];
  model: string;
  contextWindowTokens: number;
  maxInputTokens: number;
  inputTokens: number;
  requiredTokens: number;
  outputReserveTokens: number;
  dropped: Record<Exclude<AiMessageRetention, "required">, number>;
};

export type AiMessageBudgetFailure =
  | { ok: false; code: "unsupported_model_context_window"; model: string }
  | { ok: false; code: "agent_context_overflow"; overflow: AiContextOverflow };

export type BudgetAiMessagesOptions = {
  model: string;
  messages: AiMessage[];
  responseFormat?: { name: string; schema: Record<string, unknown> };
  /** Somente para validação e testes; produção usa o limite da família do modelo. */
  contextWindowTokens?: number;
  outputReserveTokens?: number;
};

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function modelEnvKey(model: string): string {
  return `AI_CONTEXT_WINDOW_${model.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

export function resolveModelContextWindowTokens(model: string): number | null {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return null;
  const explicit = positiveInteger(process.env[modelEnvKey(normalized)]);
  if (explicit) return explicit;
  return MODEL_CONTEXT_WINDOWS.find(([pattern]) => pattern.test(normalized))?.[1] ?? null;
}

export function resolveOutputReserveTokens(): number {
  return positiveInteger(process.env.AI_OUTPUT_RESERVE_TOKENS) ?? DEFAULT_OUTPUT_RESERVE_TOKENS;
}

/** Mantém validação, simulação e gateway na mesma resolução efetiva de modelo. */
export function resolveAiRequestModel(model?: string | null): string {
  return model?.trim() || process.env.OPENAI_CHAT_MODEL?.trim() || DEFAULT_AI_MODEL;
}

function tokenizerForModel(model: string): Tiktoken {
  try {
    return encodingForModel(model as Parameters<typeof encodingForModel>[0]);
  } catch {
    // Todas as famílias atualmente autorizadas usam um destes dois vocabulários.
    return getEncoding(/^gpt-4o|^gpt-4\.1|^o[134]/i.test(model) ? "o200k_base" : "cl100k_base");
  }
}

function messageTokens(encoder: Tiktoken, message: AiMessage): number {
  return (
    MESSAGE_OVERHEAD_TOKENS +
    encoder.encode(message.role).length +
    encoder.encode(message.content).length
  );
}

function responseFormatTokens(
  encoder: Tiktoken,
  responseFormat: BudgetAiMessagesOptions["responseFormat"],
): number {
  if (!responseFormat) return 0;
  return encoder.encode(JSON.stringify(responseFormat)).length;
}

function defaultRetention(params: {
  message: AiMessage;
  index: number;
  lastUserIndex: number;
  lastMessageIndex: number;
}): AiMessageRetention {
  const { message, index, lastUserIndex, lastMessageIndex } = params;
  if (message.role === "system") return "required";
  if (message.source === "client_prompt" || message.source === "technical_rules") return "required";
  if (message.source === "current_message" || message.source === "confirmed_tool_result") {
    return "required";
  }
  if (message.retention) return message.retention;
  if (index === (lastUserIndex >= 0 ? lastUserIndex : lastMessageIndex)) return "required";
  return "history";
}

function validMessages(messages: AiMessage[]): AiMessage[] {
  const roles = new Set(["system", "user", "assistant"]);
  return messages.filter(
    (message) =>
      roles.has(message.role) &&
      typeof message.content === "string" &&
      message.content.trim().length > 0,
  );
}

/**
 * Orça o request sem modificar o conteúdo de nenhuma mensagem. Se faltar
 * espaço, remove mensagens opcionais inteiras; nunca corta bytes no meio de um
 * prompt, da mensagem atual ou de um resultado confirmado de ferramenta.
 */
export function budgetAiMessagesForModel(
  options: BudgetAiMessagesOptions,
): BudgetedAiMessages | AiMessageBudgetFailure {
  const model = options.model.trim();
  const contextWindowTokens =
    positiveInteger(options.contextWindowTokens) ?? resolveModelContextWindowTokens(model);
  if (!contextWindowTokens) {
    return { ok: false, code: "unsupported_model_context_window", model };
  }
  const outputReserveTokens =
    positiveInteger(options.outputReserveTokens) ?? resolveOutputReserveTokens();
  const maxInputTokens = Math.max(0, contextWindowTokens - outputReserveTokens);
  const messages = validMessages(options.messages);
  const lastUserIndex = messages.findLastIndex((message) => message.role === "user");
  const lastMessageIndex = messages.length - 1;
  const encoder = tokenizerForModel(model);
  const schemaTokens = responseFormatTokens(encoder, options.responseFormat);
  const tokenCounts = messages.map((message) => messageTokens(encoder, message));
  const retentions = messages.map((message, index) =>
    defaultRetention({ message, index, lastUserIndex, lastMessageIndex }),
  );

  const requiredIndexes = retentions.flatMap((retention, index) =>
    retention === "required" ? [index] : [],
  );
  const requiredTokens =
    REQUEST_PRIMER_TOKENS +
    schemaTokens +
    requiredIndexes.reduce((sum, index) => sum + tokenCounts[index]!, 0);

  if (requiredTokens > maxInputTokens) {
    const overflowTokens = requiredTokens - maxInputTokens;
    return {
      ok: false,
      code: "agent_context_overflow",
      overflow: {
        model,
        contextWindowTokens,
        maxInputTokens,
        requiredTokens,
        overflowTokens,
        correction:
          "Reduce the configured client prompts or select an authorized model with a larger context window. Required content was not truncated.",
      },
    };
  }

  const selected = new Set(requiredIndexes);
  let inputTokens = requiredTokens;
  const trySelect = (index: number) => {
    const cost = tokenCounts[index]!;
    if (selected.has(index) || inputTokens + cost > maxInputTokens) return;
    selected.add(index);
    inputTokens += cost;
  };

  // Continuidade recente antes de material recuperado; dentro de cada classe,
  // histórico favorece o mais novo e recuperação preserva a ordem de relevância.
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (retentions[index] === "history") trySelect(index);
  }
  for (let index = 0; index < messages.length; index += 1) {
    if (retentions[index] === "retrieval") trySelect(index);
  }
  for (let index = 0; index < messages.length; index += 1) {
    if (retentions[index] === "auxiliary") trySelect(index);
  }

  const dropped: BudgetedAiMessages["dropped"] = {
    history: 0,
    retrieval: 0,
    auxiliary: 0,
  };
  retentions.forEach((retention, index) => {
    if (retention !== "required" && !selected.has(index)) dropped[retention] += 1;
  });

  return {
    ok: true,
    messages: messages.filter((_, index) => selected.has(index)),
    model,
    contextWindowTokens,
    maxInputTokens,
    inputTokens,
    requiredTokens,
    outputReserveTokens,
    dropped,
  };
}

export function requiredAiMessage(
  role: AiMessage["role"],
  content: string,
  source: Extract<
    AiMessageSource,
    "technical_rules" | "client_prompt" | "current_message" | "confirmed_tool_result"
  >,
): AiMessage {
  return { role, content, retention: "required", source };
}
