import { describe, expect, it } from "vitest";
import { decryptOpenAiKeyFromStorage, encryptOpenAiKeyForStorage } from "@/lib/server/platform-openai-key-crypto";

describe("platform-openai-key-crypto", () => {
  const secret = "test-secret-at-least-eight";

  it("round-trips a typical OpenAI key", () => {
    const plain = "sk-test1234567890abcdefghijklmnopqrst";
    const enc = encryptOpenAiKeyForStorage(plain, secret);
    expect(enc).not.toContain(plain);
    const dec = decryptOpenAiKeyFromStorage(enc, secret);
    expect(dec).toBe(plain);
  });

  it("returns null for wrong secret", () => {
    const enc = encryptOpenAiKeyForStorage("sk-proj-aaaaaaaaaaaaaaaa", secret);
    expect(decryptOpenAiKeyFromStorage(enc, "wrong-secret-also-eight")).toBeNull();
  });

  it("returns null for tampered payload", () => {
    const enc = encryptOpenAiKeyForStorage("sk-valid-key-here-1234567890", secret);
    const buf = Buffer.from(enc, "base64");
    buf[buf.length - 1] ^= 0xff;
    expect(decryptOpenAiKeyFromStorage(buf.toString("base64"), secret)).toBeNull();
  });
});
