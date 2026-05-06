/**
 * Cliente HTTP Evolution API v2 (OpenAPI 2.1.x).
 * Auth: header `apikey` (global EVOLUTION_API_KEY).
 * @see https://doc.evolution-api.com/v2/
 */

import { createHash } from "node:crypto";

const DEFAULT_TIMEOUT_MS = 25_000;

export type EvolutionFetchResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

function evolutionConfig() {
  const baseUrl = process.env.EVOLUTION_API_BASE_URL?.trim().replace(/\/+$/, "") ?? "";
  const apiKey = process.env.EVOLUTION_API_KEY?.trim() ?? "";
  return { baseUrl, apiKey };
}

export function isEvolutionApiConfigured(): boolean {
  const { baseUrl, apiKey } = evolutionConfig();
  return Boolean(baseUrl && apiKey);
}

/** Nome de instância estável, curto e seguro para URL/path (único por tenant + slot). */
export function buildEvolutionInstanceName(tenantId: string, slotIndex: number): string {
  const h = createHash("sha256").update(`mychatcrm\0${tenantId}\0${slotIndex}`).digest("hex").slice(0, 28);
  return `mc${h}`;
}

async function evolutionFetchJson<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<EvolutionFetchResult<T>> {
  const { baseUrl, apiKey } = evolutionConfig();
  if (!baseUrl || !apiKey) {
    return { ok: false, status: 503, error: "Evolution API não configurada (EVOLUTION_API_BASE_URL / EVOLUTION_API_KEY)." };
  }
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...rest,
      signal: ac.signal,
      headers: {
        apikey: apiKey,
        Accept: "application/json",
        ...(rest.headers as Record<string, string>),
      },
    });
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      const errMsg =
        typeof data === "object" && data !== null && "response" in data
          ? JSON.stringify((data as { response?: unknown }).response ?? data)
          : typeof data === "string"
            ? data.slice(0, 500)
            : res.statusText;
      return { ok: false, status: res.status, error: errMsg || res.statusText };
    }
    return { ok: true, status: res.status, data: data as T };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch failed";
    return { ok: false, status: 0, error: msg };
  } finally {
    clearTimeout(t);
  }
}

export type EvolutionCreateInstanceResponse = {
  instance?: { instanceName?: string; status?: string };
};

export async function evolutionCreateInstance(params: {
  instanceName: string;
  /** URL completa do webhook (incluir `?token=` se usar validação por query). */
  webhookUrl?: string;
}): Promise<EvolutionFetchResult<EvolutionCreateInstanceResponse>> {
  const body: Record<string, unknown> = {
    instanceName: params.instanceName,
    integration: "WHATSAPP-BAILEYS",
    qrcode: true,
  };
  if (params.webhookUrl) {
    body.webhook = {
      url: params.webhookUrl,
      byEvents: false,
      base64: true,
      events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
    };
  }
  return evolutionFetchJson<EvolutionCreateInstanceResponse>("/instance/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Resposta de `GET /instance/connect/{instance}` — formato varia entre 2.1.x e 2.3.x (ver `evolution-connect-qr.ts`). */
export type EvolutionConnectResponse = Record<string, unknown>;

/** Obtém dados de emparelhamento / QR (normalizar com `normalizeInstanceConnectToQrDataUrl`). */
export async function evolutionInstanceConnect(
  instanceName: string,
): Promise<EvolutionFetchResult<EvolutionConnectResponse>> {
  const enc = encodeURIComponent(instanceName);
  return evolutionFetchJson<EvolutionConnectResponse>(`/instance/connect/${enc}`, { method: "GET" });
}

const PING_TIMEOUT_MS = 6000;

/**
 * Verifica se a Evolution responde na rede (sem expor segredos na resposta ao cliente).
 * Usa `GET /instance/fetchInstances` quando existir; caso contrário `GET /` na base.
 */
export async function evolutionPing(): Promise<{ reachable: true } | { reachable: false; error: string }> {
  const { baseUrl, apiKey } = evolutionConfig();
  if (!baseUrl || !apiKey) {
    return { reachable: false, error: "not_configured" };
  }
  const paths = ["/instance/fetchInstances", "/"];
  let lastErr = "unreachable";
  for (const path of paths) {
    const url = `${baseUrl}${path}`;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), PING_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "GET",
        signal: ac.signal,
        headers: { apikey: apiKey, Accept: "application/json" },
      });
      if (res.status >= 200 && res.status < 600) {
        return { reachable: true };
      }
      lastErr = `http_${res.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "fetch_failed";
    } finally {
      clearTimeout(t);
    }
  }
  return { reachable: false, error: lastErr };
}

export type EvolutionConnectionStateResponse = {
  instance?: { instanceName?: string; state?: string };
};

export async function evolutionConnectionState(
  instanceName: string,
): Promise<EvolutionFetchResult<EvolutionConnectionStateResponse>> {
  const enc = encodeURIComponent(instanceName);
  return evolutionFetchJson<EvolutionConnectionStateResponse>(`/instance/connectionState/${enc}`, {
    method: "GET",
  });
}

export async function evolutionSetWebhook(params: {
  instanceName: string;
  /** URL completa (ex.: com `?token=` para o route handler validar). */
  url: string;
}): Promise<EvolutionFetchResult<unknown>> {
  const enc = encodeURIComponent(params.instanceName);
  return evolutionFetchJson(`/webhook/set/${enc}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enabled: true,
      url: params.url,
      webhookByEvents: false,
      webhookBase64: true,
      events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
    }),
  });
}

export async function evolutionDeleteInstance(instanceName: string): Promise<EvolutionFetchResult<unknown>> {
  const enc = encodeURIComponent(instanceName);
  return evolutionFetchJson(`/instance/delete/${enc}`, { method: "DELETE" });
}

export async function evolutionSendText(params: {
  instanceName: string;
  /** Digits with country code, no @ suffix (ex: 5511999999999). */
  number: string;
  text: string;
}): Promise<EvolutionFetchResult<unknown>> {
  const enc = encodeURIComponent(params.instanceName);
  return evolutionFetchJson(`/message/sendText/${enc}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      number: params.number,
      text: params.text.slice(0, 4000),
    }),
  });
}

/** Converte JID WhatsApp em número para envio pela API Evolution. */
export function remoteJidToEvoNumber(remoteJid: string): string | null {
  if (!remoteJid || remoteJid.includes("@g.us")) return null;
  const base = remoteJid.split("@")[0]?.replace(/\D/g, "") ?? "";
  return base.length >= 8 ? base : null;
}
