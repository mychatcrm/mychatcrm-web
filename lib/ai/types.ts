export type AiProvider = "openai";

export type AiFeature =
  | "site_chat_widget"
  | "agent_chat"
  | "agent_completion"
  | "agent_embedding"
  | "agent_wizard_instructions"
  | "admin_tool";

export type AiRole = "user" | "assistant" | "system";

export type AiMessage = {
  role: AiRole;
  content: string;
};

// ── Tool calling (OpenAI function calling) ────────────────────────────────────

export type AiToolParameterProperty = {
  type: string;
  description: string;
  enum?: string[];
};

export type AiToolParameterSchema = {
  type: "object";
  properties: Record<string, AiToolParameterProperty>;
  required?: string[];
};

export type AiToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: AiToolParameterSchema;
  };
};

/**
 * Um tool call retornado pelo modelo (OpenAI finish_reason='tool_calls').
 * `argumentsRaw` é a string JSON dos argumentos — pode estar malformada se o modelo
 * truncar; executores devem usar JSON.parse com try/catch.
 */
export type AiToolCall = {
  id: string;
  type: "function";
  function: { name: string; argumentsRaw: string };
};

/**
 * Mensagem de resultado de tool para incluir no histórico da conversa.
 * O campo `role` usa "tool" (suportado pelo OpenAI, mas diferente dos outros roles).
 */
export type AiToolResultMessage = {
  role: "tool";
  tool_call_id: string;
  content: string;
};

// ── Input/Output estendidos ───────────────────────────────────────────────────

export type AiGenerateInput = {
  tenantId: string;
  customerId?: string | null;
  agentId: string;
  feature: AiFeature;
  model?: string;
  temperature?: number;
  messages: (AiMessage | AiToolResultMessage)[];
  metadata?: Record<string, string | number | boolean | null | undefined>;
  /** Quando presente, habilita tool calling no OpenAI. Omitir = comportamento atual exato. */
  tools?: AiToolDefinition[];
  /** Controla se o modelo DEVE usar tools ou pode escolher. Default: "auto". */
  tool_choice?: "auto" | "none";
};

export type AiUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type AiGenerateSuccess = {
  ok: true;
  text: string;
  provider: AiProvider;
  model: string;
  usage: AiUsage;
  latencyMs: number;
  providerRequestId?: string;
  estimatedCostUsd: number;
  /**
   * Preenchido quando o modelo retornou tool_calls (finish_reason='tool_calls').
   * Quando presente, `text` é vazio — o chamador deve executar as tools,
   * adicionar os resultados ao histórico e chamar o modelo novamente.
   */
  tool_calls?: AiToolCall[];
  /**
   * Sinaliza que o loop de tool calling de agenda já executou uma ação neste turno.
   */
  agendaActionCompleted?: boolean;
  /** Detalhe da mutação de agenda quando tools agiram neste turno. */
  agendaMutation?: {
    action: "scheduled" | "rescheduled" | "cancelled";
    eventId?: string;
    previousEventId?: string;
    scheduleHandoffTriggered?: boolean;
  };
};

export type AiErrorCode =
  | "UNCONFIGURED"
  | "INVALID_INPUT"
  | "LIMIT_EXCEEDED"
  | "UPSTREAM_AUTH"
  | "UPSTREAM_RATE_LIMIT"
  | "UPSTREAM_ERROR"
  | "TIMEOUT"
  | "NETWORK"
  | "EMPTY_REPLY"
  | "MEDIA_DOWNLOAD_FAILED";

export type AiGenerateFailure = {
  ok: false;
  code: AiErrorCode;
  detail?: string;
  provider?: AiProvider;
  model?: string;
  latencyMs?: number;
  usage?: Partial<AiUsage>;
  estimatedCostUsd?: number;
};

export type AiGenerateResult = AiGenerateSuccess | AiGenerateFailure;
