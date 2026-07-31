import "server-only";

const DEFAULT_META_GRAPH_API_VERSION = "v25.0";
const GRAPH_VERSION_PATTERN = /^v\d+\.\d+$/;

export const META_GRAPH_API_VERSION = (() => {
  const configured = process.env.META_GRAPH_API_VERSION?.trim();
  return configured && GRAPH_VERSION_PATTERN.test(configured)
    ? configured
    : DEFAULT_META_GRAPH_API_VERSION;
})();

export const META_GRAPH_BASE_URL = `https://graph.facebook.com/${META_GRAPH_API_VERSION}`;

type MetaGraphErrorBody = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  is_transient?: boolean;
  fbtrace_id?: string;
};

type MetaGraphEnvelope = {
  error?: MetaGraphErrorBody;
};

export class MetaGraphRequestError extends Error {
  readonly status: number;
  readonly code: number | null;
  readonly subcode: number | null;
  readonly type: string | null;
  readonly traceId: string | null;
  readonly retryable: boolean;

  constructor(params: {
    message: string;
    status: number;
    code?: number;
    subcode?: number;
    type?: string;
    traceId?: string;
    retryable?: boolean;
  }) {
    super(params.message);
    this.name = "MetaGraphRequestError";
    this.status = params.status;
    this.code = params.code ?? null;
    this.subcode = params.subcode ?? null;
    this.type = params.type ?? null;
    this.traceId = params.traceId ?? null;
    this.retryable = params.retryable ?? params.status >= 500;
  }
}

type MetaGraphRequestOptions = {
  accessToken: string;
  method?: "GET" | "POST" | "DELETE";
  searchParams?: Record<string, string | number | boolean | null | undefined>;
  form?: Record<string, string | number | boolean | null | undefined>;
  timeoutMs?: number;
};

function graphUrl(pathOrUrl: string): URL {
  const value = pathOrUrl.trim();
  const url = /^https:\/\//i.test(value)
    ? new URL(value)
    : new URL(`${META_GRAPH_BASE_URL}/${value.replace(/^\/+/, "")}`);

  if (url.protocol !== "https:" || url.hostname !== "graph.facebook.com") {
    throw new MetaGraphRequestError({
      message: "Meta Graph returned an unsafe pagination URL.",
      status: 502,
    });
  }

  // Tokens must never remain in URLs, logs or exception messages.
  url.searchParams.delete("access_token");
  return url;
}

function safeGraphMessage(message: string | undefined, fallback: string): string {
  const value = message?.trim() || fallback;
  return value
    .replace(/access_token=[^&\s]+/gi, "access_token=[REDACTED]")
    .replace(/EA[A-Za-z0-9_-]{20,}/g, "[REDACTED]");
}

export async function metaGraphRequest<T>(
  pathOrUrl: string,
  options: MetaGraphRequestOptions,
): Promise<T> {
  const accessToken = options.accessToken.trim();
  if (!accessToken) {
    throw new MetaGraphRequestError({
      message: "Missing Meta access token.",
      status: 401,
    });
  }

  const url = graphUrl(pathOrUrl);
  for (const [key, value] of Object.entries(options.searchParams ?? {})) {
    if (key.toLowerCase() === "access_token") continue;
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const headers = new Headers({
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`,
  });
  let body: URLSearchParams | undefined;
  if (options.form) {
    body = new URLSearchParams();
    for (const [key, value] of Object.entries(options.form)) {
      if (value !== null && value !== undefined) {
        body.set(key, String(value));
      }
    }
    headers.set("Content-Type", "application/x-www-form-urlencoded");
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body,
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
  } catch (error) {
    throw new MetaGraphRequestError({
      message: safeGraphMessage(
        error instanceof Error ? error.message : String(error),
        "Meta Graph network request failed.",
      ),
      status: 502,
      retryable: true,
    });
  }

  let payload: (T & MetaGraphEnvelope) | MetaGraphEnvelope;
  try {
    payload = (await response.json()) as (T & MetaGraphEnvelope) | MetaGraphEnvelope;
  } catch {
    throw new MetaGraphRequestError({
      message: `Meta Graph returned invalid JSON (HTTP ${response.status}).`,
      status: response.status || 502,
      retryable: response.status >= 500,
    });
  }

  const graphError = payload.error;
  if (!response.ok || graphError) {
    throw new MetaGraphRequestError({
      message: safeGraphMessage(
        graphError?.message,
        `Meta Graph request failed (HTTP ${response.status}).`,
      ),
      status: response.status,
      code: graphError?.code,
      subcode: graphError?.error_subcode,
      type: graphError?.type,
      traceId: graphError?.fbtrace_id,
      retryable: Boolean(graphError?.is_transient) || response.status >= 500 || response.status === 429,
    });
  }

  return payload as T;
}

export function metaGraphErrorCode(error: unknown): string {
  if (!(error instanceof MetaGraphRequestError)) return "graph_unknown_error";
  if (error.code === 190) return "token_invalid";
  if (error.code === 10 || error.code === 200) return "permission_denied";
  if (error.code === 100) return "invalid_request";
  if (error.retryable) return "graph_temporarily_unavailable";
  return error.code ? `graph_error_${error.code}` : "graph_request_failed";
}
