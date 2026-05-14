import "server-only";

const STATE_PREFIX = "gcal1";
const STATE_TTL_MS = 15 * 60 * 1000;

function resolveSigningSecret(): string | null {
  return process.env.CLIENT_SESSION_COOKIE_SECRET?.trim() || null;
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

export async function signGoogleOAuthState(tenantId: string): Promise<string | null> {
  const secret = resolveSigningSecret();
  if (!secret) return null;
  const payload = JSON.stringify({ tenantId, exp: Date.now() + STATE_TTL_MS });
  const payloadBytes = new TextEncoder().encode(payload);
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, payloadBytes);
  return `${STATE_PREFIX}.${utf8BytesToBase64Url(payloadBytes)}.${utf8BytesToBase64Url(new Uint8Array(sig))}`;
}

export async function verifyGoogleOAuthState(state: string): Promise<string | null> {
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
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    new Uint8Array(sigBytes),
    new Uint8Array(payloadBytes),
  );
  if (!valid) return null;
  try {
    const parsed = JSON.parse(payloadBytes.toString("utf8")) as { tenantId?: string; exp?: number };
    if (!parsed.tenantId || typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    return parsed.tenantId;
  } catch {
    return null;
  }
}
