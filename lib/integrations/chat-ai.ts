import { resolveOpenAiApiKey } from "@/lib/ai/openai-api-key";
import { integrationLog } from "./logger";
import { SITE_MARKETING_CHAT_SYSTEM_PROMPT } from "./chat-prompts";
import { isUsableApiSecret } from "./server-secrets";

export type ChatAiProvider = "openai" | "anthropic";

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type ChatAiConfig = {
  provider: ChatAiProvider;
  apiKey: string;
};

const DEFAULT_TIMEOUT_MS = 25_000;

/** Só variáveis de ambiente (OpenAI não inclui chave guardada no painel). */
export function resolveChatAiConfigFromEnv(): ChatAiConfig | null {
  const providerRaw = process.env.CHAT_AI_PROVIDER?.toLowerCase();
  const provider: ChatAiProvider = providerRaw === "anthropic" ? "anthropic" : "openai";
  const apiKey =
    provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
  if (!isUsableApiSecret(apiKey)) return null;
  return { provider, apiKey: apiKey!.trim() };
}

/** OpenAI: `OPENAI_API_KEY` ou chave cifrada no Supabase; Anthropic: só env. */
export async function resolveChatAiConfig(): Promise<ChatAiConfig | null> {
  const providerRaw = process.env.CHAT_AI_PROVIDER?.toLowerCase();
  const provider: ChatAiProvider = providerRaw === "anthropic" ? "anthropic" : "openai";
  if (provider === "anthropic") {
    const raw = process.env.ANTHROPIC_API_KEY;
    if (!isUsableApiSecret(raw)) return null;
    return { provider: "anthropic", apiKey: raw!.trim() };
  }
  const apiKey = await resolveOpenAiApiKey();
  if (!apiKey) return null;
  return { provider: "openai", apiKey };
}

function mapProviderHttpStatus(provider: ChatAiProvider, status: number): string {
  return provider === "anthropic" ? `ANTHROPIC_${status}` : `OPENAI_${status}`;
}

async function askOpenAI(
  messages: ChatTurn[],
  apiKey: string,
  systemPrompt: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_CHAT_MODEL?.trim() || "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(mapProviderHttpStatus("openai", response.status));
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() || "";
}

async function askAnthropic(
  messages: ChatTurn[],
  apiKey: string,
  systemPrompt: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_CHAT_MODEL?.trim() || "claude-3-haiku-20240307",
      max_tokens: 600,
      temperature: 0.4,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    }),
  });

  if (!response.ok) {
    throw new Error(mapProviderHttpStatus("anthropic", response.status));
  }

  const data = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  return (
    data.content
      ?.filter((item) => item.type === "text")
      .map((item) => item.text || "")
      .join("")
      .trim() || ""
  );
}

export type ChatAiCompleteOk = { ok: true; text: string; provider: ChatAiProvider };
export type ChatAiCompleteErr = {
  ok: false;
  code: "UNCONFIGURED" | "EMPTY_REPLY" | "UPSTREAM" | "TIMEOUT" | "NETWORK";
  provider?: ChatAiProvider;
  detail?: string;
};

export async function completeMarketingChat(
  messages: ChatTurn[],
  options?: { timeoutMs?: number; systemPrompt?: string },
): Promise<ChatAiCompleteOk | ChatAiCompleteErr> {
  const config = await resolveChatAiConfig();
  if (!config) {
    integrationLog("chat-ai", "warn", "Provedor de IA não configurado ou secret inválido");
    return { ok: false, code: "UNCONFIGURED" };
  }

  const systemPrompt = options?.systemPrompt?.trim() || SITE_MARKETING_CHAT_SYSTEM_PROMPT;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const text =
      config.provider === "anthropic"
        ? await askAnthropic(messages, config.apiKey, systemPrompt, controller.signal)
        : await askOpenAI(messages, config.apiKey, systemPrompt, controller.signal);

    if (!text) {
      integrationLog("chat-ai", "warn", "Resposta vazia do provedor", { provider: config.provider });
      return { ok: false, code: "EMPTY_REPLY", provider: config.provider };
    }
    return { ok: true, text, provider: config.provider };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    if (err instanceof Error && err.name === "AbortError") {
      integrationLog("chat-ai", "warn", "Timeout na chamada ao provedor", { provider: config.provider });
      return { ok: false, code: "TIMEOUT", provider: config.provider };
    }
    integrationLog("chat-ai", "error", "Falha na chamada ao provedor", {
      provider: config.provider,
      detail: msg.slice(0, 80),
    });
    if (/_(401|403)\b/.test(msg)) {
      return { ok: false, code: "UPSTREAM", provider: config.provider, detail: msg };
    }
    if (/_(429)\b/.test(msg)) {
      return { ok: false, code: "UPSTREAM", provider: config.provider, detail: msg };
    }
    if (/OPENAI_|ANTHROPIC_/.test(msg)) {
      return { ok: false, code: "UPSTREAM", provider: config.provider, detail: msg };
    }
    return { ok: false, code: "NETWORK", provider: config.provider, detail: msg };
  } finally {
    clearTimeout(timer);
  }
}
