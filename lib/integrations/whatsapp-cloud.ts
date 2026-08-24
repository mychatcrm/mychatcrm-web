import { createHmac, timingSafeEqual } from "node:crypto";

export type WhatsAppInboundText = {
  fromWaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  text: string;
  messageId: string;
  contactName: string | null;
};

/** Extrai primeira mensagem de texto do payload Cloud API (formato típico webhook). */
export function parseWhatsAppCloudPayload(body: unknown): WhatsAppInboundText | null {
  const root = body as { entry?: Array<{ changes?: Array<{ value?: unknown }> }> };
  const entries = root.entry;
  if (!Array.isArray(entries)) return null;
  for (const ent of entries) {
    const changes = ent.changes;
    if (!Array.isArray(changes)) continue;
    for (const ch of changes) {
      const value = ch.value as Record<string, unknown> | undefined;
      if (!value || typeof value !== "object") continue;
      const metadata = value.metadata as { display_phone_number?: string; phone_number_id?: string } | undefined;
      const contacts = value.contacts as unknown[] | undefined;
      const messages = value.messages as unknown[] | undefined;
      if (!Array.isArray(messages) || !metadata?.phone_number_id) continue;
      const m = messages[0] as Record<string, unknown> | undefined;
      if (!m || m.type !== "text") continue;
      const textObj = m.text as { body?: string } | undefined;
      const from = m.from;
      const id = m.id;
      if (typeof from !== "string" || typeof textObj?.body !== "string") continue;
      return {
        fromWaId: from,
        phoneNumberId: String(metadata.phone_number_id),
        displayPhoneNumber: typeof metadata.display_phone_number === "string" ? metadata.display_phone_number : null,
        text: textObj.body,
        messageId: typeof id === "string" ? id : "",
        contactName: extractCloudContactName(contacts, from),
      };
    }
  }
  return null;
}

export type WhatsAppInboundKind = "text" | "audio" | "image" | "document" | "video";

export type WhatsAppInboundMessage = {
  fromWaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  messageId: string;
  contactName: string | null;
  kind: WhatsAppInboundKind;
  text: string;
  /** Para mídia: id do media na Graph API, mimeType e caption. */
  mediaId: string | null;
  mimeType: string | null;
  caption: string | null;
};

/**
 * Parse de inbound Cloud API com suporte a texto, áudio e imagem (e documento/vídeo).
 * Retorna a primeira mensagem do payload.
 */
export function parseWhatsAppCloudInbound(body: unknown): WhatsAppInboundMessage | null {
  const root = body as { entry?: Array<{ changes?: Array<{ value?: unknown }> }> };
  const entries = root.entry;
  if (!Array.isArray(entries)) return null;
  for (const ent of entries) {
    const changes = ent.changes;
    if (!Array.isArray(changes)) continue;
    for (const ch of changes) {
      const value = ch.value as Record<string, unknown> | undefined;
      if (!value || typeof value !== "object") continue;
      const metadata = value.metadata as { display_phone_number?: string; phone_number_id?: string } | undefined;
      const contacts = value.contacts as unknown[] | undefined;
      const messages = value.messages as unknown[] | undefined;
      if (!Array.isArray(messages) || !metadata?.phone_number_id) continue;
      const m = messages[0] as Record<string, unknown> | undefined;
      if (!m) continue;
      const from = m.from;
      const id = m.id;
      if (typeof from !== "string") continue;

      const phoneNumberId = String(metadata.phone_number_id);
      const displayPhoneNumber =
        typeof metadata.display_phone_number === "string" ? metadata.display_phone_number : null;
      const contactName = extractCloudContactName(contacts, from);
      const messageId = typeof id === "string" ? id : "";
      const type = typeof m.type === "string" ? m.type : "text";

      const base = { fromWaId: from, phoneNumberId, displayPhoneNumber, messageId, contactName };

      if (type === "text") {
        const textObj = m.text as { body?: string } | undefined;
        if (typeof textObj?.body !== "string") continue;
        return { ...base, kind: "text", text: textObj.body, mediaId: null, mimeType: null, caption: null };
      }

      if (type === "audio" || type === "image" || type === "document" || type === "video") {
        const mediaObj = m[type] as { id?: string; mime_type?: string; caption?: string } | undefined;
        const mediaId = typeof mediaObj?.id === "string" ? mediaObj.id : null;
        const mimeType = typeof mediaObj?.mime_type === "string" ? mediaObj.mime_type : null;
        const caption = typeof mediaObj?.caption === "string" ? mediaObj.caption : null;
        return {
          ...base,
          kind: type as WhatsAppInboundKind,
          text: caption ?? "",
          mediaId,
          mimeType,
          caption,
        };
      }
    }
  }
  return null;
}

