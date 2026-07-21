import { beforeEach, describe, expect, it, vi } from "vitest";

const { metaAuthorizationMock } = vi.hoisted(() => ({
  metaAuthorizationMock: vi.fn(),
}));

vi.mock("@/lib/server/meta-form-authorization", () => ({
  isAgentExplicitlyAuthorizedForMetaForm: metaAuthorizationMock,
  stringArray: (value: unknown) => (Array.isArray(value) ? value : []),
}));

import { authorizeActiveJourney } from "@/lib/server/lead-journeys";

type Row = Record<string, unknown>;

function makeQuery(rows: Row[], filters: Row = {}) {
  const filtered = () => rows.filter((row) =>
    Object.entries(filters).every(([key, value]) => row[key] === value));
  const builder = {
    select: () => builder,
    eq: (key: string, value: unknown) => makeQuery(rows, { ...filters, [key]: value }),
    order: () => builder,
    limit: async (count: number) => ({ data: filtered().slice(0, count), error: null }),
    maybeSingle: async () => ({ data: filtered()[0] ?? null, error: null }),
  };
  return builder;
}

function makeSupabase(metadata: Record<string, unknown>) {
  const journey = {
    id: "journey-1",
    tenant_id: "tenant-1",
    remote_jid: "5562999999999@s.whatsapp.net",
    phone: "5562999999999",
    lead_id: "lead-1",
    agent_id: "agent-1",
    rule_id: "rule-1",
    campaign_id: null,
    connection_id: "connection-1",
    source: "manual",
    source_ref: "leadgen-1",
    page_id: "page-1",
    form_id: "form-1",
    status: "active",
    conflict_policy: "latest_wins",
    started_at: "2026-07-10T12:00:00.000Z",
    last_activity_at: "2026-07-10T12:00:00.000Z",
    expires_at: "2099-07-10T12:00:00.000Z",
    ended_at: null,
    metadata,
  };
  const tables: Record<string, Row[]> = {
    lead_journeys: [journey],
    tenant_agents: [{ tenant_id: "tenant-1", agent_id: "agent-1", active: true, metadata: { status: "ativo" } }],
  };
  return {
    from: (name: string) => makeQuery(tables[name] ?? []),
  };
}

describe("manual Meta journey authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OMNICHANNEL_JOURNEYS_ENABLED = "true";
  });

  it("authorizes a manual retry only when the same active Meta rule still authorizes it", async () => {
    metaAuthorizationMock.mockResolvedValue({
      authorized: true,
      agentId: "agent-1",
      ruleId: "rule-1",
      source: "rule",
      reason: "active_rule_explicit_form",
    });
    const sb = makeSupabase({ manual_assignment: true });

    const result = await authorizeActiveJourney({
      sb: sb as never,
      tenantId: "tenant-1",
      remoteJid: "5562999999999@s.whatsapp.net",
      preferredAgentId: "agent-1",
    });

    expect(result.ok).toBe(true);
    expect(metaAuthorizationMock).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-1",
      pageId: "page-1",
      formId: "form-1",
      agentId: "agent-1",
      connectionId: "connection-1",
    }));
  });

  it("keeps arbitrary manual journeys blocked from automation", async () => {
    const sb = makeSupabase({});

    const result = await authorizeActiveJourney({
      sb: sb as never,
      tenantId: "tenant-1",
      remoteJid: "5562999999999@s.whatsapp.net",
      preferredAgentId: "agent-1",
    });

    expect(result).toMatchObject({ ok: false, reason: "manual_journey_has_no_automation" });
    expect(metaAuthorizationMock).not.toHaveBeenCalled();
  });
});
