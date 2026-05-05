import { describe, expect, it } from "vitest";
import { parseStripeAdminSearchParams } from "@/lib/server/admin-stripe-query";

describe("parseStripeAdminSearchParams", () => {
  it("defaults to ~30-day window when only to is set", () => {
    const q = parseStripeAdminSearchParams(
      new URLSearchParams({ to: "2026-05-05" }),
    );
    if ("error" in q) throw new Error(q.error);
    expect(q.toSec).toBeGreaterThan(q.fromSec);
  });

  it("rejects inverted range", () => {
    const q = parseStripeAdminSearchParams(
      new URLSearchParams({ from: "2026-06-01", to: "2026-05-01" }),
    );
    expect("error" in q && q.error).toBeTruthy();
  });

  it("parses limit and clamp", () => {
    const q = parseStripeAdminSearchParams(
      new URLSearchParams({
        from: "2026-05-01",
        to: "2026-05-05",
        limit: "500",
      }),
    );
    if ("error" in q) throw new Error(q.error);
    expect(q.limit).toBe(100);
  });

  it("normalized planSlug all", () => {
    const q = parseStripeAdminSearchParams(
      new URLSearchParams({ from: "2026-05-01", to: "2026-05-05", plan: "all" }),
    );
    if ("error" in q) throw new Error(q.error);
    expect(q.planSlug).toBeNull();
  });
});
