import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ cookie: "", session: null as Record<string, unknown> | null, owner: null as Record<string, unknown> | null,
  error: null as unknown, auth: null as Record<string, unknown> | null, rate: true }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => state.cookie ? { value: state.cookie } : undefined }) }));
vi.mock("@/lib/server/admin-auth-db", () => ({ authenticateAdminFromDb: async () => state.auth }));
vi.mock("@/lib/server/operational-audit", () => ({ appendOperationalAuditEvent: vi.fn(async () => ({})) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: () => ({
  rpc: async () => ({ data: state.rate, error: state.error }),
  from: (table: string) => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === "agent_test_lab_sessions" ? state.session : state.owner, error: state.error }),
      insert: async () => ({ error: state.error }) }; return q;
  },
}) }));
import { assertLabOrigin, labHash, labSecretMatches, requireLabOwner, unlockLab } from "@/lib/server/agent-test-lab/auth";
describe("laboratory owner reauthentication", () => {
  beforeEach(() => {
    vi.stubEnv("AGENT_TEST_LAB_ENABLED", "true"); state.cookie = "A".repeat(43); state.error = null; state.rate = true; state.auth = null;
    state.session = { admin_id: "admin-renato-lagares", expires_at: new Date(Date.now() + 60000).toISOString(), password_version: null, revoked_at: null };
    state.owner = { id: "admin-renato-lagares", role: "super_admin", active: true, password_changed_at: null };
  });
  it("accepts an opaque token only after persisted owner verification", async () => expect((await requireLabOwner()).adminId).toBe("admin-renato-lagares"));
  it.each(["", "admin-renato-lagares:super_admin:123", "forged"]) ("rejects legacy or invented session %s", async cookie => {
    state.cookie = cookie; await expect(requireLabOwner()).rejects.toThrow("lab_locked");
  });
  it("fails closed if session cannot be read", async () => { state.error = new Error("db failed"); await expect(requireLabOwner()).rejects.toThrow("lab_locked"); });
  it("rejects revoked sessions", async () => { state.session!.revoked_at = new Date().toISOString(); await expect(requireLabOwner()).rejects.toThrow("lab_locked"); });
  it("rejects expired sessions", async () => { state.session!.expires_at = "2000-01-01T00:00:00Z"; await expect(requireLabOwner()).rejects.toThrow("lab_locked"); });
  it("rejects sessions belonging to another administrator", async () => { state.session!.admin_id = "another"; await expect(requireLabOwner()).rejects.toThrow("lab_locked"); });
  it("rejects deleted/suspended owners", async () => { state.owner = null; await expect(requireLabOwner()).rejects.toThrow("lab_locked"); });
  it("invalidates sessions after a password change", async () => { state.owner!.password_changed_at = new Date().toISOString(); await expect(requireLabOwner()).rejects.toThrow("lab_locked"); });
  it("rejects non-owner roles", async () => { state.owner!.role = "admin"; await expect(requireLabOwner()).rejects.toThrow("lab_locked"); });
  it("respects the kill switch", async () => { vi.stubEnv("AGENT_TEST_LAB_ENABLED", "false"); await expect(requireLabOwner()).rejects.toThrow("lab_disabled"); });
  it.each([null, "https://attacker.example", "null"]) ("rejects cross-origin mutation %s", origin => {
    expect(() => assertLabOrigin(new Request("https://www.mychatcrm.com.br/api/admin/agent-tests/runs", { method: "POST", headers: origin ? { origin } : {} }))).toThrow("lab_origin_rejected");
  });
  it("accepts the exact same origin", () => expect(() => assertLabOrigin(new Request("https://www.mychatcrm.com.br/api/admin/agent-tests/runs", { method: "POST", headers: { origin: "https://www.mychatcrm.com.br" } }))).not.toThrow());
  it("uses constant-time digest comparison, rejects malformed hashes", () => {
    expect(labSecretMatches("value", labHash("value"))).toBe(true);
    expect(labSecretMatches("other", labHash("value"))).toBe(false);
    expect(labSecretMatches("value", "not-a-hash")).toBe(false);
  });
  it("enforces durable unlock rate limit before password verification", async () => {
    state.rate = false;
    await expect(unlockLab(new Request("https://www.mychatcrm.com.br/api/admin/agent-tests/session", { method: "POST", headers: { origin: "https://www.mychatcrm.com.br", "content-type": "application/json" }, body: JSON.stringify({ email: "owner@example.test", password: "fixture" }) }))).rejects.toThrow("rate_limited");
  });
});
