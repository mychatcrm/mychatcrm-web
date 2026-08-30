export type ExternalApiAuthType = "none" | "bearer" | "api_key" | "basic" | "oauth2_client_credentials";
export type ExternalApiMethod = "GET" | "POST";
export type ExternalApiParameterLocation = "path" | "query" | "body";
export type ExternalApiParameterType = "string" | "number" | "boolean";

/** Só usada pelo motor de sincronização — a consulta ao vivo do agente durante a conversa continua página única. */
export type ExternalApiPaginationMode = "none" | "page_param" | "cursor_param";
export type ExternalApiPagination = {
  mode: ExternalApiPaginationMode;
  /** Nome do parâmetro de número de página (mode "page_param"). */
  pageParam?: string;
  pageSizeParam?: string;
  pageSize?: number;
  /** Caminho JSON, no corpo da resposta, de onde vem o cursor da próxima página (mode "cursor_param"). */
  cursorPath?: string;
  maxPages: number;
};

export type ExternalApiParameterDefinition = {
  name: string;
  in: ExternalApiParameterLocation;
  type: ExternalApiParameterType;
  required: boolean;
  description: string;
};

export type ExternalApiResponseMapping = {
  itemsPath?: string;
  id?: string;
  title?: string;
  availability?: string;
  price?: string;
  currency?: string;
  link?: string;
  media?: string;
  attributes?: Record<string, string>;
};

export type ExternalApiOperationInput = {
  id?: string;
  operationKey: string;
  name: string;
  description: string;
  method: ExternalApiMethod;
  pathTemplate: string;
  parameters: ExternalApiParameterDefinition[];
  responseMapping: ExternalApiResponseMapping;
  cacheTtlSeconds: 0 | 30 | 60 | 120 | 300;
  enabled: boolean;
  pagination?: ExternalApiPagination;
};

/** Allowlist da UI — mesmo espírito de `cacheTtlSeconds` já restrito a um conjunto fixo. */
export const EXTERNAL_API_SYNC_FREQUENCIES_MINUTES = [30, 60, 180, 360, 720, 1440] as const;
export type ExternalApiSyncFrequencyMinutes = (typeof EXTERNAL_API_SYNC_FREQUENCIES_MINUTES)[number];

export type ExternalApiConnectorInput = {
  name: string;
  description: string;
  baseUrl: string;
  authType: ExternalApiAuthType;
  authHeaderName?: string;
  authUsername?: string;
  secret?: string;
  /** Só usados quando authType === "oauth2_client_credentials". Não são segredo (client_secret vai em `secret`). */
  oauthTokenUrl?: string;
  oauthClientId?: string;
  environment?: "sandbox" | "production";
  enabled: boolean;
  operations?: ExternalApiOperationInput[];
  /** Sincronização do catálogo interno — ausente/false = comportamento de sempre (consulta ao vivo). */
  syncEnabled?: boolean;
  /** operationKey de qual operação é a "listagem" fonte da sincronização. Obrigatório quando syncEnabled. */
  syncOperationKey?: string | null;
  syncFrequencyMinutes?: ExternalApiSyncFrequencyMinutes | null;
};

export type ExternalApiConnectorSummary = {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  authType: ExternalApiAuthType;
  authHeaderName: string | null;
  authUsername: string | null;
  oauthTokenUrl: string | null;
  oauthClientId: string | null;
  environment: "sandbox" | "production";
  credentialConfigured: boolean;
  credentialMask: string | null;
  enabled: boolean;
  isPrimary: boolean;
  effective: boolean;
  billingStatus: "included" | "extra_active" | "suspended";
  healthStatus: "untested" | "healthy" | "degraded" | "error";
  lastHealthAt: string | null;
  lastErrorCode: string | null;
  agentCount: number;
  operations: ExternalApiOperationInput[];
  syncEnabled: boolean;
  syncOperationKey: string | null;
  syncFrequencyMinutes: ExternalApiSyncFrequencyMinutes | null;
  lastSyncAt: string | null;
  lastSyncStatus: "success" | "error" | null;
  lastSyncError: string | null;
  lastSyncItemCount: number | null;
  createdAt: string;
  updatedAt: string;
};

export type ExternalApiCapacity = {
  included: 1;
  purchased: number;
  total: number;
  used: number;
};

export type ExternalApiNormalizedRecord = {
  id: string | null;
  title: string | null;
  availability: string | number | boolean | null;
  price: string | number | null;
  currency: string | null;
  link: string | null;
  media: string[];
  attributes: Record<string, string | number | boolean | null>;
};

export type ExternalApiNormalizedResult = {
  records: ExternalApiNormalizedRecord[];
  truncated: boolean;
};

export type AgentExternalApiLookupRequest = {
  connectorId: string;
  operationKey: string;
  arguments: Array<{ name: string; value: string | number | boolean }>;
};

export type AgentExternalApiLookupResult = {
  connectorId: string;
  connectorName: string;
  operationKey: string;
  operationName: string;
  ok: boolean;
  data?: ExternalApiNormalizedResult;
  errorCode?: string;
  /** Status HTTP real da falha, quando existe (ex.: 404, 500) — só pra diagnóstico humano no painel; o agente usa `errorCode`. */
  httpStatus?: number | null;
};

/**
 * Item do catálogo interno sincronizado (`external_api_catalog_items`). 100%
 * genérico — nenhum campo presume o que o tenant vende; qualquer coisa
 * específica de negócio vive em `attributes`, preenchido pelo mesmo
 * `responseMapping.attributes` que já existe hoje.
 */
export type ExternalApiCatalogItem = {
  id: string;
  connectorId: string;
  externalId: string;
  title: string | null;
  description: string | null;
  price: number | null;
  currency: string | null;
  availability: string | null;
  link: string | null;
  media: string[];
  attributes: Record<string, string | number | boolean | null>;
  isActive: boolean;
  sourceUpdatedAt: string | null;
  lastSyncedAt: string;
};
