import "server-only";

import {
  EXTERNAL_API_SYNC_FREQUENCIES_MINUTES,
  type ExternalApiAuthType,
  type ExternalApiConnectorInput,
  type ExternalApiOperationInput,
  type ExternalApiPagination,
  type ExternalApiParameterDefinition,
  type ExternalApiSyncFrequencyMinutes,
} from "@/lib/external-api/types";
import { createStandardExternalApiOperations } from "@/lib/external-api/standard-contract";
import {
  isBlockedExternalApiIp,
  normalizedIpLiteral,
} from "@/lib/server/external-api-network-policy";

const OPERATION_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const PARAMETER_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,80}$/;
const SAFE_CACHE_TTLS = new Set([0, 30, 60, 120, 300]);
const BLOCKED_HOST_SUFFIXES = [".local", ".internal", ".localhost", ".home", ".lan"];
const DANGEROUS_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
const PAGINATION_MODES = new Set<string>(["none", "page_param", "cursor_param"]);
const MAX_SYNC_PAGES = 50;

export type ValidatedExternalApiConnectorInput = ExternalApiConnectorInput & {
  baseUrl: string;
  baseOrigin: string;
  authHeaderName?: string;
  operations: ExternalApiOperationInput[];
  oauthTokenUrl?: string;
  oauthClientId?: string;
  environment: "sandbox" | "production";
  syncEnabled: boolean;
  syncOperationKey: string | null;
  syncFrequencyMinutes: ExternalApiSyncFrequencyMinutes | null;
};

/** Host bloqueado (privado/loopback/metadata da nuvem) — mesma regra pra base_url e pra oauth_token_url. */
function assertPublicHttpsHost(url: URL): void {
  if (url.protocol !== "https:" || (url.port && url.port !== "443")) {
    throw new Error("external_api_https_required");
  }
  const hostname = url.hostname.toLowerCase();
  const literalIp = normalizedIpLiteral(hostname);
  if (
    (literalIp && isBlockedExternalApiIp(literalIp)) ||
    hostname === "localhost" ||
    hostname === "metadata.google.internal" ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new Error("external_api_private_host_blocked");
  }
}

function validateJsonPath(path: unknown, field: string, allowEmpty = true): string {
  const value = typeof path === "string" ? path.trim() : "";
  if (!value && allowEmpty) return "";
  if (!value || value.length > 240) throw new Error(`external_api_invalid_${field}`);
  const parts = value.split(".");
  if (parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part) || DANGEROUS_PATH_SEGMENTS.has(part))) {
    throw new Error(`external_api_invalid_${field}`);
  }
  return value;
}

export function normalizeExternalApiBaseUrl(raw: string): { baseUrl: string; baseOrigin: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("external_api_invalid_base_url");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("external_api_invalid_base_url");
  }
  assertPublicHttpsHost(url);
  url.hostname = url.hostname.toLowerCase();
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return { baseUrl: url.toString(), baseOrigin: url.origin };
}

/** URL do endpoint de token OAuth2 — mesma checagem de host de `normalizeExternalApiBaseUrl`, sem forçar barra final (endpoint exato, não base de caminho). */
function validateOAuthTokenUrl(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) throw new Error("external_api_oauth_token_url_required");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("external_api_invalid_oauth_token_url");
  }
  if (url.username || url.password) throw new Error("external_api_invalid_oauth_token_url");
  assertPublicHttpsHost(url);
  return url.toString();
}

/** Meia-configuração de paginação (mode !== "none" sem os parâmetros que ele exige) vira "none" — nunca trava a sincronização com config incompleta. */
function validatePagination(raw: unknown): ExternalApiPagination {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const mode: ExternalApiPagination["mode"] = typeof value.mode === "string" && PAGINATION_MODES.has(value.mode)
    ? (value.mode as ExternalApiPagination["mode"]) : "none";
  const maxPagesRaw = Number(value.maxPages);
  const maxPages = Number.isFinite(maxPagesRaw) && maxPagesRaw >= 1
    ? Math.min(MAX_SYNC_PAGES, Math.floor(maxPagesRaw))
    : 10;
  const pageParam = typeof value.pageParam === "string" ? value.pageParam.trim().slice(0, 64) : "";
  const pageSizeParam = typeof value.pageSizeParam === "string" ? value.pageSizeParam.trim().slice(0, 64) : "";
  const pageSizeRaw = Number(value.pageSize);
  const pageSize = Number.isFinite(pageSizeRaw) && pageSizeRaw >= 1 ? Math.min(500, Math.floor(pageSizeRaw)) : undefined;
  const cursorPath = typeof value.cursorPath === "string" ? value.cursorPath.trim().slice(0, 240) : "";

  if (mode === "page_param" && !pageParam) return { mode: "none", maxPages };
  if (mode === "cursor_param" && !cursorPath) return { mode: "none", maxPages };

  return {
    mode,
    maxPages,
    ...(pageParam ? { pageParam } : {}),
    ...(pageSizeParam ? { pageSizeParam } : {}),
    ...(pageSize ? { pageSize } : {}),
    ...(cursorPath ? { cursorPath } : {}),
  };
}

