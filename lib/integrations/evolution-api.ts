/**
 * Cliente HTTP Evolution API v2 (OpenAPI 2.1.x).
 * Auth: header `apikey` — ver `evolutionApiKey()` para nomes de env suportados.
 * @see https://doc.evolution-api.com/v2/
 */

import { createHash } from "node:crypto";
import { randomBytes } from "node:crypto";

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
      base64: true,
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
  return evolutionFetchJson(`/webhook/set/${enc}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enabled: true,
      url: params.url,
      webhookByEvents: false,
      webhookBase64: true,
      events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
    }),
  });
}

export async function evolutionDeleteInstance(instanceName: string): Promise<EvolutionFetchResult<unknown>> {
  const enc = encodeURIComponent(instanceName.trim());
  return evolutionFetchJson(`/instance/delete/${enc}`, { method: "DELETE" });
}

export type EvolutionRemoveInstanceResult = {
  ok: boolean;
  deleted: boolean;
  verifiedAbsent: boolean;
  error: string | null;
  status: number | null;
};

async function evolutionInstanceExists(instanceName: string): Promise<boolean> {
  const res = await evolutionFetchInstances(instanceName.trim());
  if (!res.ok) return false;
  return pickEvolutionInstanceInfo(res.data, instanceName.trim()) !== null;
}

/**
 * Remove instância da Evolution de forma completa: logout (best-effort), delete e verificação.
 * O endpoint delete da Evolution já faz logout internamente; repetimos logout antes por compatibilidade.
 */
export async function evolutionRemoveInstanceCompletely(
  instanceName: string,
): Promise<EvolutionRemoveInstanceResult> {
  const trimmed = instanceName.trim();
  if (!trimmed) {
    return { ok: false, deleted: false, verifiedAbsent: false, error: "empty_instance_name", status: null };
  }

  await evolutionLogoutInstance(trimmed).catch(() => null);

  let del = await evolutionDeleteInstance(trimmed);
  if (!del.ok && del.status !== 404) {
    // Segunda tentativa (alguns builds falham se logout anterior deixou estado inconsistente).
    del = await evolutionDeleteInstance(trimmed);
  }

  if (!del.ok && del.status !== 404) {
    return {
      ok: false,
      deleted: false,
      verifiedAbsent: false,
      error: del.error,
      status: del.status,
    };
  }

  const stillThere = await evolutionInstanceExists(trimmed);
  return {
    ok: !stillThere,
    deleted: true,
    verifiedAbsent: !stillThere,
    error: stillThere ? "instance_still_present_after_delete" : null,
    status: del.status,
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
  return evolutionFetchJson(`/instance/logout/${enc}`, { method: "DELETE" });
}

export async function evolutionSendText(params: {
  instanceName: string;
  /** Digits with country code, no @ suffix (ex: 5511999999999). */
  number: string;
  text: string;
  quoted?: {
    messageId: string;
    remoteJid: string;
    fromMe?: boolean;
    conversation?: string;
  } | null;
}): Promise<EvolutionFetchResult<unknown>> {
  const enc = encodeURIComponent(params.instanceName);
  const body: Record<string, unknown> = {
    number: params.number,
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
  return evolutionFetchJson(`/message/sendText/${enc}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export type EvolutionWhatsappNumberCheck = {
  exists: boolean;
  jid: string | null;
  number: string;
};

/** Extrai os dígitos de um JID WhatsApp (556293580574@s.whatsapp.net → 556293580574). */
export function jidToDigits(jid: string | null | undefined): string {
  if (!jid) return "";
  return jid.split("@")[0]?.replace(/\D/g, "") ?? "";
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
      const number = typeof o.number === "string" ? o.number.replace(/\D/g, "") : "";
      return { exists: Boolean(o.exists), jid, number };
    })
    .filter((x): x is EvolutionWhatsappNumberCheck => x !== null);

  return { ok: true, status: res.status, data: parsed };
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

  const jidDigits = jidToDigits(match?.jid);
  const sendNumber = jidDigits || match?.number || wanted;
  const candidateNumbers = Array.from(
    new Set([wanted, sendNumber, alternate].filter((n): n is string => Boolean(n && n.length >= 12))),
  );

  return {
    status: "exists",
    sendNumber,
    jid: match?.jid ?? null,
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
