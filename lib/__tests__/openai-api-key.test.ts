import { afterEach, describe, expect, it, vi } from "vitest";
import {
  invalidateOpenAiApiKeyCache,
  peekOpenAiApiKeyFromEnv,
} from "@/lib/ai/openai-api-key";

describe("openai-api-key (env)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    invalidateOpenAiApiKeyCache();
  });

  it("peekOpenAiApiKeyFromEnv returns trimmed key when set", () => {
    vi.stubEnv("OPENAI_API_KEY", "  sk-test-from-env-1234567890  ");
    expect(peekOpenAiApiKeyFromEnv()).toBe("sk-test-from-env-1234567890");
  });

  it("peekOpenAiApiKeyFromEnv returns null when unset", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(peekOpenAiApiKeyFromEnv()).toBeNull();
  });
});
