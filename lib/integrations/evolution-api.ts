/**
 * Cliente HTTP Evolution API v2 (OpenAPI 2.1.x).
 * Auth: header `apikey` — ver `evolutionApiKey()` para nomes de env suportados.
 * @see https://doc.evolution-api.com/v2/
 */

import { createHash } from "node:crypto";
import { randomBytes } from "node:crypto";
import { extractEvolutionSendReceipt } from "@/lib/integrations/evolution-message-receipt";

const DEFAULT_TIMEOUT_MS = 25_000;
const MESSAGE_STATUS_POLL_ATTEMPTS = 4;
const MESSAGE_STATUS_POLL_INTERVAL_MS = 500;

function stringifyEvolutionErrorPart(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Mensagem legível a partir do JSON típico da Evolution (`response.message[]`, `error`, string). */
export function formatEvolutionHttpErrorBody(data: unknown, statusText: string): string {
  if (typeof data === "string") return data.slice(0, 800).trim() || statusText;
  if (!data || typeof data !== "object") return statusText;
  const o = data as Record<string, unknown>;
  const parts: string[] = [];
  const errorPart = stringifyEvolutionErrorPart(o.error);
  if (errorPart) parts.push(errorPart);
  const resp = o.response;
  if (resp && typeof resp === "object") {
    const r = resp as Record<string, unknown>;
    const msg = r.message;
    if (Array.isArray(msg)) {
      const lines = msg.map(stringifyEvolutionErrorPart).filter((line): line is string => Boolean(line));
      if (lines.length) parts.push(lines.join(" · "));
    } else {
      const messagePart = stringifyEvolutionErrorPart(msg);
      if (messagePart) parts.push(messagePart);
    }
  }
  const messagePart = stringifyEvolutionErrorPart(o.message);
  if (messagePart) parts.push(messagePart);
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

/**
 * Nome único após apagar/reconectar: prefixo determinístico + sufixo aleatório.
 * Garante sessão Baileys nova na Evolution (evita reaproveitar arquivos corrompidos).
 */
export function buildFreshEvolutionInstanceName(tenantId: string, slotIndex: number): string {
  return `${buildEvolutionInstanceName(tenantId, slotIndex)}${randomBytes(4).toString("hex")}`;
}

export async function evolutionFetchJson<T>(
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
  qrcode?: {
    count?: number;
    pairingCode?: string;
    base64?: string;
    code?: string;
  };
};

export async function evolutionCreateInstance(params: {
  instanceName: string;
  /** URL completa do webhook (incluir `?token=` se usar validação por query). */
  webhookUrl?: string;
  /**
   * Settings opcionais do Baileys (top-level no /instance/create da Evolution v2):
   * alwaysOnline, groupsIgnore, readMessages, readStatus, syncFullHistory, rejectCall...
   * Só passar para casos específicos (ex.: instância do sistema). Default: nada (clientes inalterados).
   */
  settings?: Record<string, unknown>;
}): Promise<EvolutionFetchResult<EvolutionCreateInstanceResponse>> {
  const body: Record<string, unknown> = {
    instanceName: params.instanceName,
    integration: "WHATSAPP-BAILEYS",
    qrcode: true,
    ...(params.settings ?? {}),
  };
  if (params.webhookUrl) {
    body.webhook = {
      url: params.webhookUrl,
      byEvents: false,
      // Media is fetched explicitly when needed. Excluding bytes prevents
      // oversized Evolution webhooks from being rejected by Vercel.
      base64: false,
      events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
    };
  }
  return evolutionFetchJson<EvolutionCreateInstanceResponse>("/instance/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Aplica settings do Baileys numa instância já criada (`POST /settings/set/{instance}`).
 * Útil quando o create não persiste os settings inline. Falhas não são críticas.
 */
export async function evolutionSetInstanceSettings(params: {
  instanceName: string;
  settings: Record<string, unknown>;
}): Promise<EvolutionFetchResult<unknown>> {
  const enc = encodeURIComponent(params.instanceName);
  return evolutionFetchJson(`/settings/set/${enc}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params.settings),
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

/**
 * Identidade real de uma instância segundo a Evolution.
 * `ownerJid` só vem preenchido quando a sessão WhatsApp está REALMENTE autenticada
 * (QR escaneado e socket Baileys ativo). `connectionState` (endpoint connectionState)
 * pode reportar "open" mesmo numa sessão zumbi — por isso usamos fetchInstances como
 * fonte de verdade para o número conectado.
 */
export type EvolutionInstanceInfo = {
  name: string | null;
  connectionStatus: string | null;
  ownerJid: string | null;
  profileName: string | null;
};

function normalizeOwnerJidValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  if (!clean) return null;
  if (clean.includes("@")) {
    if (clean.endsWith("@g.us") || clean.endsWith("@broadcast")) return null;
    const digits = clean.split("@")[0]?.replace(/\D/g, "") ?? "";
    return digits.length >= 8 ? `${digits}@s.whatsapp.net` : null;
  }
  const digits = clean.replace(/\D/g, "");
  return digits.length >= 8 ? `${digits}@s.whatsapp.net` : null;
}

function parseEvolutionInstanceItem(item: unknown): EvolutionInstanceInfo | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  const inst =
    o.instance && typeof o.instance === "object" ? (o.instance as Record<string, unknown>) : null;
  const read = (key: string): unknown => o[key] ?? inst?.[key];

  const nameRaw = read("name") ?? read("instanceName");
  const name = typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : null;

  const statusRaw =
    read("connectionStatus") ?? read("connectionState") ?? read("state") ?? read("status");
  const connectionStatus =
    typeof statusRaw === "string" && statusRaw.trim() ? statusRaw.trim().toLowerCase() : null;

  const ownerJid =
    normalizeOwnerJidValue(read("ownerJid")) ??
    normalizeOwnerJidValue(read("owner")) ??
    normalizeOwnerJidValue(read("wuid"));

  const profileRaw = read("profileName") ?? read("profilename");
  const profileName = typeof profileRaw === "string" && profileRaw.trim() ? profileRaw.trim() : null;

  if (!name && !connectionStatus && !ownerJid) return null;
  return { name, connectionStatus, ownerJid, profileName };
}

/** GET /instance/fetchInstances — lista instâncias com `ownerJid`/`connectionStatus`. */
export async function evolutionFetchInstances(
  instanceName?: string,
): Promise<EvolutionFetchResult<EvolutionInstanceInfo[]>> {
  const query = instanceName ? `?instanceName=${encodeURIComponent(instanceName)}` : "";
  const res = await evolutionFetchJson<unknown>(`/instance/fetchInstances${query}`, { method: "GET" });
  if (!res.ok) return res;

  const raw = res.data;
  const arr: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { instances?: unknown }).instances)
      ? ((raw as { instances: unknown[] }).instances)
      : raw && typeof raw === "object"
        ? [raw]
        : [];

  const parsed = arr
    .map(parseEvolutionInstanceItem)
    .filter((item): item is EvolutionInstanceInfo => item !== null);

  return { ok: true, status: res.status, data: parsed };
}

/** Seleciona a instância pelo nome (ou a única retornada). */
export function pickEvolutionInstanceInfo(
  list: EvolutionInstanceInfo[],
  instanceName: string,
): EvolutionInstanceInfo | null {
  const target = instanceName.trim();
  return list.find((item) => item.name === target) ?? (list.length === 1 ? list[0] ?? null : null);
}

export async function evolutionSetWebhook(params: {
  instanceName: string;
  /** URL completa (ex.: com `?token=` para o route handler validar). */
  url: string;
}): Promise<EvolutionFetchResult<unknown>> {
  const enc = encodeURIComponent(params.instanceName);
  const webhook = {
    enabled: true,
    url: params.url,
    byEvents: false,
    base64: false,
    events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
  };
  const current = await evolutionFetchJson(`/webhook/set/${enc}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ webhook }),
  });
  if (current.ok || (current.status !== 400 && current.status !== 422)) return current;

  // Compatibilidade com builds anteriores que aceitavam o payload legado sem wrapper.
  return evolutionFetchJson(`/webhook/set/${enc}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enabled: webhook.enabled,
      url: webhook.url,
      webhookByEvents: webhook.byEvents,
      webhookBase64: webhook.base64,
      events: webhook.events,
    }),
  });
}

export type EvolutionWebhookConfig = {
  enabled: boolean;
  url: string | null;
  events: string[];
};

/**
 * Lê de volta a config de webhook de uma instância (GET /webhook/find).
 * Retorna null quando a Evolution não tem webhook registrado (404) ou a
 * resposta não é interpretável — o chamador decide se re-aplica.
 */
export async function evolutionFindWebhook(instanceName: string): Promise<EvolutionWebhookConfig | null> {
  const enc = encodeURIComponent(instanceName);
  const res = await evolutionFetchJson<Record<string, unknown>>(`/webhook/find/${enc}`, { method: "GET" });
  if (!res.ok || !res.data || typeof res.data !== "object") return null;

  // v2 nested ({ webhook: {...} }) ou flat ({ enabled, url, events }).
  const raw = res.data as Record<string, unknown>;
  const source =
    raw.webhook && typeof raw.webhook === "object" ? (raw.webhook as Record<string, unknown>) : raw;

  const url = typeof source.url === "string" && source.url.trim() ? source.url.trim() : null;
  const enabled = source.enabled === true;
  const events = Array.isArray(source.events)
    ? source.events.filter((e): e is string => typeof e === "string")
    : [];

  if (!url && !enabled && events.length === 0) return null;
  return { enabled, url, events };
}

/**
 * Confirma se a config lida de volta cobre o mínimo necessário para o fluxo
 * de mensagens funcionar: habilitada, apontando para a URL esperada e
 * inscrita em MESSAGES_UPSERT (sem ela, inbound nunca chega).
 */
export function isEvolutionWebhookHealthy(
  config: EvolutionWebhookConfig | null,
  expectedUrl: string,
): boolean {
  if (!config || !config.enabled || !config.url) return false;
  if (config.url !== expectedUrl) return false;
  return config.events.includes("MESSAGES_UPSERT");
}

/**
 * Auto-cura: lê a config atual e re-aplica o webhook quando ausente,
 * desabilitado ou apontando para outra URL. A Evolution pode perder/derrubar
 * a config silenciosamente (reinício, recriação de sessão) — sem isto, o
 * inbound de mensagens para de chegar e ninguém percebe até alguém reclamar.
 */
export async function evolutionEnsureWebhook(params: {
  instanceName: string;
  url: string;
}): Promise<{ healthy: boolean; reapplied: boolean; reapplyOk: boolean }> {
  const current = await evolutionFindWebhook(params.instanceName);
  if (isEvolutionWebhookHealthy(current, params.url)) {
    return { healthy: true, reapplied: false, reapplyOk: true };
  }
  const set = await evolutionSetWebhook({ instanceName: params.instanceName, url: params.url });
  return { healthy: false, reapplied: true, reapplyOk: set.ok };
}

export async function evolutionDeleteInstance(instanceName: string): Promise<EvolutionFetchResult<unknown>> {
  const enc = encodeURIComponent(instanceName.trim());
  // Evolution 2.3.7 exposes only DELETE for this route. A POST fallback masks
  // the useful DELETE error with a guaranteed 404 and must not be attempted.
  return evolutionFetchJson(`/instance/delete/${enc}`, { method: "DELETE" });
}

export type EvolutionInstancePresence = {
  state: "present" | "absent" | "unknown";
  status: number | null;
  error: string | null;
};

export type EvolutionRemoveInstanceResult = {
  ok: boolean;
  deleted: boolean;
  verifiedAbsent: boolean;
  presence: EvolutionInstancePresence["state"];
  error: string | null;
  status: number | null;
  deleteAttempts: Array<{ status: number; error: string | null }>;
};

export async function evolutionGetInstancePresence(
  instanceName: string,
): Promise<EvolutionInstancePresence> {
  const trimmed = instanceName.trim();
  if (!trimmed) {
    return { state: "unknown", status: null, error: "empty_instance_name" };
  }
  const res = await evolutionFetchInstances(instanceName.trim());
  if (!res.ok) {
    // Evolution 2.3.7 returns 404 when the filtered instance does not exist.
    // This is positive proof of absence, not an unavailable inventory.
    if (res.status === 404) {
      return { state: "absent", status: res.status, error: null };
    }
    return { state: "unknown", status: res.status, error: res.error };
  }
  const present = res.data.some((item) => item.name?.trim() === trimmed);
  return { state: present ? "present" : "absent", status: res.status, error: null };
}

async function verifyEvolutionInstanceAbsent(
  instanceName: string,
  delays: number[],
): Promise<EvolutionInstancePresence> {
  let last: EvolutionInstancePresence = { state: "unknown", status: null, error: "not_checked" };
  for (const delay of delays) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    last = await evolutionGetInstancePresence(instanceName);
    if (last.state === "absent") return last;
  }
  return last;
}

/**
 * Removes an Evolution instance and positively verifies its absence.
 *
 * Evolution 2.3.7 performs logout and database cleanup inside DELETE. Calling
 * logout first creates a race, while the cleanup itself can outlive the HTTP
 * response. The bounded verification window lets the caller return a pending
 * lifecycle state and safely resume the same operation on the next poll.
 */
export async function evolutionRemoveInstanceCompletely(
  instanceName: string,
  options: {
    verificationDelaysMs?: number[];
    retryDeleteDelayMs?: number;
  } = {},
): Promise<EvolutionRemoveInstanceResult> {
  const trimmed = instanceName.trim();
  if (!trimmed) {
    return {
      ok: false,
      deleted: false,
      verifiedAbsent: false,
      presence: "unknown",
      error: "empty_instance_name",
      status: null,
      deleteAttempts: [],
    };
  }

  const verificationDelaysMs = options.verificationDelaysMs ?? [0, 350, 900];
  const retryDeleteDelayMs = options.retryDeleteDelayMs ?? 500;
  const deleteAttempts: Array<{ status: number; error: string | null }> = [];

  let del = await evolutionDeleteInstance(trimmed);
  deleteAttempts.push({ status: del.status, error: del.ok ? null : del.error });

  // A transient 400/404 is not proof of absence in v2.3.7. Retry DELETE once
  // when the first response failed and the inventory does not prove absence.
  if (!del.ok) {
    const immediatePresence = await evolutionGetInstancePresence(trimmed);
    if (immediatePresence.state !== "absent") {
      if (retryDeleteDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDeleteDelayMs));
      }
      del = await evolutionDeleteInstance(trimmed);
      deleteAttempts.push({ status: del.status, error: del.ok ? null : del.error });
    }
  }

  const presence = await verifyEvolutionInstanceAbsent(trimmed, verificationDelaysMs);
  if (presence.state === "absent") {
    return {
      ok: true,
      deleted: true,
      verifiedAbsent: true,
      presence: "absent",
      error: null,
      status: del.status,
      deleteAttempts,
    };
  }

  if (!del.ok && del.status !== 404) {
    console.error("[evolution-api] delete_instance_failed", {
      instanceName: trimmed,
      status: del.status,
      error: del.error,
      presence: presence.state,
      verificationError: presence.error,
    });
    return {
      ok: false,
      deleted: false,
      verifiedAbsent: false,
      presence: presence.state,
      error:
        presence.state === "unknown"
          ? `instance_removal_unverified: ${presence.error ?? del.error}`
          : `${del.error}; instance_still_present_after_delete`,
      status: del.status,
      deleteAttempts,
    };
  }

  return {
    ok: false,
    deleted: false,
    verifiedAbsent: false,
    presence: presence.state,
    error:
      presence.state === "unknown"
        ? `instance_removal_unverified: ${presence.error ?? "inventory_unavailable"}`
        : "instance_still_present_after_delete",
    status: del.status,
    deleteAttempts,
  };
}

/** Reinicia a sessão WhatsApp (útil quando connectionState diz open mas envios falham). */
export async function evolutionRestartInstance(instanceName: string): Promise<EvolutionFetchResult<unknown>> {
  const enc = encodeURIComponent(instanceName);
  const putRes = await evolutionFetchJson(`/instance/restart/${enc}`, { method: "PUT" });
  if (putRes.ok) return putRes;
  if (putRes.status === 404 || putRes.status === 405) {
    return evolutionFetchJson(`/instance/restart/${enc}`, { method: "POST" });
  }
  return putRes;
}

export async function evolutionLogoutInstance(instanceName: string): Promise<EvolutionFetchResult<unknown>> {
  const enc = encodeURIComponent(instanceName);
  const res = await evolutionFetchJson(`/instance/logout/${enc}`, { method: "DELETE" });
  if (res.ok || (res.status !== 405 && res.status !== 403 && res.status !== 0)) return res;
  return evolutionFetchJson(`/instance/logout/${enc}`, { method: "POST" });
}

export async function evolutionSendText(params: {
  instanceName: string;
  /** Dígitos E.164 ou JID completo (ex: 5511999999999 ou 123@lid). */
  number: string;
  text: string;
  /** Confirma o endereço real no WhatsApp antes do envio (clientes/CRM). */
  resolveRecipient?: boolean;
  quoted?: {
    messageId: string;
    remoteJid: string;
    fromMe?: boolean;
    conversation?: string;
  } | null;
}): Promise<EvolutionFetchResult<unknown>> {
  const enc = encodeURIComponent(params.instanceName);
  let sendNumber = params.number;
  if (params.resolveRecipient && !params.number.endsWith("@lid")) {
    const resolved = await resolveEvolutionSendNumber({
      instanceName: params.instanceName,
      number: params.number,
    });
    if (resolved.status === "not_found") {
      return { ok: false, status: 422, error: "evolution_recipient_not_found" };
    }
    if (resolved.status === "exists") sendNumber = resolved.sendNumber;
    if (resolved.status === "check_failed") {
      console.warn("[evolution-api] recipient_resolution_failed_using_normalized_number", {
        instance_name: params.instanceName,
        error: resolved.error,
      });
    }
  }
  const body: Record<string, unknown> = {
    number: sendNumber,
    text: params.text.slice(0, 4000),
  };
  if (params.quoted?.messageId) {
    body.quoted = {
      key: {
        id: params.quoted.messageId,
        remoteJid: params.quoted.remoteJid,
        fromMe: params.quoted.fromMe ?? false,
      },
      message: {
        conversation: params.quoted.conversation ?? "",
      },
    };
  }
  const send = await evolutionFetchJson<unknown>(`/message/sendText/${enc}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!send.ok) return send;

  const receipt = extractEvolutionSendReceipt(send.data);
  if (!receipt.messageId || receipt.deliveryStatus !== "pending") return send;

  // Evolution 2.3.7 can return HTTP 200/PENDING and immediately persist a
  // MessageUpdate=ERROR when the Baileys session was removed. Only an
  // explicit ERROR changes the HTTP success into failure; missing/late ACKs
  // remain pending and are reconciled asynchronously.
  const status = await evolutionWaitForMessageStatus({
    instanceName: params.instanceName,
    messageId: receipt.messageId,
  });
  if (status.status === "ERROR") {
    return { ok: false, status: 502, error: "evolution_delivery_error" };
  }
  return send;
}

export type EvolutionMessageStatusUpdate = {
  keyId: string;
  status: string;
  remoteJid: string | null;
  fromMe: boolean;
};

function parseEvolutionMessageStatusUpdates(data: unknown): EvolutionMessageStatusUpdate[] {
  const rows = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data)
      ? ((data as { data: unknown[] }).data)
      : [];
  return rows.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const keyId = typeof row.keyId === "string" ? row.keyId.trim() : "";
    const status = typeof row.status === "string" ? row.status.trim().toUpperCase() : "";
    if (!keyId || !status) return [];
    return [{
      keyId,
      status,
      remoteJid: typeof row.remoteJid === "string" ? row.remoteJid.trim() || null : null,
      fromMe: row.fromMe === true,
    }];
  });
}

