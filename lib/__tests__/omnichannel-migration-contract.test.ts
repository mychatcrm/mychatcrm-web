import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260702011138_omnichannel_lead_journeys_campaigns.sql",
  ),
  "utf8",
);

describe("omnichannel migration contract", () => {
  it("creates isolated journeys and ties all automatic context tables to journey_id", () => {
    expect(migration).toContain("create table if not exists public.lead_journeys");
    expect(migration).toContain("alter table public.whatsapp_messages");
    expect(migration).toContain("alter table public.conversation_summaries");
    expect(migration).toContain("alter table public.agent_response_jobs");
    expect(migration).toContain("alter table public.follow_up_jobs");
    expect(migration).toContain("active_journey_id");
  });

  it("keeps transport separate and creates durable campaign and redistribution queues", () => {
    expect(migration).toContain("add column if not exists transport text");
    expect(migration).toContain("create table if not exists public.whatsapp_campaigns");
    expect(migration).toContain("create table if not exists public.whatsapp_campaign_recipients");
    expect(migration).toContain("create table if not exists public.lead_redistribution_jobs");
  });

  it("enables RLS and restricts new operational tables to the service role", () => {
    for (const table of [
      "whatsapp_campaigns",
      "lead_journeys",
      "whatsapp_campaign_recipients",
      "lead_redistribution_jobs",
    ]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`revoke all on table public.${table} from anon, authenticated`);
    }
  });
});
