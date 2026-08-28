import "server-only";

import { lookup } from "node:dns";
import { request as httpsRequest } from "node:https";
import type { LookupAddress, LookupOptions } from "node:dns";
import type {
  ExternalApiAuthType,
  ExternalApiOperationInput,
} from "@/lib/external-api/types";
import {
  isBlockedExternalApiIp,
  normalizedIpLiteral,
} from "@/lib/server/external-api-network-policy";

const MAX_RESPONSE_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;
/** Canonicalizações comuns (barra final, http→https, apex↔www) cabem em 3 saltos. Mais que isso é loop ou má configuração. */
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export { isBlockedExternalApiIp } from "@/lib/server/external-api-network-policy";

/** Erro com código estável (pra classificação/log) e o status HTTP real, quando existe — é o que faz o diagnóstico deixar de ser "json_required" sem explicação. */
export class ExternalApiRequestError extends Error {
  readonly code: string;
  readonly httpStatus: number | null;
  constructor(code: string, httpStatus: number | null = null) {
    super(code);
    this.name = "ExternalApiRequestError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function safeLookup(
  hostname: string,
  options: LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
) {
  lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error, "", 4);
    if (!addresses.length || addresses.some((item) => isBlockedExternalApiIp(item.address))) {
      const blocked = new Error("external_api_private_ip_blocked") as NodeJS.ErrnoException;
      blocked.code = "EACCES";
      return callback(blocked, "", 4);
    }
    if (options?.all) return callback(null, addresses);
    const first = addresses[0]!;
    return callback(null, first.address, first.family);
  });
}

type ExternalApiRequestArgs = Record<string, string | number | boolean>;

function coerceArgument(value: unknown, type: "string" | "number" | "boolean"): string | number | boolean | null {
  if (type === "string") return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value).slice(0, 1000) : null;
  if (type === "number") {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return null;
}

export function buildExternalApiRequest(params: {
  baseUrl: string;
  operation: ExternalApiOperationInput;
  args: ExternalApiRequestArgs;
  authType: ExternalApiAuthType;
  authHeaderName?: string | null;
  credential?: Record<string, string> | null;
}): { url: URL; headers: Record<string, string>; body: null } {
  let path = params.operation.pathTemplate;
  const query = new URLSearchParams();
  if (params.operation.method !== "GET") throw new ExternalApiRequestError("external_api_read_only_method_required");
  for (const definition of params.operation.parameters) {
    const value = coerceArgument(params.args[definition.name], definition.type);
    if (value == null) {
      if (definition.required) throw new ExternalApiRequestError(`external_api_missing_argument:${definition.name}`);
      continue;
    }
    if (definition.in === "path") path = path.replace(`{${definition.name}}`, encodeURIComponent(String(value)));
    if (definition.in === "query") query.set(definition.name, String(value));
    if (definition.in === "body") throw new ExternalApiRequestError("external_api_get_body_not_allowed");
  }
  if (/\{[^}]+\}/.test(path)) throw new ExternalApiRequestError("external_api_missing_path_argument");
  const relative = path.replace(/^\/+/, "");
  const url = new URL(relative, params.baseUrl.endsWith("/") ? params.baseUrl : `${params.baseUrl}/`);
  const base = new URL(params.baseUrl);
  if (url.origin !== base.origin || url.hostname !== base.hostname) throw new ExternalApiRequestError("external_api_host_mismatch");
  query.forEach((value, key) => url.searchParams.set(key, value));
  const headers: Record<string, string> = { Accept: "application/json" };
  if (params.authType === "bearer") headers.Authorization = `Bearer ${params.credential?.token ?? ""}`;
  if (params.authType === "api_key") headers[params.authHeaderName || "X-Api-Key"] = params.credential?.token ?? "";
  if (params.authType === "basic") {
    headers.Authorization = `Basic ${Buffer.from(`${params.credential?.username ?? ""}:${params.credential?.password ?? ""}`, "utf8").toString("base64")}`;
  }
  return { url, headers, body: null };
}