/** Reads the authoritative MessageUpdate row stored by Evolution 2.3.x. */
export async function evolutionFindMessageStatus(params: {
  instanceName: string;
  messageId: string;
}): Promise<EvolutionFetchResult<EvolutionMessageStatusUpdate | null>> {
  const enc = encodeURIComponent(params.instanceName);
  const res = await evolutionFetchJson<unknown>(`/chat/findStatusMessage/${enc}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ where: { id: params.messageId }, page: 1, offset: 10 }),
    timeoutMs: 8_000,
  });
  if (!res.ok) return res;
  const update = parseEvolutionMessageStatusUpdates(res.data)
    .find((item) => item.keyId === params.messageId) ?? null;
  return { ok: true, status: res.status, data: update };
}

export async function evolutionWaitForMessageStatus(params: {
  instanceName: string;
  messageId: string;
  attempts?: number;
  intervalMs?: number;
}): Promise<{ status: string | null; update: EvolutionMessageStatusUpdate | null }> {
  const attempts = Math.max(1, params.attempts ?? MESSAGE_STATUS_POLL_ATTEMPTS);
  const intervalMs = Math.max(0, params.intervalMs ?? MESSAGE_STATUS_POLL_INTERVAL_MS);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (intervalMs > 0) await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const result = await evolutionFindMessageStatus(params);
    if (!result.ok || !result.data) continue;
    if (result.data.status !== "PENDING") {
      return { status: result.data.status, update: result.data };
    }
  }
  return { status: null, update: null };
}

export type EvolutionWhatsappNumberCheck = {
  exists: boolean;
  jid: string | null;
  /** JID alternativo (@lid) exigido por alguns contatos após migração WhatsApp. */
  jidAlt: string | null;
  number: string;
};

/** Extrai os dígitos de um JID WhatsApp (556293580574@s.whatsapp.net → 556293580574). */
export function jidToDigits(jid: string | null | undefined): string {
  if (!jid) return "";
  return jid.split("@")[0]?.replace(/\D/g, "") ?? "";
}

/**
 * Endereço preferido para sendText: normaliza BR com 9; só usa JID completo para @lid.
 */
export function formatEvolutionSendAddress(jid: string | null | undefined, fallbackDigits: string): string {
  const wanted = ensureBrazilianMobileWhatsappDigits(fallbackDigits.replace(/\D/g, ""));
  const trimmed = typeof jid === "string" ? jid.trim() : "";
  if (trimmed.endsWith("@lid")) return trimmed;
  if (trimmed.includes("@s.whatsapp.net")) {
    return jidToDigits(trimmed) || wanted;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length >= 12) return digits;
  return wanted;
}

/** Candidatos de envio — sempre prioriza dígitos com 9 (igual /conversas/send). */
export function buildEvolutionSendCandidates(params: {
  platformNumber: string;
  jid?: string | null;
  jidAlt?: string | null;
  alternateDigits?: string | null;
}): string[] {
  const wanted = ensureBrazilianMobileWhatsappDigits(params.platformNumber.replace(/\D/g, ""));
  const alternate = params.alternateDigits ?? brazilianMobileAlternateVariant(wanted);
  const out: string[] = [];
  const add = (value: string | null | undefined) => {
    const v = typeof value === "string" ? value.trim() : "";
    if (!v || out.includes(v)) return;
    out.push(v);
  };

  add(wanted);
  add(alternate);
  for (const jid of [params.jidAlt, params.jid]) {
    if (jid?.endsWith("@lid")) add(jid);
  }

  return out.filter((v) => v.length >= 8);
}

/**
 * Garante o 9º dígito em linhas móveis brasileiras (55 + DDD + 9 + local).
 * Alinhado com normalizeBrazilianJid em evolution-webhook-parse.ts — o restante
 * da plataforma (conversas, CRM, handoff) usa o formato de 13 dígitos.
 */
export function ensureBrazilianMobileWhatsappDigits(digits: string): string {
  const clean = digits.replace(/\D/g, "");
  if (clean.startsWith("55") && clean.length === 12) {
    const local = clean.slice(4);
    if (/^[6-9]/.test(local)) {
      return `${clean.slice(0, 4)}9${local}`;
    }
  }
  return clean;
}

/** Variante com/sem 9º dígito para checagem na Evolution (ex.: 5562993580574 ↔ 556293580574). */
export function brazilianMobileAlternateVariant(digits: string): string | null {
  const clean = digits.replace(/\D/g, "");
  if (!clean.startsWith("55")) return null;
  if (clean.length === 13 && clean[4] === "9") {
    const local = clean.slice(5);
    if (/^[6-9]/.test(local)) {
      return `${clean.slice(0, 4)}${local}`;
    }
  }
  if (clean.length === 12) {
    const withNine = ensureBrazilianMobileWhatsappDigits(clean);
    return withNine !== clean ? withNine : null;
  }
  return null;
}

/**
 * Verifica se números existem no WhatsApp.
 * POST /chat/whatsappNumbers/{instance}
 */
export async function evolutionCheckWhatsappNumbers(params: {
  instanceName: string;
  numbers: string[];
}): Promise<EvolutionFetchResult<EvolutionWhatsappNumberCheck[]>> {
  const enc = encodeURIComponent(params.instanceName);
  const res = await evolutionFetchJson<unknown>(`/chat/whatsappNumbers/${enc}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ numbers: params.numbers }),
    timeoutMs: 12_000,
  });
  if (!res.ok) return res;

  const rawArray = Array.isArray(res.data)
    ? res.data
    : Array.isArray((res.data as { data?: unknown } | null)?.data)
      ? (res.data as { data: unknown[] }).data
      : [];

  const parsed: EvolutionWhatsappNumberCheck[] = rawArray
    .map((item): EvolutionWhatsappNumberCheck | null => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const jid = typeof o.jid === "string" && o.jid.trim() ? o.jid.trim() : null;
      const jidAltRaw =
        (typeof o.remoteJidAlt === "string" && o.remoteJidAlt.trim()) ||
        (typeof o.jidAlt === "string" && o.jidAlt.trim()) ||
        null;
      const number = typeof o.number === "string" ? o.number.replace(/\D/g, "") : "";
      return { exists: Boolean(o.exists), jid, jidAlt: jidAltRaw, number };
    })
    .filter((x): x is EvolutionWhatsappNumberCheck => x !== null);

  return { ok: true, status: res.status, data: parsed };
}

