import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

/** AES-256-GCM: version(1) | iv(12) | tag(16) | ciphertext → base64 */
export function encryptOpenAiKeyForStorage(plaintext: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const out = Buffer.concat([Buffer.from([VERSION]), iv, tag, enc]);
  return out.toString("base64");
}

export function decryptOpenAiKeyFromStorage(payload: string, secret: string): string | null {
  try {
    const buf = Buffer.from(payload, "base64");
    if (buf.length < 1 + IV_LEN + TAG_LEN + 1) return null;
    if (buf[0] !== VERSION) return null;
    const iv = buf.subarray(1, 1 + IV_LEN);
    const tag = buf.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
    const data = buf.subarray(1 + IV_LEN + TAG_LEN);
    const key = deriveKey(secret);
    const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    return plain.trim() || null;
  } catch {
    return null;
  }
}
