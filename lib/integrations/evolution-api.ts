/**
 * Cliente HTTP Evolution API v2 (OpenAPI 2.1.x).
 * Auth: header `apikey` — ver `evolutionApiKey()` para nomes de env suportados.
 * @see https://doc.evolution-api.com/v2/
 */

import { createHash } from "node:crypto";

const DEFAULT_TIMEOUT_MS = 25_000;

/** Mensagem legível a partir do JSON típico da Evolution (`response.message[]`, `error`, string). */
export function formatEvolutionHttpErrorBody(data: unknown, statusText: string): string {
  if (typeof data === "string") return data.slice(0, 800).trim() || statusText;
  if (!data || typeof data !== "object") return statusText;
  const o = data as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof o.error === "string" && o.error.trim()) parts.push(o.error.trim());
  const resp = o.response;
  if (resp && typeof resp === "object") {
    const r = resp as Record<string, unknown>;
    const msg = r.message;
    if (Array.isArray(msg)) {
      const lines = msg.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean);
      if (lines.length) parts.push(lines.join(" · "));
    } else if (typeof msg === "string" && msg.trim()) {
      parts.push(msg.trim());
    }
  }
  if (typeof o.message === "string" && o.message.trim()) parts.push(o.message.trim());
  const out = parts.join(" — ").slice(0, 800);
  return out || JSON.stringify(data).slice(0, 500);
}

export type EvolutionFetchResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

/** Chave global: prioridade MyChatCRM → nomes usados na stack oficial Evolution (Docker). */
export function evolutionApiKey(): string {
  return (
    process.env.EVOLUTION_API_KEY?.trim() ||
    process.env.AUTHENTICATION_API_KEY?.trim() ||
    process.env.EVOLUTION_AUTHENTICATION_API_KEY?.trim() ||
    ""
  );
}

function evolutionConfig() {
  const baseUrl = process.env.EVOLUTION_API_BASE_URL?.trim().replace(/\/+$/, "") ?? "";
  const apiKey = evolutionApiKey();
  return { baseUrl, apiKey };
}

export function isEvolutionApiConfigured(): boolean {
  const { baseUrl, apiKey } = evolutionConfig();
  return Boolean(baseUrl && apiKey);
}

/** Garante string não vazia para o cliente (evita UI presa em «sincronizar»). */
export function normalizeEvolutionConnectionState(raw: unknown, fallback = "close"): string {
  if (typeof raw !== "string") return fallback;
  const t = raw.trim();
  return t.length ? t : fallback;
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
    return {
      ok: false,
      status: 503,
      error:
        "Evolution API não configurada: defina EVOLUTION_API_BASE_URL e EVOLUTION_API_KEY (ou AUTHENTICATION_API_KEY / EVOLUTION_AUTHENTICATION_API_KEY).",
    };
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
      const errMsg = formatEvolutionHttpErrorBody(data, res.statusText);
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
      events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
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
  const path = `/instance/connect/${enc}`;
  const getRes = await evolutionFetchJson<EvolutionConnectResponse>(path, { method: "GET" });
  if (getRes.ok) return getRes;
  if (getRes.status === 404 || getRes.status === 405) {
    const postRes = await evolutionFetchJson<EvolutionConnectResponse>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (postRes.ok) return postRes;
  }
  return getRes;
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
  /** Rotas leves; qualquer HTTP < 600 indica TCP + servidor a responder. */
  const paths = ["/instance/fetchInstances", "/", "/manager"];
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
  instance?: { instanceName?: string; state?: string; connectionStatus?: string; status?: string };
  state?: string;
  connectionState?: string;
  connectionStatus?: string;
};

/** Lê o estado da instância em respostas que variam entre versões da Evolution. */
export function parseEvolutionConnectionStatePayload(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const o = data as Record<string, unknown>;
  const inst = o.instance;
  if (inst && typeof inst === "object") {
    const io = inst as Record<string, unknown>;
    for (const k of ["state", "connectionStatus", "status"]) {
      const v = io[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  for (const k of ["state", "connectionState", "connectionStatus"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

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
      events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
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

/**
 * Busca o nome/pushName de um contato via Evolution API v2.
 * GET /chat/findContacts/{instance}?where={"remoteJid":"..."} devolve array de contactos.
 * Retorna o pushName ou name, ou null se não encontrado.
 */
export async function fetchContactName(
  instanceName: string,
  remoteJid: string,
): Promise<string | null> {
  const enc = encodeURIComponent(instanceName);
  const where = encodeURIComponent(JSON.stringify({ remoteJid }));
  const res = await evolutionFetchJson<unknown>(
    `/chat/findContacts/${enc}?where=${where}`,
    { method: "GET", timeoutMs: 8_000 },
  );

  if (!res.ok) {
    console.warn("[evolution-api] fetchContactName non-ok", res.status, res.error);
    return null;
  }

  // Resposta pode ser array ou { data: [] }
  let arr: unknown[] = [];
  if (Array.isArray(res.data)) {
    arr = res.data;
  } else if (res.data && typeof res.data === "object") {
    const d = res.data as Record<string, unknown>;
    if (Array.isArray(d.data)) arr = d.data as unknown[];
  }

  if (!arr.length) return null;

  const first = arr[0] as Record<string, unknown>;
  const name =
    (typeof first.pushName === "string" && first.pushName.trim()) ||
    (typeof first.name === "string" && first.name.trim()) ||
    null;

  return name || null;
}

/**
 * Busca a URL da foto de perfil de um contato via Evolution API v2.
 * Evolution API v2 usa POST /chat/fetchProfilePictureUrl/{instance} com body { number }.
 * Retorna a URL pública da foto, ou null se não encontrada / privada.
 */
export async function fetchContactPhoto(
  instanceName: string,
  remoteJid: string,
): Promise<string | null> {
  // Strip @s.whatsapp.net — Evolution API espera apenas o número com código de país
  const number = remoteJid.split("@")[0] ?? remoteJid;
  const enc = encodeURIComponent(instanceName);

  // Evolution API v2: POST com body JSON { number }
  const res = await evolutionFetchJson<Record<string, unknown>>(
    `/chat/fetchProfilePictureUrl/${enc}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ number }),
      timeoutMs: 8_000,
    },
  );

  if (!res.ok) {
    console.warn("[evolution-api] fetchContactPhoto non-ok", res.status, res.error);
    return null;
  }

  // A Evolution API v2 retorna { profilePictureUrl: "https://..." }
  const d = res.data as Record<string, unknown>;
  const url = typeof d.profilePictureUrl === "string" ? d.profilePictureUrl.trim() : null;

  if (!url || !url.startsWith("http")) {
    console.warn("[evolution-api] fetchContactPhoto sem URL para", number, "| data:", JSON.stringify(d).slice(0, 300));
    return null;
  }

  return url;
}