/**
 * Testa se a sessão Baileys tem chaves criptográficas reais na tabela Session do Evolution.
 * Retorna true se a Evolution conseguiu processar a requisição (sessão com chaves válidas).
 * Retorna false se a chamada falhou ou excedeu 5s (sessão zumbi: connectionStatus=open mas
 * Session table vazia → WhatsApp rejeita todos os envios com ERROR imediatamente).
 *
 * Usa Promise.race porque evolutionCheckWhatsappNumbers hardcoda 12s de timeout internamente
 * e não aceita timeoutMs externo — 12s bloquearia o poll de sessão da UI.
 */
export async function checkEvolutionSessionAlive(
  instanceName: string,
  ownerJidDigits: string,
): Promise<boolean> {
  const check = evolutionCheckWhatsappNumbers({ instanceName, numbers: [ownerJidDigits] });
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000));
  const result = await Promise.race([check, timeout]);
  if (result === null) return false;
  return result.ok;
}

/**
 * Valida existência no WhatsApp e devolve o número de envio que a Evolution reconhece.
 * Quando a API retorna um JID, usamos os dígitos desse JID no sendText — é o endereço
 * que o Baileys/Evolution usa para rotear a mensagem.
 */
export async function resolveEvolutionSendNumber(params: {
  instanceName: string;
  number: string;
}): Promise<
  | { status: "exists"; sendNumber: string; jid: string | null; platformNumber: string; candidateNumbers: string[] }
  | { status: "not_found"; jid: string | null; platformNumber: string; candidateNumbers: string[] }
  | { status: "check_failed"; error: string; platformNumber: string; candidateNumbers: string[] }
