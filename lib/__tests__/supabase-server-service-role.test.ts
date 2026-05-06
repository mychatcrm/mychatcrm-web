import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("createSupabaseServiceClient JWT role check", () => {
  const snapshot = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...snapshot };
  });

  it("throws when SUPABASE_SERVICE_ROLE_KEY is an anon-shaped JWT", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url");
    process.env.SUPABASE_SERVICE_ROLE_KEY = `${header}.${payload}.sig`;
    const { createSupabaseServiceClient } = await import("@/lib/supabase/server");
    expect(() => createSupabaseServiceClient()).toThrow(/role "anon"/);
  });

  it("does not throw when JWT role is service_role", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
    process.env.SUPABASE_SERVICE_ROLE_KEY = `${header}.${payload}.sig`;
    const { createSupabaseServiceClient } = await import("@/lib/supabase/server");
    expect(() => createSupabaseServiceClient()).not.toThrow();
  });
});
