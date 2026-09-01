import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/20260901093000_agent_runtime_watchdog_durable_fallback.sql",
), "utf8");

describe("agent runtime watchdog durable fallback migration", () => {
  it("uses Vault HMAC and a five-minute pg_cron without public access", () => {
    expect(migration).toContain("meta_leadgen_scheduler_secret");
    expect(migration).toContain("extensions.hmac");
    expect(migration).toContain("2-57/5 * * * *");
    expect(migration).toContain("revoke all on function public.record_agent_runtime_watchdog_probe_v1");
    expect(migration).toContain("from public, anon, authenticated");
  });

  it("persists transitions and limits repeat alerts to once per hour", () => {
    expect(migration).toContain("for update");
    expect(migration).toContain("v_notification := 'failure'");
    expect(migration).toContain("v_notification := 'recovery'");
    expect(migration).toContain("v_notification := 'repeat'");
    expect(migration).toContain("interval '1 hour'");
  });
});