> {
  const wanted = ensureBrazilianMobileWhatsappDigits(params.number.replace(/\D/g, ""));
  const alternate = brazilianMobileAlternateVariant(wanted);
  const numbersToCheck =
    alternate && alternate !== wanted ? Array.from(new Set([wanted, alternate])) : [wanted];

  const check = await evolutionCheckWhatsappNumbers({
    instanceName: params.instanceName,
    numbers: numbersToCheck,
  });
  if (!check.ok) {
    return {
      status: "check_failed",
      error: check.error,
      platformNumber: wanted,
      candidateNumbers: alternate ? [wanted, alternate] : [wanted],
    };
  }

  const exists = check.data.some((item) => item.exists);
  const match =
    check.data.find((item) => item.exists && item.number === wanted) ??
    check.data.find((item) => item.exists && item.number === alternate) ??
    check.data.find((item) => item.exists) ??
    null;

  if (!exists) {
    return {
      status: "not_found",
      jid: match?.jid ?? check.data[0]?.jid ?? null,
      platformNumber: wanted,
      candidateNumbers: alternate ? [wanted, alternate] : [wanted],
    };
  }

  const sendNumber = formatEvolutionSendAddress(match?.jid ?? match?.jidAlt, match?.number || wanted);
  const candidateNumbers = buildEvolutionSendCandidates({
    platformNumber: wanted,
    jid: match?.jid ?? null,
    jidAlt: match?.jidAlt ?? null,
    alternateDigits: alternate,
  });

  return {
    status: "exists",
    sendNumber,
    jid: match?.jid ?? match?.jidAlt ?? null,
    platformNumber: wanted,
    candidateNumbers,
  };
}

