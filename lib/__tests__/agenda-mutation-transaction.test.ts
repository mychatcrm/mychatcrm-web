import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Renomeada para casar com a version registrada remotamente (drift do MCP
// apply_migration). O conteúdo/DDL é o mesmo — só o nome do arquivo mudou.
const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260715101446_agent_agenda_mutation_operations.sql",
);
// Migration corretiva que amplia a RPC com a checagem atômica de generation.
// Nome alinhado à version registrada remotamente (evita drift do apply_migration).
const hardeningPath = join(
  process.cwd(),
  "supabase/migrations/20260715213616_agenda_outbox_hardening.sql",
);
const fixPath = join(
  process.cwd(),
  "supabase/migrations/20260716005454_agenda_outbox_hardening_fix.sql",
);

function migration(): string {
  return readFileSync(migrationPath, "utf8");
}

function hardening(): string {
  return readFileSync(hardeningPath, "utf8");
}

function fixMigration(): string {
  return readFileSync(fixPath, "utf8");
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

describe("agenda outbox hardening migration", () => {
  it("valida a generation sob o advisory lock antes de escrever (staleness atômica)", () => {
    const sql = hardening();
    // A checagem vem depois do advisory lock e antes de qualquer INSERT/UPDATE.
    const lockIdx = sql.indexOf("pg_advisory_xact_lock");
    const staleIdx = sql.indexOf("RAISE EXCEPTION 'generation_stale'");
    const firstWriteIdx = sql.indexOf("INSERT INTO public.agenda_mutation_operations");
    expect(lockIdx).toBeGreaterThan(-1);
    expect(staleIdx).toBeGreaterThan(lockIdx);
    expect(firstWriteIdx).toBeGreaterThan(staleIdx);
    expect(sql).toContain("SELECT burst_generation, status");
    expect(sql).toContain("<> p_claimed_generation");
    expect(sql).toContain("p_job_id text DEFAULT NULL");
    expect(sql).toContain("p_claimed_generation integer DEFAULT NULL");
  });

  it("generation_stale não polui a operação como failed nem consome a chave", () => {
    const sql = hardening();
    expect(sql).toContain("IF SQLERRM = 'generation_stale' THEN");
  });

  it("claim transacional usa FOR UPDATE SKIP LOCKED e é privado ao service_role", () => {
    const sql = hardening();
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain("claim_token = v_token");
    expect(sql).toContain("status = 'processing'");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.claim_agenda_notifications(integer, integer) TO service_role");
    expect(sql).toContain("FROM PUBLIC, anon, authenticated");
  });

  it("adiciona índice na FK agenda_event_id e amplia o CHECK de status", () => {
    const sql = hardening();
    expect(sql).toContain("agenda_notification_outbox_agenda_event_id_idx");
    expect(sql).toContain("'pending', 'processing', 'sent', 'delivered', 'failed', 'skipped'");
  });
});

describe("agenda outbox hardening fix migration", () => {
  it("substitui p_job_id text por uuid + journey com all-or-none e FOR UPDATE", () => {
    const sql = fixMigration();
    expect(sql).toContain("p_job_id uuid DEFAULT NULL");
    expect(sql).toContain("p_journey_id uuid DEFAULT NULL");
    expect(sql).toContain("invalid_job_params");
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("v_job_tenant IS DISTINCT FROM p_tenant_id");
    expect(sql).toContain("IF SQLERRM IN ('generation_stale', 'invalid_job_params') THEN");
    expect(sql).not.toContain("p_job_id text DEFAULT NULL");
  });

  it("cria RPC de reconcile paginado com anti-join e grants service_role", () => {
    const sql = fixMigration();
    expect(sql).toContain("list_missing_agenda_notification_ops");
    expect(sql).toContain("NOT EXISTS");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.list_missing_agenda_notification_ops");
    expect(sql).toContain("TO service_role");
  });
});
