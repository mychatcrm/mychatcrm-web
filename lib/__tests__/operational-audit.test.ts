import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sanitizeOperationalAuditValue } from "@/lib/server/operational-audit";

describe("operational audit sanitization", () => {
  it("redacts secrets and private contents recursively", () => {
    expect(sanitizeOperationalAuditValue({
      token: "secret", apiKey: "secret", nested: { message: "private", ok: true },
      action: "lead.created", duration_ms: 42,
    })).toEqual({
      token: "[redacted]", apiKey: "[redacted]",
      nested: { message: "[redacted]", ok: true },
      action: "lead.created", duration_ms: 42,
    });
  });

  it("masks email and phone-like metadata even under a neutral key", () => {
    expect(sanitizeOperationalAuditValue({ value: "owner@example.com", other: "+5511999999999" }))
      .toEqual({ value: "ow***@ex***", other: "+55***99" });
  });

  it("bounds arrays, depth and text size", () => {
    const value = sanitizeOperationalAuditValue({
      items: Array.from({ length: 100 }, (_, index) => index),
      deep: { a: { b: { c: { d: "hidden" } } } },
      text: "x".repeat(1_000),
    }) as Record<string, unknown>;
    expect(value.items).toHaveLength(25);
    expect(JSON.stringify(value.deep)).toContain("depth_limited");
    expect(String(value.text)).toHaveLength(500);
  });
});

describe("operational audit trace isolation", () => {
  const migration = readFileSync(
    "supabase/migrations/20260831140259_operational_audit_v1.sql",
    "utf8",
  );

  it("never uses tenant, agent, rule or connection as a trace identity", () => {
    const resolver = migration.slice(
      migration.indexOf("create or replace function public.resolve_operational_trace_v1"),
      migration.indexOf("create or replace function public.refresh_operational_audit_operation_v1"),
    );
    expect(resolver).not.toContain("'tenant_id'");
    expect(resolver).not.toContain("'agent_id'");
    expect(resolver).not.toContain("'rule_id'");
    expect(resolver).not.toContain("'connection_id'");
  });

  it("maps durable table primary keys to semantic trace identities", () => {
    expect(migration).toContain("when tg_table_name = 'leads' then 'lead_id'");
    expect(migration).toContain("when tg_table_name = 'lead_journeys' then 'journey_id'");
    expect(migration).toContain("when tg_table_name = 'whatsapp_messages' then 'message_id'");
    expect(migration).toContain("when tg_table_name = 'agenda_events' then 'agenda_event_id'");
    expect(migration).toContain("when tg_table_name = 'evolution_webhook_inbox' then 'evolution_inbox_id'");
  });

  it("archives before retention and never deletes audit history automatically", () => {
    const retention = readFileSync("lib/server/operational-audit-retention.ts", "utf8");
    expect(retention).toContain('const ARCHIVE_BUCKET = "operational-audit-archives"');
    expect(retention).toContain('createHash("sha256")');
    expect(retention).toContain("audit_archive_checksum_mismatch");
    expect(retention).not.toMatch(/\.delete\s*\(/);
    expect(migration).not.toContain("delete from public.operational_audit_events");
  });
});