/** Indica erro de entrega no campo `status` típico da Evolution/Baileys (0 = ERROR). */
export function isEvolutionDeliveryErrorStatus(status: unknown): boolean {
  if (status === 0) return true;
  if (typeof status === "string") {
    const normalized = status.trim().toUpperCase();
    return normalized === "ERROR" || normalized === "FAILED";
  }
  return false;
}

export function isEvolutionConnectionClosedError(error: string | null | undefined): boolean {
  if (!error) return false;
  return /connection\s*closed/i.test(error);
}

/**
 * Indica entrega confirmada no aparelho a partir do `status` típico Baileys/Evolution.
 * Numérico: 3 = DELIVERY_ACK, 4 = READ, 5 = PLAYED. (1 = PENDING, 2 = SERVER_ACK não contam
 * como entrega no aparelho.) Aceita também os equivalentes em string.
 */
export function isEvolutionDeliveredStatus(status: unknown): boolean {
  if (typeof status === "number") return status >= 3;
  if (typeof status === "string") {
    const normalized = status.trim().toUpperCase();
    return normalized === "DELIVERY_ACK" || normalized === "READ" || normalized === "PLAYED";
  }
  return false;
}

/** PENDING (1 ou string) — aceito pela Evolution, aguardando confirmação WhatsApp. */
export function isEvolutionPendingStatus(status: unknown): boolean {
  if (typeof status === "number" && status === 1) return true;
  if (typeof status === "string" && status.trim().toUpperCase() === "PENDING") return true;
  return false;
}

