import "server-only";

import type {
  ExternalApiAuthType,
  ExternalApiConnectorInput,
  ExternalApiOperationInput,
  ExternalApiParameterDefinition,
} from "@/lib/external-api/types";
import { createStandardExternalApiOperations } from "@/lib/external-api/standard-contract";

const OPERATION_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const PARAMETER_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,80}$/;
const SAFE_CACHE_TTLS = new Set([0, 30, 60, 120, 300]);
const BLOCKED_HOST_SUFFIXES = [".local", ".internal", ".localhost", ".home", ".lan"];
const DANGEROUS_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

export type ValidatedExternalApiConnectorInput = ExternalApiConnectorInput & {
  baseUrl: string;
  baseOrigin: string;
  authHeaderName?: string;
  operations: ExternalApiOperationInput[];
};

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
  if (url.protocol !== "https:" || (url.port && url.port !== "443")) {
    throw new Error("external_api_https_required");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("external_api_invalid_base_url");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "metadata.google.internal" ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new Error("external_api_private_host_blocked");
  }
  url.hostname = hostname;
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return { baseUrl: url.toString(), baseOrigin: url.origin };
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
  if (operation.method !== "GET" && operation.method !== "POST") {
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
  if (operation.method === "GET" && parameters.some((item) => item.in === "body")) {
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
  };
}

export function validateExternalApiConnectorInput(input: ExternalApiConnectorInput): ValidatedExternalApiConnectorInput {
  const name = input.name?.trim();
  if (!name || name.length > 100) throw new Error("external_api_invalid_name");
  const authTypes = new Set<ExternalApiAuthType>(["none", "bearer", "api_key", "basic"]);
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
  return {
    name,
    description: String(input.description ?? "").trim().slice(0, 1000),
    baseUrl,
    baseOrigin,
    authType: input.authType,
    authHeaderName,
    authUsername,
    secret: typeof input.secret === "string" ? input.secret.trim() : undefined,
    enabled: input.enabled === true,
    operations,
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
