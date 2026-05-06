/**
 * OmniChat IA Hub — contratos e fontes de dados (Fase B do plano enterprise).
 *
 * ## Propósito do produto
 * A credencial configurada neste hub alimenta **apenas** a inferência dos **agentes de atendimento**
 * OmniChat (`generateAgentResponse`, `/api/chat`, webhooks). Não é “IA administrativa” genérica.
 *
 * ## Fontes de verdade (runtime)
 * | Dado | Origem | Notas |
 * |------|--------|-------|
 * | Chave efetiva OpenAI | `resolveOpenAiApiKey` → `OPENAI_API_KEY` env **ou** `admin_platform_openai` cifrado | Prioridade env |
 * | Chamadas modelo / tokens / custo | `ai_usage_logs` (Postgres) | Uma linha por request ao gateway; `feature` distingue fluxos |
 * | Billing OpenAI oficial | `GET /api/admin/ai/openai-account` → `fetchOpenAiAccountSnapshot` | Pode 403 com `sk-proj-*` |
 * | Estado integração | `GET /api/admin/ai/integration-status` → `getAiIntegrationStatus` | `lastSuccess` de `ai_usage_logs` |
 * | Agregados período | `getAiOverview`, `getAiTopTenants`, `getAiTopAgents`, `getAiLogs`, `getAiAlerts` | `lib/ai/admin-metrics.ts` |
 * | Série temporal | `getAiTimeseries` + `GET /api/admin/ai/timeseries` | Agregação diária no intervalo |
 * | Quotas (futuro billing) | `ai_usage_limits` + `GET /api/admin/ai/usage-limits` | Política no gateway ainda não ligada por defeito |
 * | Teste de ligação | `POST /api/admin/ai/test-connection` | Probe `GET /v1/models` com chave resolvida no servidor |
 *
 * ## Lacunas vs métricas “mensagens / atendimentos”
 * `ai_usage_logs` não garante 1:1 com mensagem WhatsApp; para isso seria necessário join com tabelas de conversa
 * ou enriquecimento de `metadata` no tracking — fora do MVP actual.
 */

export type { OpenAiTestConnectionPayload } from "@/lib/ai/admin-ia-hub-types";
