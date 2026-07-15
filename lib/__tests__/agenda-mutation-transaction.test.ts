import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260715011409_agent_agenda_mutation_operations.sql",
);

function migration(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("transactional agenda mutations", () => {
  it("deduplicates one operation inside a tenant", () => {
    const sql = migration();

    expect(sql).toContain("UNIQUE (tenant_id, operation_key)");
    expect(sql).toContain("ON CONFLICT (tenant_id, operation_key)");
    expect(sql).toContain("'deduplicated', true");
  });

  it("serializes availability checks and writes per tenant", () => {
    const sql = migration();

    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("'agent-agenda:' || p_tenant_id");
    expect(sql).toContain("candidate.tenant_id = p_tenant_id");
    expect(sql).toContain("candidate.start_at < p_end_at");
    expect(sql).toContain("candidate.end_at > p_start_at");
  });

  it("keeps cancellation and event lookup tenant and contact safe", () => {
    const sql = migration();

    expect(sql).toContain("tenant_id = p_tenant_id");
    expect(sql).toContain("attendee_phone = p_attendee_phone");
    expect(sql).toContain("agenda_event_contact_mismatch");
  });

  it("keeps the operation ledger private to the service role", () => {
    const sql = migration();

    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON TABLE public.agenda_mutation_operations FROM anon, authenticated");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.apply_agent_agenda_mutation");
    expect(sql).toContain("TO service_role");
  });
});