function validateParameter(parameter: ExternalApiParameterDefinition): ExternalApiParameterDefinition {
  const name = parameter.name?.trim();
  if (!name || !PARAMETER_NAME.test(name)) throw new Error("external_api_invalid_parameter_name");
  if (!new Set(["path", "query", "body"]).has(parameter.in)) {
    throw new Error("external_api_invalid_parameter_location");
  }
  if (!new Set(["string", "number", "boolean"]).has(parameter.type)) {
    throw new Error("external_api_invalid_parameter_type");
  }
  return {
    name,
    in: parameter.in,
    type: parameter.type,
    required: parameter.required === true,
    description: String(parameter.description ?? "").trim().slice(0, 300),
  };
}

function validateOperation(operation: ExternalApiOperationInput): ExternalApiOperationInput {
  const operationKey = operation.operationKey?.trim().toLowerCase();
  if (!OPERATION_KEY.test(operationKey)) throw new Error("external_api_invalid_operation_key");
  const name = operation.name?.trim();
  if (!name || name.length > 100) throw new Error("external_api_invalid_operation_name");
  if (operation.method !== "GET") {
    throw new Error("external_api_read_only_method_required");
  }
  const pathTemplate = operation.pathTemplate?.trim();
  if (!pathTemplate?.startsWith("/") || pathTemplate.length > 1024 || /[?#]/.test(pathTemplate)) {
    throw new Error("external_api_invalid_operation_path");
  }
  if (/^\/\//.test(pathTemplate) || /(?:^|\/)\.\.(?:\/|$)/.test(pathTemplate)) {
    throw new Error("external_api_invalid_operation_path");
  }
  const parameters = Array.isArray(operation.parameters)
    ? operation.parameters.map(validateParameter)
    : [];
  if (parameters.length > 20 || new Set(parameters.map((item) => item.name)).size !== parameters.length) {
    throw new Error("external_api_invalid_parameters");
  }
  if (parameters.some((item) => item.in === "body")) {
    throw new Error("external_api_get_body_not_allowed");
  }
  const placeholders = [...pathTemplate.matchAll(/\{([A-Za-z][A-Za-z0-9_]{0,63})\}/g)].map((match) => match[1]);
  const pathParams = parameters.filter((item) => item.in === "path").map((item) => item.name);
  if (
    placeholders.some((name) => !pathParams.includes(name)) ||
    pathParams.some((name) => !placeholders.includes(name))
  ) {
    throw new Error("external_api_path_parameters_mismatch");
  }
  const mapping = operation.responseMapping ?? {};
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(mapping.attributes ?? {})) {
    const safeKey = key.trim();
    if (!safeKey || safeKey.length > 80 || Object.keys(attributes).length >= 30) {
      throw new Error("external_api_invalid_response_attributes");
    }
    attributes[safeKey] = validateJsonPath(value, "response_mapping", false);
  }
  const cacheTtlSeconds = Number(operation.cacheTtlSeconds);
  if (!SAFE_CACHE_TTLS.has(cacheTtlSeconds)) throw new Error("external_api_invalid_cache_ttl");
  return {
    ...(operation.id ? { id: operation.id } : {}),
    operationKey,
    name,
    description: String(operation.description ?? "").trim().slice(0, 1000),
    method: operation.method,
    pathTemplate,
    parameters,
    responseMapping: {
      itemsPath: validateJsonPath(mapping.itemsPath, "items_path") || undefined,
      id: validateJsonPath(mapping.id, "response_mapping") || undefined,
      title: validateJsonPath(mapping.title, "response_mapping") || undefined,
      availability: validateJsonPath(mapping.availability, "response_mapping") || undefined,
      price: validateJsonPath(mapping.price, "response_mapping") || undefined,
      currency: validateJsonPath(mapping.currency, "response_mapping") || undefined,
      link: validateJsonPath(mapping.link, "response_mapping") || undefined,
      media: validateJsonPath(mapping.media, "response_mapping") || undefined,
      attributes,
    },
    cacheTtlSeconds: cacheTtlSeconds as ExternalApiOperationInput["cacheTtlSeconds"],
    enabled: operation.enabled !== false,
    pagination: validatePagination(operation.pagination),
  };
}