/** Baixa a mídia da Cloud API: resolve a URL pelo media id e faz o download dos bytes. */
export async function fetchWhatsAppCloudMedia(
  mediaId: string,
  accessToken: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const metaRes = await fetch(`${GRAPH_API}/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!metaRes.ok) return null;
    const meta = (await metaRes.json().catch(() => ({}))) as { url?: string; mime_type?: string };
    if (!meta.url) return null;

    const binRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!binRes.ok) return null;
    const arrayBuf = await binRes.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuf),
      mimeType: meta.mime_type ?? "application/octet-stream",
    };
  } catch {
    return null;
  }
}

function extractCloudContactName(contacts: unknown[] | undefined, waId: string): string | null {
  if (!Array.isArray(contacts)) return null;
  for (const contact of contacts) {
    if (!contact || typeof contact !== "object") continue;
    const row = contact as Record<string, unknown>;
    if (typeof row.wa_id === "string" && row.wa_id !== waId) continue;
    const profile = row.profile && typeof row.profile === "object"
      ? (row.profile as Record<string, unknown>)
      : null;
    const name = profile?.name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return null;
}

export function verifyMetaSignature256(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected =
    "sha256=" + createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  try {
    const a = Buffer.from(signatureHeader, "utf8");
    const b = Buffer.from(expected, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const GRAPH_API = "https://graph.facebook.com/v21.0";

/** Meta Cloud `to` exige só dígitos (wa_id) — nunca JID `@s.whatsapp.net`. */
export function normalizeWhatsAppCloudToWaId(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/**
 * Classifica o erro cru da Graph API num código de máquina, pra quem chama
 * decidir o que fazer sem precisar re-implementar a detecção de texto.
 * Espelha as mesmas condições usadas nas mensagens amigáveis das rotas de
 * teste de envio: 131047 = fora da janela de 24h (texto livre recusado);
 * 190/"session has expired"/"invalid oauth" = token inválido ou expirado.
 */
export function classifyWhatsAppCloudSendError(
  raw: string | undefined,
): "outside_24h_window" | "invalid_token" | "other" {
  const text = raw ?? "";
  if (text.includes("131047") || /outside.*allowed.*window/i.test(text)) {
    return "outside_24h_window";
  }
  if (text.includes("190") || /session has expired|invalid oauth/i.test(text)) {
    return "invalid_token";
  }
  return "other";
}

export type WhatsAppCloudHealthCheck =
  | {
      ok: true;
      displayPhoneNumber: string | null;
      verifiedName: string | null;
      qualityRating: string | null;
      messagingLimitTier: string | null;
    }
  | { ok: false; code: "invalid_token" | "unreachable" | "other"; error: string };

/**
 * Diagnóstico somente-leitura do token/número — NUNCA envia mensagem.
 * Usado para decidir, antes de tentar um envio de teste, se a causa provável
 * de falha é um token morto (sobra do fallback silencioso de
 * exchange-code) em vez de gastar uma tentativa de envio real.
 */
export async function checkWhatsAppCloudConnectionHealth(params: {
  phoneNumberId: string;
  accessToken: string;
}): Promise<WhatsAppCloudHealthCheck> {
  const url = `${GRAPH_API}/${encodeURIComponent(params.phoneNumberId)}?fields=id,display_phone_number,verified_name,quality_rating,messaging_limit_tier`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${params.accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return {
      ok: false,
      code: "unreachable",
      error: err instanceof Error ? err.message : "fetch_failed",
    };
  }
  const data = (await res.json().catch(() => ({}))) as {
    display_phone_number?: string;
    verified_name?: string;
    quality_rating?: string;
    messaging_limit_tier?: string;
    error?: { message?: string; code?: number };
  };
  if (!res.ok) {
    const message = data.error?.message ?? `http_${res.status}`;
    const code =
      res.status === 401 || res.status === 403 || classifyWhatsAppCloudSendError(message) === "invalid_token"
        ? "invalid_token"
        : "other";
    return { ok: false, code, error: message };
  }
  return {
    ok: true,
    displayPhoneNumber: data.display_phone_number ?? null,
    verifiedName: data.verified_name ?? null,
    qualityRating: data.quality_rating ?? null,
    messagingLimitTier: data.messaging_limit_tier ?? null,
  };
}

export async function sendWhatsAppTextMessage(params: {
  toWaId: string;
  text: string;
  phoneNumberId: string;
  accessToken: string;
}): Promise<{ ok: boolean; status: number; messageId?: string; error?: string }> {
  const to = normalizeWhatsAppCloudToWaId(params.toWaId);
  if (!to) {
    return { ok: false, status: 400, error: "invalid_to_wa_id" };
  }
  const url = `${GRAPH_API}/${encodeURIComponent(params.phoneNumberId)}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { preview_url: false, body: params.text.slice(0, 4096) },
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: t.slice(0, 500) };
  }
  const data = await res.json().catch(() => ({})) as { messages?: Array<{ id?: string }> };
  return { ok: true, status: res.status, messageId: data.messages?.[0]?.id };
}

