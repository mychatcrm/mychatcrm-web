import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveLeadQuotaCycle } from "@/lib/server/lead-quota";

describe("lead quota cycles", () => {
  it("resolves complete UTC calendar months", () => {
    expect(resolveLeadQuotaCycle("monthly", new Date("2026-02-12T15:00:00.000Z"))).toEqual({
      cycleStart: "2026-02-01",
      cycleEnd: "2026-02-28",
    });
  });

  it("resolves complete UTC calendar years", () => {
    expect(resolveLeadQuotaCycle("annual", new Date("2026-07-10T10:00:00.000Z"))).toEqual({
      cycleStart: "2026-01-01",
      cycleEnd: "2026-12-31",
    });
  });

  it("keeps quota mutations locked, idempotent and service-role only", () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260709220409_omnichannel_entitlements_and_lead_quota.sql",
      ),
      "utf8",
    );

    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("unique (tenant_id, idempotency_key)");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on function public.reserve_tenant_lead_quota");
    expect(migration).toContain("to service_role");
  });
});
