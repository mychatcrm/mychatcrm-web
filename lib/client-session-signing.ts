import type { ClientSession } from "@/lib/client-auth";
import { isVercelProduction } from "@/lib/demo-password-auth";

const COOKIE_PREFIX = "mc1";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function resolveSigningSecret(): string | null {
  const env = process.env.CLIENT_SESSION_COOKIE_SECRET?.trim();
  if (env) return env;
  if (isVercelProduction()) return null;
  return "dev-mychatcrm-client-session-secret-change-in-production";
}

function utf8BytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const pad = b64url.length % 4 === 0 ? "" : "=".repeat(4 - (b64url.length % 4));
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** Cookie auto-contido (Edge-safe): o middleware não partilha memória com rotas Node. */
export async function signClientSessionCookie(session: ClientSession): Promise<string> {
  const secret = resolveSigningSecret();
  if (!secret) {
    throw new Error("CLIENT_SESSION_COOKIE_SECRET ausente: obrigatório em produção na Vercel.");
  }
  const withIssued: ClientSession = { ...session, issuedAt: session.issuedAt ?? Date.now() };
  const payload = JSON.stringify(withIssued);
  const enc = new TextEncoder();
  const payloadBytes = enc.encode(payload);
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, payloadBytes);
  const payloadB64 = utf8BytesToBase64Url(payloadBytes);
  const sigB64 = utf8BytesToBase64Url(new Uint8Array(sig));
  return `${COOKIE_PREFIX}.${payloadB64}.${sigB64}`;
}

export async function verifyClientSessionCookie(value: string): Promise<ClientSession | null> {
  const secret = resolveSigningSecret();
  if (!secret) return null;
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== COOKIE_PREFIX) return null;
  const [, payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;
  let payloadBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    payloadBytes = base64UrlToBytes(payloadB64);
    sigBytes = base64UrlToBytes(sigB64);
  } catch {
    return null;
  }
  const key = await hmacKey(secret);
  const sigCopy = Uint8Array.from(sigBytes);
  const payloadCopy = Uint8Array.from(payloadBytes);
  const ok = await crypto.subtle.verify("HMAC", key, sigCopy, payloadCopy);
  if (!ok) return null;
  try {
    const payload = new TextDecoder().decode(payloadBytes);
    const parsed = JSON.parse(payload) as ClientSession & { issuedAt?: number };
    if (!parsed?.token || !parsed?.tenantId || !parsed?.email) return null;
    if (typeof parsed.issuedAt === "number" && Date.now() - parsed.issuedAt > WEEK_MS) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
