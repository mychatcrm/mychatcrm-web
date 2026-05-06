import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyBackendSupabaseCredential } from "@/lib/server/supabase-admin-runtime";

describe("classifyBackendSupabaseCredential", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns missing when env absent", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(classifyBackendSupabaseCredential()).toBe("missing");
  });

  it("returns opaque_secret for sb_secret keys", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_123456");
    expect(classifyBackendSupabaseCredential()).toBe("opaque_secret");
  });

  it("returns non_jwt for unknown non-jwt format", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "not-a-jwt");
    expect(classifyBackendSupabaseCredential()).toBe("non_jwt");
  });

  it("returns non_service_role for anon-shaped jwt", () => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", `${header}.${payload}.sig`);
    expect(classifyBackendSupabaseCredential()).toBe("non_service_role");
  });

  it("returns service_role for service_role jwt", () => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", `${header}.${payload}.sig`);
    expect(classifyBackendSupabaseCredential()).toBe("service_role");
  });
});