/** SERVER_ACK (2+) ou equivalente — WhatsApp confirmou recepção no servidor (melhor que PENDING). */
export function isEvolutionSentAckStatus(status: unknown): boolean {
  if (typeof status === "number" && status >= 2) return true;
  if (typeof status === "string") {
    const normalized = status.trim().toUpperCase();
    return (
      normalized === "SERVER_ACK" ||
      normalized === "DELIVERY_ACK" ||
      normalized === "READ" ||
      normalized === "PLAYED"
    );
  }
  return false;
}

/**
 * Envia mídia (imagem, vídeo, documento) via Evolution API v2.
 * POST /message/sendMedia/{instance}
 * `media` pode ser base64 puro (sem prefixo data:...) ou URL HTTPS (ex.: presign R2)
 * conforme suportado pela instância Evolution.
 */
export async function evolutionSendMedia(params: {
  instanceName: string;
  number: string;
  mediatype: "image" | "video" | "document";
  mimetype: string;
  /** Base64 do ficheiro ou URL HTTPS acessível pela Evolution. */
  media: string;
  /** Legenda / nome do ficheiro. */
  caption?: string;
  fileName?: string;
}): Promise<EvolutionFetchResult<unknown>> {
  const enc = encodeURIComponent(params.instanceName);
  return evolutionFetchJson(`/message/sendMedia/${enc}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      number: params.number,
      mediatype: params.mediatype,
      mimetype: params.mimetype,
      media: params.media,
      caption: params.caption ?? "",
      fileName: params.fileName ?? "",
    }),
    timeoutMs: 60_000,
  });
}

/**
 * Envia áudio PTT (push-to-talk) via Evolution API v2.
 * POST /message/sendWhatsAppAudio/{instance}
 * `audio` pode ser base64 puro ou URL HTTPS acessível pela Evolution.
 * O campo `encoding: true` instrui a Evolution a re-codificar para opus/ogg se necessário.
 */
export async function evolutionSendAudio(params: {
  instanceName: string;
  number: string;
  /** Base64 do áudio ou URL HTTPS. */
  audio: string;
}): Promise<EvolutionFetchResult<unknown>> {
  const enc = encodeURIComponent(params.instanceName);
  return evolutionFetchJson(`/message/sendWhatsAppAudio/${enc}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      number: params.number,
      audio: params.audio,
      encoding: true,
    }),
    timeoutMs: 60_000,
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
 * POST /chat/findContacts/{instance} com body { where: { remoteJid } } devolve array de contactos.
 * Retorna o pushName ou name, ou null se não encontrado.
 */
export async function fetchContactName(
  instanceName: string,
  remoteJid: string,
): Promise<string | null> {
  const enc = encodeURIComponent(instanceName);
  const res = await evolutionFetchJson<unknown>(
    `/chat/findContacts/${enc}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ where: { remoteJid } }),
      timeoutMs: 8_000,
    },
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
