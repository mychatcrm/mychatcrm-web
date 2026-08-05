import "server-only";

import { lookup } from "node:dns";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type { LookupAddress, LookupOptions } from "node:dns";
import type {
  ExternalApiAuthType,
  ExternalApiOperationInput,
} from "@/lib/external-api/types";

const MAX_RESPONSE_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;

function ipv4Number(ip: string): number | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!) >>> 0;
}

function inV4Range(value: number, base: number, bits: number): boolean {
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (base & mask);
}

export function isBlockedExternalApiIp(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) {
    const value = ipv4Number(address);
    if (value == null) return true;
    const ranges: Array<[string, number]> = [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
      ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
      ["224.0.0.0", 4], ["240.0.0.0", 4],
    ];
    return ranges.some(([base, bits]) => inV4Range(value, ipv4Number(base)!, bits));
  }
  if (kind !== 6) return true;
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  if (normalized.startsWith("ff") || normalized.startsWith("2001:db8:")) return true;
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isBlockedExternalApiIp(mapped[1]!) : false;
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
}): { url: URL; headers: Record<string, string>; body: string | null } {
  let path = params.operation.pathTemplate;
  const query = new URLSearchParams();
  const body: Record<string, string | number | boolean> = {};
  for (const definition of params.operation.parameters) {
    const value = coerceArgument(params.args[definition.name], definition.type);
    if (value == null) {
      if (definition.required) throw new Error(`external_api_missing_argument:${definition.name}`);
      continue;
    }
    if (definition.in === "path") path = path.replace(`{${definition.name}}`, encodeURIComponent(String(value)));
    if (definition.in === "query") query.set(definition.name, String(value));
    if (definition.in === "body") body[definition.name] = value;
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
  const hasBody = params.operation.method === "POST" && Object.keys(body).length > 0;
  if (hasBody) headers["Content-Type"] = "application/json";
  return { url, headers, body: hasBody ? JSON.stringify(body) : null };
}

function requestJsonOnce(request: { url: URL; method: "GET" | "POST"; headers: Record<string, string>; body: string | null }): Promise<{ status: number; payload: unknown }> {
  return new Promise((resolve, reject) => {
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
    if (request.body) req.write(request.body);
    req.end();
  });
}

export async function executeExternalApiHttpRequest(params: {
  url: URL;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body: string | null;
}): Promise<{ status: number; payload: unknown }> {
  const first = await requestJsonOnce(params);
  if (first.status !== 429 && first.status < 500) return first;
  await new Promise((resolve) => setTimeout(resolve, 250));
  return requestJsonOnce(params);
}
