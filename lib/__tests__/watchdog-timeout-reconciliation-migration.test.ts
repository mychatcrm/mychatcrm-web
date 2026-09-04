import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/20260904204934_fix_admin_clients_and_watchdog_reconciliation.sql",
), "utf8");

describe("watchdog timeout reconciliation", () => {
  it("terminalizes only abandoned watchdog starts idempotently", () => {
    expect(migration).toContain("private.reconcile_stale_watchdog_operations_v1()");
    expect(migration).toContain("operation.module = 'runtime.watchdog'");
    expect(migration).toContain("operation.action = 'check.started'");
    expect(migration).toContain("operation.status = 'running'");
    expect(migration).toContain("operation.updated_at < now() - interval '10 minutes'");
    expect(migration).toContain("'watchdog-timeout:' || operation.operation_id::text");
  });

  it("runs reconciliation before each durable watchdog dispatch", () => {
    expect(migration).toContain("private.run_agent_runtime_watchdog_v2()");
    expect(migration).toContain("perform private.reconcile_stale_watchdog_operations_v1()");
    expect(migration).toContain("return private.dispatch_agent_runtime_watchdog_tick_v1()");
    expect(migration).toContain("timeout_milliseconds := 25000");
  });

  it("keeps privileged functions unavailable to browser roles", () => {
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role");
  });
});
