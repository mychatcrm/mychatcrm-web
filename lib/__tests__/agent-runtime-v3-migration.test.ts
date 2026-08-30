import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260828211014_agent_universal_runtime_v3.sql"),
  "utf8",
);
const reminderRuntime = readFileSync(
  join(process.cwd(), "lib/server/agenda-reminder-jobs.ts"),
  "utf8",
);
const agentUpdateRoute = readFileSync(
  join(process.cwd(), "app/api/client/agentes/[id]/route.ts"),
  "utf8",
);
const runtimeIndexesMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260829110000_agent_runtime_v3_fk_indexes.sql"),
  "utf8",
);
const runtimeMonitorMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260830100000_agent_runtime_monitor_due_at.sql"),
  "utf8",
);

describe("agent universal runtime v3 migration", () => {
  it("creates additive service-only reminders with exact authorization identity", () => {
    expect(migration).toContain("create table if not exists public.agenda_reminder_jobs_v2");
    expect(migration).toContain("automation_epoch bigint not null");
    expect(migration).toContain("config_version bigint not null");
    expect(migration).toContain("operation_key text not null");
    expect(migration).toContain("unique (tenant_id, operation_key)");
    expect(migration).toContain("alter table public.agenda_reminder_jobs_v2 enable row level security");
    expect(migration).toMatch(
      /revoke all on table public\.agenda_reminder_jobs_v2 from public,\s*anon,\s*authenticated/,
    );
  });

  it("cancels pending automation when human, event or configuration state changes", () => {
    expect(migration).toContain("conversation_cancel_reminders_v2");
    expect(migration).toContain("agenda_event_cancel_reminders_v2");
    expect(migration).toContain("tenant_agent_cancel_reminders_v2");
    expect(migration).toContain("follow_up_configuration_changed");
    expect(migration).toContain("follow_up_v3_activation_no_retroactive_send");
    expect(migration).toContain("agenda_reminder_config_version");
    expect(migration).toContain("tenant_agent_bump_reminder_config_v2");
  });

  it("uses isolated schedulers and a durable Evolution inbox", () => {
    expect(migration).toContain("create table if not exists public.evolution_webhook_inbox");
    expect(migration).toContain("claim_evolution_webhook_inbox_v1");
    expect(migration).toContain("mychatcrm-agenda-reminders-minute");
    expect(migration).toContain("mychatcrm-evolution-inbox-minute");
    expect(migration).toContain("mychatcrm-agent-runtime-monitor-minute");
  });

  it("revokes browser execution of all private runtime functions", () => {
    for (const functionName of [
      "cancel_reminders_on_conversation_control_v2",
      "cancel_reminders_on_event_v2",
      "cancel_reminders_on_agent_config_v2",
      "bump_agenda_reminder_config_version_v2",
      "monitor_agent_runtime_v3",
      "dispatch_agent_runtime_queue",
    ]) {
      expect(migration).toMatch(
        new RegExp(`revoke all on function private\\.${functionName}\\([^;]*from public,anon,authenticated`),
      );
    }
  });

  it("alerts on scheduler failures and follow-up backlog", () => {
    expect(migration).toContain("agent_runtime_scheduler_failure");
    expect(migration).toContain("follow_up_backlog");
    expect(migration).toContain("config_missing");
    expect(migration).toContain("request_failed");
  });

  it("rebuilds only V2-eligible future reminders without repeating sent indexes", () => {
    expect(reminderRuntime).toContain("reconcileAgendaRemindersAfterConfigChange");
    expect(reminderRuntime).toContain('.from("agenda_reminder_jobs_v2")');
    expect(reminderRuntime).toContain('.eq("status", "confirmed")');
    expect(reminderRuntime).toContain('.gt("start_at", new Date().toISOString())');
    expect(reminderRuntime).toContain('row.status === "sent"');
    expect(reminderRuntime).toContain("skipReminderIndexes: sentIndexes");
    expect(reminderRuntime).toContain("agenda_reminder_config_version");
    expect(agentUpdateRoute).toContain("reconcileAgendaRemindersAfterConfigChange");
  });

  it("covers runtime foreign keys used by cancellation and reconciliation", () => {
    for (const indexName of [
      "agenda_reminder_jobs_v2_agenda_event_fk_idx",
      "agenda_reminder_jobs_v2_journey_fk_idx",
      "agenda_reminder_jobs_v2_lead_fk_idx",
      "agenda_reminder_jobs_v2_outbox_fk_idx",
      "agenda_reminder_jobs_v2_rule_fk_idx",
      "follow_up_jobs_journey_fk_idx",
      "follow_up_jobs_rule_fk_idx",
      "follow_up_jobs_source_response_fk_idx",
    ]) {
      expect(runtimeIndexesMigration).toContain(indexName);
    }
  });

  it("monitors only overdue follow-ups and resolves recovered alerts", () => {
    expect(runtimeMonitorMigration).toContain("scheduled_at<now()-interval '5 minutes'");
    expect(runtimeMonitorMigration).toContain("set_agent_runtime_queue_alert_v3");
    expect(runtimeMonitorMigration).toContain("set status='resolved'");
    expect(runtimeMonitorMigration).toContain("select private.monitor_agent_runtime_v3()");
  });
});
