/**
 * Camada de integrações externas (servidor e adapters).
 * UI e rotas devem usar estes módulos em vez de `fetch` directo a provedores.
 */

export { integrationLog } from "./logger";
export { isUsableApiSecret } from "./server-secrets";
export { SITE_MARKETING_CHAT_SYSTEM_PROMPT } from "./chat-prompts";
export {
  completeMarketingChat,
  resolveChatAiConfigFromEnv,
  type ChatAiProvider,
  type ChatTurn,
  type ChatAiCompleteOk,
  type ChatAiCompleteErr,
} from "./chat-ai";
