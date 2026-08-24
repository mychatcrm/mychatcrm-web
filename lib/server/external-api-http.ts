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

export { isBlockedExternalApiIp } from "@/lib/server/external-api-network-policy";

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
  if (params.operation.method !== "GET") throw new Error("external_api_read_only_method_required");
  for (const definition of params.operation.parameters) {
    const value = coerceArgument(params.args[definition.name], definition.type);
    if (value == null) {
      if (definition.required) throw new Error(`external_api_missing_argument:${definition.name}`);
      continue;
    }
    if (definition.in === "path") path = path.replace(`{${definition.name}}`, encodeURIComponent(String(value)));
    if (definition.in === "query") query.set(definition.name, String(value));
    if (definition.in === "body") throw new Error("external_api_get_body_not_allowed");
  }
  if (/\{[^}]+\}/.test(path)) throw new Error("external_api_missing_path_argument");
  const relative = path.replace(/^\/+/, "");
  const url = new URL(relative, params.baseUrl.endsWith("/") ? params.baseUrl : `${params.baseUrl}/`);
  const base = new URL(params.baseUrl);
  if (url.origin !== base.origin || url.hostname !== base.hostname) throw new Error("external_api_host_mismatch");
  query.forEach((value, key) => url.searchParams.set(key, value));
  const headers: Record<string, string> = { Accept: "application/json" };
  if (params.authType === "bearer") headers.Authorization = `Bearer ${params.credential?.token ?? ""}`;
  if (params.authType === "api_key") headers[params.authHeaderName || "X-Api-Key"] = params.credential?.token ?? "";
  if (params.authType === "basic") {
    headers.Authorization = `Basic ${Buffer.from(`${params.credential?.username ?? ""}:${params.credential?.password ?? ""}`, "utf8").toString("base64")}`;
  }
  return { url, headers, body: null };
}

function requestJsonOnce(request: { url: URL; method: "GET"; headers: Record<string, string>; body: null }): Promise<{ status: number; payload: unknown }> {
  return new Promise((resolve, reject) => {
    const literalIp = normalizedIpLiteral(request.url.hostname);
    if (literalIp && isBlockedExternalApiIp(literalIp)) {
      reject(new Error("external_api_private_ip_blocked"));
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
            response.destroy(new Error("external_api_response_too_large"));
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        response.on("error", reject);
        response.on("end", () => {
          const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
          if (!contentType.includes("json")) return reject(new Error("external_api_json_required"));
          try {
            resolve({ status, payload: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown });
          } catch {
            reject(new Error("external_api_invalid_json"));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("external_api_timeout")));
    req.on("error", reject);
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
    throw new Error("external_api_read_only_method_required");
  }
  const first = await requestJsonOnce(params);
  if (first.status !== 429 && first.status < 500) return first;
  await new Promise((resolve) => setTimeout(resolve, 250));
  return requestJsonOnce(params);
}