export function validateExternalApiConnectorInput(input: ExternalApiConnectorInput): ValidatedExternalApiConnectorInput {
  const name = input.name?.trim();
  if (!name || name.length > 100) throw new Error("external_api_invalid_name");
  const authTypes = new Set<ExternalApiAuthType>(["none", "bearer", "api_key", "basic", "oauth2_client_credentials"]);
  if (!authTypes.has(input.authType)) throw new Error("external_api_invalid_auth_type");
  const { baseUrl, baseOrigin } = normalizeExternalApiBaseUrl(input.baseUrl);
  const operations = Array.isArray(input.operations) && input.operations.length
    ? input.operations.map(validateOperation)
    : createStandardExternalApiOperations().map(validateOperation);
  if (operations.length < 1 || operations.length > 10) throw new Error("external_api_operation_count");
  if (new Set(operations.map((item) => item.operationKey)).size !== operations.length) {
    throw new Error("external_api_duplicate_operation_key");
  }
  const authHeaderName = input.authType === "api_key"
    ? (input.authHeaderName?.trim() || "X-Api-Key")
    : undefined;
  if (authHeaderName && (!HEADER_NAME.test(authHeaderName) || /^(host|content-length|connection)$/i.test(authHeaderName))) {
    throw new Error("external_api_invalid_auth_header");
  }
  const authUsername = input.authType === "basic" ? input.authUsername?.trim().slice(0, 200) : undefined;
  if (input.authType === "basic" && !authUsername) throw new Error("external_api_basic_username_required");

  const oauthTokenUrl = input.authType === "oauth2_client_credentials" ? validateOAuthTokenUrl(input.oauthTokenUrl) : undefined;
  const oauthClientId = input.authType === "oauth2_client_credentials" ? input.oauthClientId?.trim().slice(0, 300) : undefined;
  if (input.authType === "oauth2_client_credentials" && !oauthClientId) throw new Error("external_api_oauth_client_id_required");

  const environment = input.environment === "sandbox" ? "sandbox" : "production";

  // Sync desligado zera o resto — meia-configuração não sincroniza nada,
  // mesma regra usada em outras features do app (janela de envio, destino de
  // lead) pra nunca deixar um estado incompleto silenciosamente ativo.
  const syncEnabled = input.syncEnabled === true;
  let syncOperationKey: string | null = null;
  let syncFrequencyMinutes: ExternalApiSyncFrequencyMinutes | null = null;
  if (syncEnabled) {
    const requestedKey = input.syncOperationKey?.trim().toLowerCase();
    if (!requestedKey || !operations.some((op) => op.operationKey === requestedKey)) {
      throw new Error("external_api_sync_operation_required");
    }
    syncOperationKey = requestedKey;
    const requestedFrequency = Number(input.syncFrequencyMinutes);
    if (!(EXTERNAL_API_SYNC_FREQUENCIES_MINUTES as readonly number[]).includes(requestedFrequency)) {
      throw new Error("external_api_sync_frequency_required");
    }
    syncFrequencyMinutes = requestedFrequency as ExternalApiSyncFrequencyMinutes;
  }

  return {
    name,
    description: String(input.description ?? "").trim().slice(0, 1000),
    baseUrl,
    baseOrigin,
    authType: input.authType,
    authHeaderName,
    authUsername,
    oauthTokenUrl,
    oauthClientId,
    environment,
    secret: typeof input.secret === "string" ? input.secret.trim() : undefined,
    enabled: input.enabled === true,
    operations,
    syncEnabled,
    syncOperationKey,
    syncFrequencyMinutes,
  };
}

export function externalApiCredentialFromInput(
  input: Pick<ValidatedExternalApiConnectorInput, "authType" | "authUsername" | "secret">,
): Record<string, string> | null {
  if (input.authType === "none") return null;
  const secret = input.secret?.trim();
  if (!secret || secret.length > 4096) throw new Error("external_api_secret_required");
  if (input.authType === "basic") return { username: input.authUsername ?? "", password: secret };
  return { token: secret };
}