type RawResponse = { status: number; headers: NodeJS.Dict<string | string[]>; body: Buffer };

/** Uma chamada HTTP crua — sem decidir nada sobre redirect ou JSON. Isso fica pra quem chama. */
function performHttpRequest(request: { url: URL; method: "GET"; headers: Record<string, string> }): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    if (request.url.protocol !== "https:") {
      reject(new ExternalApiRequestError("external_api_https_required"));
      return;
    }
    const literalIp = normalizedIpLiteral(request.url.hostname);
    if (literalIp && isBlockedExternalApiIp(literalIp)) {
      reject(new ExternalApiRequestError("external_api_private_ip_blocked"));
      return;
    }
    const req = httpsRequest(
      request.url,
      {
        method: request.method,
        headers: request.headers,
        timeout: REQUEST_TIMEOUT_MS,
        lookup: safeLookup,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_RESPONSE_BYTES) {
            response.destroy(new ExternalApiRequestError("external_api_response_too_large", status));
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        response.on("error", reject);
        response.on("end", () => resolve({ status, headers: response.headers, body: Buffer.concat(chunks) }));
      },
    );
    req.on("timeout", () => req.destroy(new ExternalApiRequestError("external_api_timeout")));
    req.on("error", (err) => reject(err instanceof ExternalApiRequestError ? err : new ExternalApiRequestError("external_api_network_error")));
    req.end();
  });
}

export async function executeExternalApiHttpRequest(params: {
  url: URL;
  method: "GET";
  headers: Record<string, string>;
  body: null;
}): Promise<{ status: number; payload: unknown }> {
  if (params.method !== "GET" || params.body !== null) {
    throw new ExternalApiRequestError("external_api_read_only_method_required");
  }

  // Segue redirects (barra final, http→https, apex↔www são os mais comuns em
  // APIs reais) revalidando IP/host a cada salto — a mesma blindagem da
  // primeira chamada, nunca menos. Sem isso, qualquer 301/308 vira
  // "json_required" sem explicação, porque a página de redirect não é JSON.
  let currentUrl = params.url;
  let response: RawResponse | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    response = await requestWithOneRetry({ url: currentUrl, method: "GET", headers: params.headers });
    if (!REDIRECT_STATUSES.has(response.status)) break;
    if (hop === MAX_REDIRECTS) throw new ExternalApiRequestError("external_api_too_many_redirects", response.status);
    const location = response.headers.location;
    const locationValue = Array.isArray(location) ? location[0] : location;
    if (!locationValue) break; // redirect sem Location — trata como resposta final (vai falhar no parse abaixo, com o status certo)
    let nextUrl: URL;
    try {
      nextUrl = new URL(locationValue, currentUrl);
    } catch {
      throw new ExternalApiRequestError("external_api_invalid_redirect", response.status);
    }
    currentUrl = nextUrl;
  }
  if (!response) throw new ExternalApiRequestError("external_api_network_error");

  if (response.status < 200 || response.status >= 300) {
    throw new ExternalApiRequestError("external_api_http_error", response.status);
  }

  const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
  const bodyText = response.body.toString("utf8");
  try {
    return { status: response.status, payload: JSON.parse(bodyText) as unknown };
  } catch {
    // Muita API pequena/customizada devolve JSON válido com content-type
    // errado (ou ausente). O content-type só entra pra dar um erro melhor
    // quando o parse realmente falha — não pra recusar de cara.
    throw new ExternalApiRequestError(
      contentType.includes("json") ? "external_api_invalid_json" : "external_api_json_required",
      response.status,
    );
  }
}

async function requestWithOneRetry(request: { url: URL; method: "GET"; headers: Record<string, string> }): Promise<RawResponse> {
  const first = await performHttpRequest(request);
  if (first.status !== 429 && first.status < 500) return first;
  await new Promise((resolve) => setTimeout(resolve, 250));
  return performHttpRequest(request);
}
