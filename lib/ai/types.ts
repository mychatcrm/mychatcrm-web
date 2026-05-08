export type AiProvider = "openai";

export type AiFeature =
  | "site_chat_widget"
  | "agent_chat"
  | "agent_completion"
  | "agent_embedding"
  | "admin_tool";

export type AiRole = "user" | "assistant" | "system";

export type AiMessage = {
  role: AiRole;
  content: string;
};

export type AiGenerateInput = {
  tenantId: string;
  customerId?: string | null;
  agentId: string;
  feature: AiFeature;
  model?: string;
  messages: AiMessage[];
  metadata?: Record<string, string | number | boolean | null | undefined>;
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
