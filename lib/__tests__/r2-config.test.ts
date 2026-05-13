import { afterEach, describe, expect, it, vi } from "vitest";
import { getR2ConfigurationError } from "@/lib/integrations/r2-storage";

describe("R2 configuration errors", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports missing R2_ACCESS_KEY_ID clearly", () => {
    vi.stubEnv("R2_ENDPOINT", "https://account.r2.cloudflarestorage.com");
    vi.stubEnv("R2_ACCESS_KEY_ID", "");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret");
    vi.stubEnv("R2_BUCKET", "mychatcrm-media");

    expect(getR2ConfigurationError()).toContain("R2_ACCESS_KEY_ID");
  });

  it("returns null when all required env vars are present", () => {
    vi.stubEnv("R2_ENDPOINT", "https://account.r2.cloudflarestorage.com");
    vi.stubEnv("R2_ACCESS_KEY_ID", "key");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret");
    vi.stubEnv("R2_BUCKET", "mychatcrm-media");

    expect(getR2ConfigurationError()).toBeNull();
  });
});
