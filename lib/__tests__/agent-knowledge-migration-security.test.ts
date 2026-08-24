import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260824161417_agent_knowledge_retrieval_v1.sql"),
  "utf8",
);

describe("agent knowledge migration security contract", () => {
  it("keeps chunks and jobs private and service-role only", () => {
    expect(migration).toContain("alter table public.agent_knowledge_chunks enable row level security");
    expect(migration).toContain("alter table public.agent_knowledge_jobs enable row level security");
    expect(migration).toContain(
      "revoke all on table public.agent_knowledge_chunks from public, anon, authenticated",
    );
    expect(migration).toContain(
      "revoke all on table public.agent_knowledge_jobs from public, anon, authenticated",
    );
    expect(migration).not.toMatch(/grant\s+.+agent_knowledge_(chunks|jobs).+to\s+(anon|authenticated)/i);
  });

  it("guards chunk writes and retrieval by claim, version, tenant and agent", () => {
    expect(migration).toContain("create or replace function public.insert_agent_knowledge_chunks_v1");
    expect(migration).toContain("claim_token = p_claim_token");
    expect(migration).toContain("content_sha256 = p_content_sha256");
    expect(migration).toContain("p_content_sha256, '') !~ '^[a-f0-9]{64}$'");
    expect(migration).toContain("f.processing_version = c.processing_version");
    expect(migration).toContain("c.tenant_id = p_tenant_id");
    expect(migration).toContain("c.agent_id = p_agent_id");
  });

  it("has bounded retries, claim recovery and dead letter", () => {
    expect(migration).toContain("'dead_letter'");
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("claim_expires_at <= v_now");
    expect(migration).toContain("attempts >= max_attempts");
    expect(migration).toContain("v_job.attempts >= v_job.max_attempts then 'knowledge_dead_letter'");
  });

  it("queues valid legacy materials without deleting their stored content", () => {
    expect(migration).toContain("Preserve legacy materials");
    expect(migration).toContain("on conflict (file_id, processing_version) do nothing");
    expect(migration).toContain("knowledge_legacy_size_review_required");
    const legacyBlock = migration.slice(
      migration.indexOf("-- Preserve legacy materials"),
      migration.indexOf("alter table public.agent_knowledge_chunks enable row level security"),
    );
    expect(legacyBlock).not.toMatch(/delete\s+from\s+public\.agent_knowledge_files/i);
  });

  it("serializes the five-file and 200 MB reservation limits", () => {
    expect(migration).toContain("create or replace function public.reserve_agent_knowledge_file_v1");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("if v_count >= 5");
    expect(migration).toContain("v_total + p_size_bytes > 200 * 1024 * 1024");
  });
});
