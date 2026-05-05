/**
 * Tests for the password-reset service.
 *
 * Strategy: mock createSupabaseServiceClient and sendTransactionalEmail so no
 * real network calls are made. This keeps tests fast and deterministic.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock("@/lib/server/resend-mail", () => ({
  sendTransactionalEmail: vi.fn(),
}));

// NEXT_PUBLIC_SITE_URL must be defined before importing constants/password-reset
vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://mychatcrm.com.br");
vi.stubEnv("RESEND_API_KEY", "re_test_key");
vi.stubEnv("RESEND_FROM_EMAIL", "no-reply@mychatcrm.com.br");

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { sendTransactionalEmail } from "@/lib/server/resend-mail";
import { requestPasswordReset, completePasswordReset } from "@/lib/server/password-reset";

const mockRpc = vi.fn();
const mockFrom = vi.fn();

function makeSbClient(rpcOverride?: ReturnType<typeof vi.fn>) {
  const rpc = rpcOverride ?? mockRpc;
  return {
    rpc,
    from: mockFrom,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createSupabaseServiceClient).mockReturnValue(makeSbClient() as never);
});

// ── requestPasswordReset ───────────────────────────────────────────────────

describe("requestPasswordReset", () => {
  it("returns sent=false for invalid email format", async () => {
    const result = await requestPasswordReset({ emailRaw: "not-an-email", scope: "member" });
    expect(result.sent).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("returns sent=false silently when account not found (anti-enumeration)", async () => {
    mockRpc.mockResolvedValueOnce({ data: { found: false }, error: null });
    const result = await requestPasswordReset({ emailRaw: "unknown@example.com", scope: "member" });
    expect(result.sent).toBe(false);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("sends email and returns sent=true for an existing account", async () => {
    mockRpc.mockResolvedValueOnce({ data: { found: true }, error: null });
    vi.mocked(sendTransactionalEmail).mockResolvedValueOnce({ ok: true });

    const result = await requestPasswordReset({ emailRaw: "user@example.com", scope: "member" });
    expect(result.sent).toBe(true);
    expect(sendTransactionalEmail).toHaveBeenCalledOnce();

    const call = vi.mocked(sendTransactionalEmail).mock.calls[0][0];
    expect(call.to).toBe("user@example.com");
    expect(call.html).toContain("/reset-password?token=");
  });

  it("rolls back token and returns sent=false when Resend fails", async () => {
    mockRpc.mockResolvedValueOnce({ data: { found: true }, error: null });
    vi.mocked(sendTransactionalEmail).mockResolvedValueOnce({
      ok: false,
      code: "http_error",
      detail: "500",
    });

    // from("password_reset_tokens").delete().eq("token_hash", ...)
    const mockDelete = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({}) });
    mockFrom.mockReturnValue({ delete: mockDelete });

    const result = await requestPasswordReset({ emailRaw: "user@example.com", scope: "member" });
    expect(result.sent).toBe(false);
    expect(mockFrom).toHaveBeenCalledWith("password_reset_tokens");
  });

  it("returns mailConfigured=false when RESEND_API_KEY is missing", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    // RPC finds user; but Resend has no key → sendTransactionalEmail returns missing_key
    mockRpc.mockResolvedValueOnce({ data: { found: true }, error: null });
    vi.mocked(sendTransactionalEmail).mockResolvedValueOnce({ ok: false, code: "missing_key" });
    const mockDelete = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({}) });
    mockFrom.mockReturnValue({ delete: mockDelete });

    const result = await requestPasswordReset({ emailRaw: "user@example.com", scope: "member" });
    expect(result.mailConfigured).toBe(false);
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
  });

  it("returns sent=false when RPC throws", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "connection refused" } });
    const result = await requestPasswordReset({ emailRaw: "user@example.com", scope: "member" });
    expect(result.sent).toBe(false);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });
});

// ── completePasswordReset ──────────────────────────────────────────────────

describe("completePasswordReset", () => {
  it("returns invalid_token for an empty/short token", async () => {
    const r = await completePasswordReset({ rawToken: "", newPassword: "ValidPass1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_token");
  });

  it("returns weak_password for passwords shorter than 8 chars", async () => {
    const r = await completePasswordReset({ rawToken: "a".repeat(64), newPassword: "abc" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("weak_password");
  });

  it("returns ok when RPC succeeds", async () => {
    mockRpc.mockResolvedValueOnce({ data: { code: "ok" }, error: null });
    const r = await completePasswordReset({ rawToken: "a".repeat(64), newPassword: "ValidPass1" });
    expect(r.ok).toBe(true);
  });

  it("returns expired when RPC returns expired", async () => {
    mockRpc.mockResolvedValueOnce({ data: { code: "expired" }, error: null });
    const r = await completePasswordReset({ rawToken: "a".repeat(64), newPassword: "ValidPass1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("expired");
  });

  it("returns already_used when RPC returns already_used", async () => {
    mockRpc.mockResolvedValueOnce({ data: { code: "already_used" }, error: null });
    const r = await completePasswordReset({ rawToken: "a".repeat(64), newPassword: "ValidPass1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("already_used");
  });

  it("returns invalid_token when RPC returns invalid_token", async () => {
    mockRpc.mockResolvedValueOnce({ data: { code: "invalid_token" }, error: null });
    const r = await completePasswordReset({ rawToken: "a".repeat(64), newPassword: "ValidPass1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_token");
  });

  it("returns db_error when RPC call itself fails", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "connection refused" } });
    const r = await completePasswordReset({ rawToken: "a".repeat(64), newPassword: "ValidPass1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("db_error");
  });
});
