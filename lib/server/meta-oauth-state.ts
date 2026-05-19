import "server-only";

const STATE_PREFIX = "meta1";
const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

export type MetaOAuthStateInput = {
  tenantId: string;
  employeeId?: string;
};

export type MetaOAuthStatePayload = {
  tenantId: string;
  employeeId?: string;
};

function resolveSigningSecret(): string | null {
  return (
    process.env.META_APP_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    process.env.CLIENT_SESSION_COOKIE_SECRET?.trim() ||
    null
  );
}

function utf8BytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function base64UrlToBytes(b64url: string): Buffer {
  return Buffer.from(b64url, "base64url");
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** Assina state OAuth Meta (tenant + colaborador opcional + timestamp). */
export async function signMetaOAuthState(input: MetaOAuthStateInput): Promise<string | null> {
  const secret = resolveSigningSecret();
  if (!secret) return null;

  const payload = JSON.stringify({
    tenantId: input.tenantId,
    ...(input.employeeId ? { employeeId: input.employeeId } : {}),
    timestamp: Date.now(),
  });
  const payloadBytes = new TextEncoder().encode(payload);
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, payloadBytes);
  return `${STATE_PREFIX}.${utf8BytesToBase64Url(payloadBytes)}.${utf8BytesToBase64Url(new Uint8Array(sig))}`;
}

/** Verifica assinatura HMAC e rejeita states com mais de 10 minutos. */
export async function verifyMetaOAuthState(state: string): Promise<MetaOAuthStatePayload | null> {
  const secret = resolveSigningSecret();
  if (!secret) return null;

  const parts = state.split(".");
  if (parts.length !== 3 || parts[0] !== STATE_PREFIX) return null;
  const [, payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  let payloadBytes: Buffer;
  let sigBytes: Buffer;
  try {
    payloadBytes = base64UrlToBytes(payloadB64);
    sigBytes = base64UrlToBytes(sigB64);
  } catch {
    return null;
  }

  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify("HMAC", key, new Uint8Array(sigBytes), new Uint8Array(payloadBytes));
  if (!valid) return null;

  try {
    const parsed = JSON.parse(payloadBytes.toString("utf8")) as {
      tenantId?: string;
      employeeId?: string;
      timestamp?: number;
      /** Legado: states assinados antes da migração para `timestamp`. */
      exp?: number;
    };

    if (!parsed.tenantId) return null;

    if (typeof parsed.timestamp === "number") {
      const ageMs = Date.now() - parsed.timestamp;
      if (ageMs < -60_000 || ageMs > STATE_MAX_AGE_MS) return null;
    } else if (typeof parsed.exp === "number") {
      if (parsed.exp < Date.now()) return null;
    } else {
      return null;
    }

    return {
      tenantId: parsed.tenantId,
      ...(parsed.employeeId ? { employeeId: parsed.employeeId } : {}),
    };
  } catch {
    return null;
  }
}
