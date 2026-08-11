import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260811160353_crm_lead_card_order.sql"),
  "utf8",
).toLowerCase();

describe("migração da ordem durável dos cards do CRM", () => {
  it("cria posição, backfill, índice e movimento transacional", () => {
    expect(migration).toContain("add column if not exists crm_position numeric");
    expect(migration).toContain("row_number() over");
    expect(migration).toContain("leads_tenant_funnel_status_position_idx");
    expect(migration).toContain("move_crm_lead_card_v1");
    expect(migration).toContain("pg_advisory_xact_lock");
  });

  it("mantém o marcador agent_crm_column_id fora do movimento manual", () => {
    const rpcBody = migration.split("create or replace function public.move_crm_lead_card_v1")[1] ?? "";
    expect(rpcBody).not.toContain("agent_crm_column_id =");
  });

  it("expõe a RPC somente ao service_role", () => {
    expect(migration).toContain(
      "revoke all on function public.move_crm_lead_card_v1(text, uuid, text, text, uuid, uuid) from public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.move_crm_lead_card_v1(text, uuid, text, text, uuid, uuid) to service_role",
    );
    expect(migration).toContain("security invoker");
    expect(migration).toContain("set search_path = ''");
  });
});