export type WhatsAppCloudMediaKind = "audio" | "image" | "video" | "document";

/**
 * Envia mídia por URL HTTPS ou por media id previamente carregado na Meta.
 * O caller escolhe exatamente uma das duas origens; credenciais e URLs nunca
 * são colocadas em query string.
 */
export async function sendWhatsAppMediaMessage(params: {
  toWaId: string;
  kind: WhatsAppCloudMediaKind;
  phoneNumberId: string;
  accessToken: string;
  mediaId?: string | null;
  link?: string | null;
  caption?: string | null;
  filename?: string | null;
}): Promise<{ ok: boolean; status: number; messageId?: string; error?: string }> {
  const to = normalizeWhatsAppCloudToWaId(params.toWaId);
  const mediaId = params.mediaId?.trim() || null;
  const link = params.link?.trim() || null;
  if (!to) return { ok: false, status: 400, error: "invalid_to_wa_id" };
  if ((mediaId ? 1 : 0) + (link ? 1 : 0) !== 1) {
    return { ok: false, status: 400, error: "invalid_media_source" };
  }

  const media: Record<string, string> = mediaId ? { id: mediaId } : { link: link! };
  if (params.kind !== "audio" && params.caption?.trim()) {
    media.caption = params.caption.trim().slice(0, 1024);
  }
  if (params.kind === "document" && params.filename?.trim()) {
    media.filename = params.filename.trim().slice(0, 240);
  }

  const url = `${GRAPH_API}/${encodeURIComponent(params.phoneNumberId)}/messages`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: params.kind,
        [params.kind]: media,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "meta_media_send_failed",
    };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: body.slice(0, 500) };
  }
  const data = (await res.json().catch(() => ({}))) as { messages?: Array<{ id?: string }> };
  return { ok: true, status: res.status, messageId: data.messages?.[0]?.id };
}

