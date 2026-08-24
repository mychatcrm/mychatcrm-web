import type { AgentExternalApiLookupRequest } from "@/lib/external-api/types";

export type AiProvider = "openai";

export type AiFeature =
  | "site_chat_widget"
  | "agent_chat"
  | "agent_completion"
  | "agent_embedding"
  | "agent_wizard_instructions"
  | "admin_tool";

export type AiRole = "user" | "assistant" | "system";

export type AiMessageRetention = "required" | "history" | "retrieval" | "auxiliary";

export type AiMessageSource =
  | "technical_rules"
  | "client_prompt"
  | "current_message"
  | "confirmed_tool_result"
  | "conversation_history"
  | "retrieved_material"
  | "auxiliary_data";

export type AiMessage = {
  role: AiRole;
  content: string;
  /**
   * Política local de orçamento. Não é enviada ao provedor.
   *
   * Ausente mantém compatibilidade: mensagens `system` e a mensagem final são
   * obrigatórias; as demais são histórico redutível.
   */
  retention?: AiMessageRetention;
  source?: AiMessageSource;
};

export type AiGenerateInput = {
  tenantId: string;
  customerId?: string | null;
  agentId: string;
  feature: AiFeature;
  model?: string;
  temperature?: number;
  messages: AiMessage[];
  metadata?: Record<string, string | number | boolean | null | undefined>;
  responseFormat?: {
    name: string;
    schema: Record<string, unknown>;
  };
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
  structuredData?: unknown;
  /** Consultas GET já executadas pelo orquestrador; nunca são comandos pendentes. */
  externalApiLookupTrace?: AgentExternalApiLookupRequest[];
};

export type AiErrorCode =
  | "UNCONFIGURED"
  | "INVALID_INPUT"
  | "LIMIT_EXCEEDED"
  | "UPSTREAM_AUTH"
  | "UPSTREAM_RATE_LIMIT"
  /** Faturamento da OpenAI: sem crédito ou teto de gasto atingido. Repetir não resolve. */
  | "UPSTREAM_QUOTA"
  | "UPSTREAM_ERROR"
  | "TIMEOUT"
  | "NETWORK"
  | "EMPTY_REPLY"
  | "INVALID_STRUCTURED_REPLY"
  | "REFUSED"
  | "MEDIA_DOWNLOAD_FAILED"
  | "AGENT_CONTEXT_OVERFLOW";

export type AiContextOverflow = {
  model: string;
  contextWindowTokens: number;
  maxInputTokens: number;
  requiredTokens: number;
  overflowTokens: number;
  correction: string;
};

export type AiGenerateFailure = {
  ok: false;
  code: AiErrorCode;
  detail?: string;
  provider?: AiProvider;
  model?: string;
  latencyMs?: number;
  usage?: Partial<AiUsage>;
  estimatedCostUsd?: number;
  contextOverflow?: AiContextOverflow;
};

export type AiGenerateResult = AiGenerateSuccess | AiGenerateFailure;
