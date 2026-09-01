import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/20260901004800_operational_audit_operation_state_v2.sql",
), "utf8");

describe("operational audit operation state v2", () => {
  it("uses stable resource operations without mutating the immutable ledger", () => {
    expect(migration).toContain("private.operational_audit_resource_operation_id_v1");
    expect(migration).toContain("from public.operational_audit_operations");
    expect(migration).not.toContain("delete from public.operational_audit_events");
    expect(migration).not.toContain("update public.operational_audit_events");
  });

  it("counts current operation states instead of historical transitions", () => {
    const dashboard = migration.slice(migration.indexOf("create or replace function public.get_operational_audit_dashboard_v1"));
    expect(dashboard).toContain("from public.operational_audit_operations");
    expect(dashboard).toContain("where updated_at >= p_from and updated_at < p_to");
  });

  it("checks stale watchdog and audit operations independently of export rows", () => {
    expect(migration).toContain("and module in ('admin.audit','runtime.watchdog')");
    expect(migration).toContain("as stale_exports");
  });
});
