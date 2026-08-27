import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH =
  "supabase/migrations/20260826203230_follow_up_scheduler_fidelity.sql";

describe("follow-up scheduler and journey renewal migration", () => {
  it("schedules the exact signed follow-up worker every minute without mutating cron.job", () => {
    const sql = readFileSync(join(process.cwd(), MIGRATION_PATH), "utf8");
    expect(sql).toContain("private.dispatch_follow_up_processing()");
    expect(sql).toContain("/api/internal/process-follow-ups");
    expect(sql).toContain("'mychatcrm-follow-up-minute'");
    expect(sql).toContain("'* * * * *'");
    expect(sql).toContain("cron.schedule(");
    expect(sql).toContain("cron.unschedule(jobid)");
    expect(sql).not.toMatch(/(?:insert|update|delete)\s+(?:into\s+|from\s+)?cron\.job/i);
    expect(sql).not.toMatch(/authorization|bearer/i);
  });

  it("keeps the journey touch private, tenant-bound and monotonic", () => {
    const sql = readFileSync(join(process.cwd(), MIGRATION_PATH), "utf8");
    expect(sql).toContain("touch_active_lead_journey_v2");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("j.tenant_id = p_tenant_id");
    expect(sql).toContain("j.status = 'active'");
    expect(sql).toContain("for update");
    expect(sql).toContain("greatest(");
    expect(sql).toMatch(
      /revoke all on function public\.touch_active_lead_journey_v2[\s\S]+from public, anon, authenticated/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.touch_active_lead_journey_v2[\s\S]+to service_role/i,
    );
  });

  it("keeps the per-minute path isolated from the existing aggregate fallback", () => {
    const route = readFileSync(
      join(process.cwd(), "app/api/internal/process-follow-ups/route.ts"),
      "utf8",
    );
    expect(route).toContain("followUpsOnly: true");
    expect(route).toContain("if (options?.followUpsOnly)");
    expect(route.indexOf("if (options?.followUpsOnly)")).toBeLessThan(
      route.indexOf("let metaLeadPoll"),
    );
  });
});
