/**
 * Normaliza a resposta de `GET /instance/connect/{instance}` (Evolution API v2 / ~2.3.x).
 *
 * A documentação OpenAPI cita `code` (string); em versões reais também aparecem
 * `base64`, objectos `qrcode`, ou `data:image/...;base64,...`.
 * O campo `code` pode ser o token de emparelhamento Baileys (`2@...`) — isso não é PNG;
 * nesse caso procuramos outro campo com imagem ou devolvemos null.
 */

/** Prefixos típicos do payload de emparelhamento Baileys (não é imagem PNG). */
const BAILEYS_PAIRING_PREFIX = "2@";

function looksLikeBaileysPairingToken(s: string): boolean {
  const t = s.trim();
  return t.startsWith(BAILEYS_PAIRING_PREFIX) && t.length < 400;
}

function looksLikeBase64ImageChunk(s: string): boolean {
  const t = s.replace(/\s/g, "");
  if (t.length < 80) return false;
  if (t.startsWith("data:image")) return true;
  return /^[A-Za-z0-9+/]+=*$/.test(t.slice(0, Math.min(t.length, 200)));
}

/**
 * Converte fragmento base64 ou data URL num `data:image/...` utilizável em `<img src>`.
 */
export function rawQrPayloadToDataUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:image/")) return trimmed;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (looksLikeBaileysPairingToken(trimmed) && !looksLikeBase64ImageChunk(trimmed)) return null;
  if (!looksLikeBase64ImageChunk(trimmed)) return null;
  return `data:image/png;base64,${trimmed.replace(/\s/g, "")}`;
}

function pickString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** Código de 8 caracteres para emparelhamento (WhatsApp → aparelhos ligados → código). */
const PAIRING_CODE_RE = /^[A-Z0-9]{6,10}$/i;

/**
 * Extrai `pairingCode` da resposta `/instance/connect/...` quando a imagem QR não vem no JSON.
 */
export function extractPairingCodeFromConnectPayload(payload: unknown): string | null {
  if (payload == null) return null;
  if (typeof payload !== "object") return null;
  const o = payload as Record<string, unknown>;

  const tryVal = (s: string | null): string | null => {
    if (!s) return null;
    const t = s.trim();
    if (PAIRING_CODE_RE.test(t)) return t.toUpperCase();
    return null;
  };

  const direct = tryVal(pickString(o.pairingCode, o.pairing_code));
  if (direct) return direct;

  const wrapped = o.data;
  if (wrapped !== undefined && wrapped !== null && wrapped !== o) {
    const inner = extractPairingCodeFromConnectPayload(wrapped);
    if (inner) return inner;
  }

  const nestedQr = o.qrcode;
  if (nestedQr && typeof nestedQr === "object" && !Array.isArray(nestedQr)) {
    const q = nestedQr as Record<string, unknown>;
    const p = tryVal(pickString(q.pairingCode, q.pairing_code));
    if (p) return p;
  }

  return null;
}

/**
 * Extrai um URL de imagem QR a partir do JSON devolvido por `/instance/connect/...`.
 * @param depth limite de profundidade para objectos `data` aninhados.
 */
export function normalizeInstanceConnectToQrDataUrl(payload: unknown, depth = 0): string | null {
  if (depth > 4) return null;
  if (payload == null) return null;

  if (typeof payload === "string") {
    return rawQrPayloadToDataUrl(payload);
  }

  if (typeof payload !== "object") return null;
  const o = payload as Record<string, unknown>;

  if (typeof o.qrcode === "string") {
    const fromStr = rawQrPayloadToDataUrl(o.qrcode);
    if (fromStr) return fromStr;
  }

  const wrapped = o.data;
  if (wrapped !== undefined && wrapped !== null && wrapped !== o) {
    const inner = normalizeInstanceConnectToQrDataUrl(wrapped, depth + 1);
    if (inner) return inner;
  }

  const nestedQr = o.qrcode;
  const nestedQrRecord =
    nestedQr && typeof nestedQr === "object" && !Array.isArray(nestedQr) ? (nestedQr as Record<string, unknown>) : null;

  const nestedPair = o.qr;
  const nestedPairRecord =
    nestedPair && typeof nestedPair === "object" && !Array.isArray(nestedPair) ? (nestedPair as Record<string, unknown>) : null;

  const candidates: (string | null)[] = [
    pickString(o.base64),
    pickString(nestedQrRecord?.base64),
    pickString(nestedQrRecord?.code),
    pickString(nestedQrRecord?.inBase64),
    pickString(nestedQrRecord?.img),
    pickString(nestedPairRecord?.base64),
    pickString(o.qr),
    pickString(typeof o.qrcode === "string" ? o.qrcode : null),
    pickString(o.code),
    pickString(o.qrCode),
    pickString(o.QRCode),
  ];

  for (const c of candidates) {
    if (!c) continue;
    const dataUrl = rawQrPayloadToDataUrl(c);
    if (dataUrl) return dataUrl;
  }

  return null;
}
