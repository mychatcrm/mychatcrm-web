import "server-only";

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PAYLOAD_VERSION = 1;

function encryptionSecret(): string {
  const value = process.env.EXTERNAL_API_CREDENTIALS_SECRET?.trim();
  if (!value || value.length < 32) {
    throw new Error("external_api_credentials_secret_missing");
  }
  return value;
}

function keyFromSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptExternalApiCredential(credential: Record<string, string>): {
  ciphertext: string;
  fingerprint: string;
  keyVersion: 1;
} {
  const secret = encryptionSecret();
  const plaintext = JSON.stringify(credential);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyFromSecret(secret), iv, { authTagLength: TAG_BYTES });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([Buffer.from([PAYLOAD_VERSION]), iv, tag, encrypted]).toString("base64");
  return {
    ciphertext: payload,
    fingerprint: createHmac("sha256", secret).update(plaintext, "utf8").digest("hex"),
    keyVersion: 1,
  };
}

export function decryptExternalApiCredential(ciphertext: string): Record<string, string> | null {
  try {
    const secret = encryptionSecret();
    const payload = Buffer.from(ciphertext, "base64");
    if (payload.length <= 1 + IV_BYTES + TAG_BYTES || payload[0] !== PAYLOAD_VERSION) return null;
    const iv = payload.subarray(1, 1 + IV_BYTES);
    const tag = payload.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
    const data = payload.subarray(1 + IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, keyFromSecret(secret), iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    const decoded = JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8")) as unknown;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return null;
    const safe: Record<string, string> = {};
    for (const [key, value] of Object.entries(decoded as Record<string, unknown>)) {
      if (typeof value === "string") safe[key] = value;
    }
    return safe;
  } catch {
    return null;
  }
}

export function maskExternalApiCredential(fingerprint: string | null): string | null {
  return fingerprint ? `••••${fingerprint.slice(-4)}` : null;
}