/** Carrega bytes no endpoint de mídia da conexão exata antes do envio. */
export async function uploadWhatsAppCloudMedia(params: {
  phoneNumberId: string;
  accessToken: string;
  buffer: Buffer;
  mimeType: string;
  filename: string;
}): Promise<{ ok: boolean; status: number; mediaId?: string; error?: string }> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", params.mimeType);
  form.append(
    "file",
    new Blob([new Uint8Array(params.buffer)], { type: params.mimeType }),
    params.filename,
  );
  let res: Response;
  try {
    res = await fetch(`${GRAPH_API}/${encodeURIComponent(params.phoneNumberId)}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${params.accessToken}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "meta_media_upload_failed",
    };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: body.slice(0, 500) };
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return data.id
    ? { ok: true, status: res.status, mediaId: data.id }
    : { ok: false, status: res.status, error: "meta_media_id_missing" };
}

/**
 * A Meta rejeita parâmetro de template com quebra de linha/tab ou mais de 4
 * espaços seguidos (erro 132018) — corpos de mensagem no app são compostos em
 * múltiplas linhas, então precisam virar uma única linha antes de virar {{n}}.
 */
function sanitizeTemplateParamText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Envia um template aprovado — obrigatório para mensagens iniciadas pela
 * empresa fora da janela de atendimento de 24h (texto livre é aceito mas
 * descartado pela Meta com erro 131047 nesse cenário).
 */
export async function sendWhatsAppTemplateMessage(params: {
  toWaId: string;
  templateName: string;
  languageCode: string;
  bodyParams?: string[];
  phoneNumberId: string;
  accessToken: string;
}): Promise<{ ok: boolean; status: number; messageId?: string; error?: string }> {
  const to = normalizeWhatsAppCloudToWaId(params.toWaId);
  if (!to) {
    return { ok: false, status: 400, error: "invalid_to_wa_id" };
  }
  const url = `${GRAPH_API}/${encodeURIComponent(params.phoneNumberId)}/messages`;
  const components =
    params.bodyParams && params.bodyParams.length > 0
      ? [
          {
            type: "body",
            parameters: params.bodyParams.map((text) => ({
              type: "text",
              text: sanitizeTemplateParamText(text.slice(0, 1024)),
            })),
          },
        ]
      : undefined;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: params.templateName,
        language: { code: params.languageCode },
        ...(components ? { components } : {}),
      },
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: t.slice(0, 500) };
  }
  const data = await res.json().catch(() => ({})) as { messages?: Array<{ id?: string }> };
  return { ok: true, status: res.status, messageId: data.messages?.[0]?.id };
}

/**
 * Confirma se um template existe e está aprovado na WABA antes de salvá-lo —
 * evita descobrir um nome errado ou não aprovado só no próximo disparo real.
 */
export async function fetchWhatsAppMessageTemplateStatus(params: {
  wabaId: string;
  templateName: string;
  accessToken: string;
}): Promise<{ found: boolean; status: "APPROVED" | "PENDING" | "REJECTED" | null; category: string | null }> {
  const url = `${GRAPH_API}/${encodeURIComponent(params.wabaId)}/message_templates?name=${encodeURIComponent(params.templateName)}&fields=name,status,category`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${params.accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return { found: false, status: null, category: null };
  const data = (await res.json().catch(() => ({}))) as {
    data?: Array<{ name?: string; status?: string; category?: string }>;
  };
  const match = data.data?.find((t) => t.name === params.templateName);
  if (!match) return { found: false, status: null, category: null };
  const status = match.status === "APPROVED" || match.status === "PENDING" || match.status === "REJECTED" ? match.status : null;
  return { found: true, status, category: match.category ?? null };
}

/** Cria o template utilitário usado pelas notificações operacionais do agente
 * do sistema. A aprovação final é assíncrona e deve ser consultada pelo nome. */
export async function createWhatsAppMessageTemplate(params: {
  wabaId: string;
  accessToken: string;
  templateName: string;
  languageCode?: string;
}): Promise<{
  ok: boolean;
  status: number;
  templateStatus: "APPROVED" | "PENDING" | "REJECTED" | null;
  id?: string;
  error?: string;
  metaError?: {
    code: number | null;
    subcode: number | null;
    title: string | null;
    message: string | null;
    details: string | null;
  };
}> {
  const url = `${GRAPH_API}/${encodeURIComponent(params.wabaId)}/message_templates`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: params.templateName,
      language: params.languageCode || "pt_BR",
      category: "UTILITY",
      components: [
        {
          type: "BODY",
          text: "Olá! Há uma atualização operacional na sua conta MyChatCRM. Detalhes: {{1}} Esta é uma mensagem automática do MyChatCRM.",
          example: {
            body_text: [["Novo agendamento confirmado para 20/07/2026 às 14:00."]],
          },
        },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    id?: string;
    status?: string;
    error?: {
      message?: string;
      code?: number;
      error_subcode?: number;
      error_user_title?: string;
      error_user_msg?: string;
      error_data?: { details?: string };
    };
  };
  if (!res.ok) {
    const metaError = {
      code: typeof data.error?.code === "number" ? data.error.code : null,
      subcode: typeof data.error?.error_subcode === "number" ? data.error.error_subcode : null,
      title: data.error?.error_user_title?.trim() || null,
      message: data.error?.error_user_msg?.trim() || data.error?.message?.trim() || null,
      details: data.error?.error_data?.details?.trim() || null,
    };
    const error = [metaError.title, metaError.message, metaError.details]
      .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
      .join(" — ")
      .slice(0, 800);
    return {
      ok: false,
      status: res.status,
      templateStatus: null,
      error: error || `meta_template_create_${res.status}`,
      metaError,
    };
  }
  const templateStatus =
    data.status === "APPROVED" || data.status === "PENDING" || data.status === "REJECTED"
      ? data.status
      : "PENDING";
  return { ok: true, status: res.status, templateStatus, id: data.id };
}

export type WhatsAppCloudTemplate = {
  name: string;
  status: string;
  category: string | null;
  language: string | null;
  bodyText: string | null;
  /** Quantos placeholders {{1}}, {{2}}... o corpo do template usa. */
  bodyParamCount: number;
};

/**
 * Lista os templates da WABA do tenant (nome, status, corpo e quantos
 * parâmetros posicionais {{n}} o corpo usa) — usado pelo seletor de template
 * de Disparos via API Meta (mensagem business-initiated fora da janela de
 * 24h precisa de template aprovado, ver sendWhatsAppTemplateMessage acima).
 */
export async function listWhatsAppMessageTemplates(params: {
  wabaId: string;
  accessToken: string;
}): Promise<WhatsAppCloudTemplate[]> {
  const url = `${GRAPH_API}/${encodeURIComponent(params.wabaId)}/message_templates?fields=name,status,category,language,components&limit=100`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${params.accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  const data = (await res.json().catch(() => ({}))) as {
    data?: Array<{
      name?: string;
      status?: string;
      category?: string;
      language?: string;
      components?: Array<{ type?: string; text?: string }>;
    }>;
  };
  return (data.data ?? [])
    .filter((t): t is typeof t & { name: string } => Boolean(t.name))
    .map((t) => {
      const body = t.components?.find((c) => c.type === "BODY");
      const bodyText = body?.text ?? null;
      const paramMatches = bodyText ? new Set(bodyText.match(/\{\{\d+\}\}/g) ?? []) : new Set<string>();
      return {
        name: t.name,
        status: t.status ?? "",
        category: t.category ?? null,
        language: t.language ?? null,
        bodyText,
        bodyParamCount: paramMatches.size,
      };
    });
}

export type WhatsAppCloudStatus = {
  id: string;
  status: string;
  recipientId: string;
  /** Motivo real quando status = failed (ex.: 131047 = fora da janela de 24h). */
  errorCode: number | null;
  errorTitle: string | null;
  errorDetail: string | null;
};

export function parseWhatsAppCloudStatuses(body: unknown): WhatsAppCloudStatus[] {
  const root = body as { entry?: Array<{ changes?: Array<{ value?: unknown }> }> };
  const entries = root.entry;
  if (!Array.isArray(entries)) return [];
  const result: WhatsAppCloudStatus[] = [];
  for (const ent of entries) {
    const changes = ent.changes;
    if (!Array.isArray(changes)) continue;
    for (const ch of changes) {
      const value = ch.value as Record<string, unknown> | undefined;
      if (!value || typeof value !== "object") continue;
      const statuses = value.statuses as unknown[] | undefined;
      if (!Array.isArray(statuses)) continue;
      for (const s of statuses) {
        if (!s || typeof s !== "object") continue;
        const row = s as Record<string, unknown>;
        const id = typeof row.id === "string" ? row.id.trim() : "";
        const status = typeof row.status === "string" ? row.status.trim() : "";
        const recipientId = typeof row.recipient_id === "string" ? row.recipient_id.trim() : "";
        if (!id || !status) continue;

        // A Meta explica falhas em statuses[].errors[] — sem isso, um "failed"
        // fica indistinguível (ex.: 131047 exige template fora da janela de 24h).
        let errorCode: number | null = null;
        let errorTitle: string | null = null;
        let errorDetail: string | null = null;
        const errors = row.errors as unknown[] | undefined;
        const firstError = Array.isArray(errors) ? (errors[0] as Record<string, unknown> | undefined) : undefined;
        if (firstError && typeof firstError === "object") {
          errorCode = typeof firstError.code === "number" ? firstError.code : null;
          errorTitle = typeof firstError.title === "string" ? firstError.title : null;
          const errData = firstError.error_data as Record<string, unknown> | undefined;
          errorDetail =
            typeof errData?.details === "string"
              ? errData.details
              : typeof firstError.message === "string"
                ? firstError.message
                : null;
        }

        result.push({ id, status, recipientId, errorCode, errorTitle, errorDetail });
      }
    }
  }
  return result;
}
