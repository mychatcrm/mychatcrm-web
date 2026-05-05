import { afterEach, describe, expect, it, vi } from "vitest";
import { getPlatformOpenAiEncryptionSecret } from "@/lib/server/platform-openai-encryption-secret";

describe("getPlatformOpenAiEncryptionSecret", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers PLATFORM_OPENAI_KEY_SECRET", () => {
    vi.stubEnv("PLATFORM_OPENAI_KEY_SECRET", "platform-secret-here");
    vi.stubEnv("CLIENT_SESSION_COOKIE_SECRET", "client-secret-here");
    expect(getPlatformOpenAiEncryptionSecret()).toBe("platform-secret-here");
  });

  it("falls back to CLIENT_SESSION_COOKIE_SECRET", () => {
    vi.stubEnv("PLATFORM_OPENAI_KEY_SECRET", "");
    vi.stubEnv("CLIENT_SESSION_COOKIE_SECRET", "fallback-session-secret");
    expect(getPlatformOpenAiEncryptionSecret()).toBe("fallback-session-secret");
  });

  it("returns null when neither is usable", () => {
    vi.stubEnv("PLATFORM_OPENAI_KEY_SECRET", "short");
    vi.stubEnv("CLIENT_SESSION_COOKIE_SECRET", "tiny");
    expect(getPlatformOpenAiEncryptionSecret()).toBeNull();
  });
});
