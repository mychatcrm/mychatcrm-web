import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260721104645_omnichannel_agent_authorization_v2.sql",
  ),
  "utf8",
);

describe("omnichannel authorization v2 migration", () => {
  it("serializes takeover and dispatch with a shared conversation lock", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.set_conversation_operation_v2");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.authorize_agent_outbound_dispatch_v2");
    expect(migration.match(/'agent-conversation:' \|\|/g)?.length).toBeGreaterThanOrEqual(3);
    expect(migration).toContain("automation_epoch = conversation_states.automation_epoch + 1");
    expect(migration).toContain("automation_epoch_stale");
  });

  it("fails closed for missing, expired or cross-connection journeys", () => {
    expect(migration).toContain("journey_missing");
    expect(migration).toContain("journey_expired");
    expect(migration).toContain("journey_connection_mismatch");
    expect(migration).toContain("rule_scope_mismatch");
  });

  it("cancels only pending agenda actions and preserves executed operations", () => {
    expect(migration).toContain("AND state = 'pending'");
    expect(migration).toContain("AND a.state = 'executed'");
    expect(migration).toContain("Agendamento concluído pela IA antes da transferência");
    expect(migration).toContain("SELECT public.apply_agent_agenda_mutation(");
  });

  it("keeps authorization RPCs private to service_role", () => {
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.authorize_agent_outbound_dispatch_v2(uuid,uuid,bigint)",
    );
    expect(migration).toContain("TO service_role;");
    expect(migration).toContain("agent_outbound_authorization_events");
  });
});
