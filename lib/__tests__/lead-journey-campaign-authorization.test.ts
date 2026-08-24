import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorizeActiveJourney } from "@/lib/server/lead-journeys";

type Row = Record<string, unknown>;

const TENANT_ID = "tenant-1";
const REMOTE_JID = "12125550100@s.whatsapp.net";
const CONNECTION_ID = "connection-exact";

function makeSupabase(tables: Record<string, Row[]>) {
  const build = (table: string, filters: Row): Record<string, unknown> => {
    const rows = () => (tables[table] ?? []).filter((row) =>
      Object.entries(filters).every(([key, value]) => row[key] === value),
    );
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (key: string, value: unknown) => build(table, { ...filters, [key]: value }),
      order: () => builder,
      limit: async (count: number) => ({ data: rows().slice(0, count), error: null }),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      update: () => builder,
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) =>
        resolve({ data: rows(), error: null }),
    };
    return builder;
  };
  return { from: (table: string) => build(table, {}) } as never;
}

function campaignJourney(overrides: Row = {}): Row {
  return {
    id: "journey-1",
    tenant_id: TENANT_ID,
    remote_jid: REMOTE_JID,
    phone: "12125550100",
    lead_id: "lead-1",
    agent_id: "agent-1",
    rule_id: "rule-1",
    campaign_id: "campaign-1",
    connection_id: CONNECTION_ID,
    source: "whatsapp_campaign",
    source_ref: "recipient-1",
    page_id: null,
    form_id: null,
    status: "active",
    conflict_policy: "latest_wins",
    started_at: "2026-08-24T12:00:00.000Z",
    last_activity_at: "2026-08-24T12:00:00.000Z",
    expires_at: "2099-01-01T00:00:00.000Z",
    ended_at: null,
    metadata: {},
    ...overrides,
  };
}

function healthyTables(overrides?: {
  journey?: Row;
  campaign?: Row;
  rule?: Row;
}): Record<string, Row[]> {
  return {
    lead_journeys: [overrides?.journey ?? campaignJourney()],
    tenant_agents: [{
      tenant_id: TENANT_ID,
      agent_id: "agent-1",
      active: true,
      metadata: { status: "ativo" },
    }],
    whatsapp_campaigns: [overrides?.campaign ?? {
      id: "campaign-1",
      tenant_id: TENANT_ID,
      agent_id: "agent-1",
      rule_id: "rule-1",
      connection_id: CONNECTION_ID,
      transport: "evolution",
      status: "completed",
    }],
    lead_distribution_rules: [overrides?.rule ?? {
      id: "rule-1",
      tenant_id: TENANT_ID,
      source: "whatsapp_campaign",
      active: true,
      agent_ids: ["agent-1"],
      connection_id: CONNECTION_ID,
      transport: "evolution",
    }],
  };
}

beforeEach(() => {
  process.env.OMNICHANNEL_JOURNEYS_ENABLED = "true";
});

afterEach(() => {
  delete process.env.OMNICHANNEL_JOURNEYS_ENABLED;
});

describe("campaign journey authorization", () => {
  it("authorizes only an explicit active whatsapp_campaign rule on the exact transport", async () => {
    const result = await authorizeActiveJourney({
      sb: makeSupabase(healthyTables()),
      tenantId: TENANT_ID,
      remoteJid: REMOTE_JID,
      preferredAgentId: "agent-1",
      connectionId: CONNECTION_ID,
      channel: "evolution",
    });

    expect(result).toMatchObject({ ok: true, agentId: "agent-1" });
  });

  it("blocks a legacy campaign journey without rule_id", async () => {
    const result = await authorizeActiveJourney({
      sb: makeSupabase(healthyTables({ journey: campaignJourney({ rule_id: null }) })),
      tenantId: TENANT_ID,
      remoteJid: REMOTE_JID,
      preferredAgentId: "agent-1",
      connectionId: CONNECTION_ID,
      channel: "evolution",
    });

    expect(result).toMatchObject({ ok: false, reason: "journey_missing_campaign_rule" });
  });

  it("blocks a rule from another source or transport", async () => {
    const result = await authorizeActiveJourney({
      sb: makeSupabase(healthyTables({
        rule: {
          id: "rule-1",
          tenant_id: TENANT_ID,
          source: "whatsapp_organico",
          active: true,
          agent_ids: ["agent-1"],
          connection_id: CONNECTION_ID,
          transport: "cloud_api",
        },
      })),
      tenantId: TENANT_ID,
      remoteJid: REMOTE_JID,
      preferredAgentId: "agent-1",
      connectionId: CONNECTION_ID,
      channel: "evolution",
    });

    expect(result).toMatchObject({ ok: false, reason: "journey_campaign_agent_revoked" });
  });

  it("blocks when the runtime channel differs from the campaign", async () => {
    const result = await authorizeActiveJourney({
      sb: makeSupabase(healthyTables()),
      tenantId: TENANT_ID,
      remoteJid: REMOTE_JID,
      preferredAgentId: "agent-1",
      connectionId: CONNECTION_ID,
      channel: "meta_cloud",
    });

    expect(result).toMatchObject({ ok: false, reason: "journey_campaign_agent_revoked" });
  });
});
