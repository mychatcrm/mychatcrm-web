export type ExternalApiAuthType = "none" | "bearer" | "api_key" | "basic";
export type ExternalApiMethod = "GET" | "POST";
export type ExternalApiParameterLocation = "path" | "query" | "body";
export type ExternalApiParameterType = "string" | "number" | "boolean";

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
};

export type ExternalApiConnectorInput = {
  name: string;
  description: string;
  baseUrl: string;
  authType: ExternalApiAuthType;
  authHeaderName?: string;
  authUsername?: string;
  secret?: string;
  enabled: boolean;
  operations: ExternalApiOperationInput[];
};

export type ExternalApiConnectorSummary = {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  authType: ExternalApiAuthType;
  authHeaderName: string | null;
  authUsername: string | null;
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
};
