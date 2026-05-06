import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function jwtWithRole(role: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ role })).toString("base64url");
  return `${header}.${payload}.sig`;
}

describe("createSupabaseServiceClient backend secret validation", () => {
  const snapshot = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...snapshot };
  });

  it("throws when SUPABASE_SERVICE_ROLE_KEY is an anon-shaped JWT", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = jwtWithRole("anon");
    const { createSupabaseServiceClient } = await import("@/lib/supabase/server");
    expect(() => createSupabaseServiceClient()).toThrow(/service_role/);
  });

  it("does not throw when JWT role is service_role", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = jwtWithRole("service_role");
    const { createSupabaseServiceClient } = await import("@/lib/supabase/server");
    expect(() => createSupabaseServiceClient()).not.toThrow();
  });

  it("accepts sb_secret_* (opaque Supabase secret) without JWT parsing", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_integration_test_placeholder";
    const { createSupabaseServiceClient } = await import("@/lib/supabase/server");
    expect(() => createSupabaseServiceClient()).not.toThrow();
  });

  it("throws on arbitrary non-JWT string that is not sb_secret_", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "not-a-valid-service-format";
    const { createSupabaseServiceClient } = await import("@/lib/supabase/server");
    expect(() => createSupabaseServiceClient()).toThrow(/inválida/);
  });

  it("throws when service key equals anon key (swapped copy-paste)", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    const same = jwtWithRole("service_role");
    process.env.SUPABASE_SERVICE_ROLE_KEY = same;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = same;
    const { createSupabaseServiceClient } = await import("@/lib/supabase/server");
    expect(() => createSupabaseServiceClient()).toThrow(/não pode ser igual/);
  });

  it("throws when JWT payload is not decodable (no silent bypass)", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "aaa.bbb.ccc";
    const { createSupabaseServiceClient } = await import("@/lib/supabase/server");
    expect(() => createSupabaseServiceClient()).toThrow(/ilegível/);
  });
});

describe("createSupabaseAnonClient public key validation", () => {
  const snapshot = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...snapshot };
  });

  it("throws when anon slot contains service_role JWT", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = jwtWithRole("service_role");
    const { createSupabaseAnonClient } = await import("@/lib/supabase/server");
    expect(() => createSupabaseAnonClient()).toThrow(/trocadas/);
  });

  it("throws when anon slot contains sb_secret_", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "sb_secret_should_not_be_here";
    const { createSupabaseAnonClient } = await import("@/lib/supabase/server");
    expect(() => createSupabaseAnonClient()).toThrow(/sb_secret_/);
  });

  it("does not throw with standard anon JWT", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = jwtWithRole("anon");
    const { createSupabaseAnonClient } = await import("@/lib/supabase/server");
    expect(() => createSupabaseAnonClient()).not.toThrow();
  });
});
