import { describe, expect, it } from "vitest";
import { checkAdminIaRateLimit } from "@/lib/admin-ai-rate-limit";
import type { AdminSession } from "@/lib/admin-auth";

const session = {
  token: "t",
  adminId: "admin-test-1",
  email: "a@b.c",
  displayName: "A",
  initials: "A",
  role: "super_admin" as const,
  roleLabel: "super_admin",
};

describe("checkAdminIaRateLimit", () => {
  it("allows bursts under the cap", () => {
    const route = `probe-${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      expect(checkAdminIaRateLimit(session as AdminSession, route, 5, 60_000).ok).toBe(true);
    }
    const blocked = checkAdminIaRateLimit(session as AdminSession, route, 5, 60_000);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.retryAfterSec).toBeGreaterThan(0);
    }
  });
});
