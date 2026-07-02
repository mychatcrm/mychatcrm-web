import { describe, expect, it } from "vitest";
import {
  resolveCloudApiTenantByConnection,
  resolveDirectWhatsAppAgentFromRules,
} from "@/lib/server/agent-channel-authorization";

function fakeSupabase(rows: Array<{ tenant_id: string; active: boolean }>, error: string | null = null) {
  return {
    from() {
      const builder = {
        select: () => builder,
        in: () => builder,
        eq: () => builder,
        then(
          resolve: (value: {
            data: Array<{ tenant_id: string; active: boolean }> | null;
            error: { message: string } | null;
          }) => unknown,
        ) {
          return Promise.resolve({
            data: error ? null : rows,
            error: error ? { message: error } : null,
          }).then(resolve);
        },
      };
      return builder;
    },
  } as never;
}

function fakeDirectSupabase(
  rules: Array<{
    id: string;
    distribution_type: string;
    agent_ids: string[];
    order_index: number;
    connection_id: string | null;
  }>,
) {
  return {
    from() {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => Promise.resolve({ data: rules, error: null }),
      };
      return builder;
    },
  } as never;
}

describe("Cloud API tenant resolution", () => {
  it("resolves one tenant by the explicit phone number id", async () => {
    const result = await resolveCloudApiTenantByConnection({
      sb: fakeSupabase([{ tenant_id: "tenant-a", active: true }]),
      connectionId: "123456789",
    });

    expect(result).toEqual({ ok: true, tenantId: "tenant-a" });
  });

  it("allows inactive rules to identify the tenant without authorizing automation", async () => {
    const result = await resolveCloudApiTenantByConnection({
      sb: fakeSupabase([{ tenant_id: "tenant-a", active: false }]),
      connectionId: "123456789",
    });

    expect(result).toEqual({ ok: true, tenantId: "tenant-a" });
  });

  it("prefers the tenant with an active rule over a stale inactive owner", async () => {
    const result = await resolveCloudApiTenantByConnection({
      sb: fakeSupabase([
        { tenant_id: "tenant-old", active: false },
        { tenant_id: "tenant-current", active: true },
      ]),
      connectionId: "123456789",
    });

    expect(result).toEqual({ ok: true, tenantId: "tenant-current" });
  });

  it("blocks an ambiguous connection shared by different tenants", async () => {
    const result = await resolveCloudApiTenantByConnection({
      sb: fakeSupabase([
        { tenant_id: "tenant-a", active: true },
        { tenant_id: "tenant-b", active: true },
      ]),
      connectionId: "123456789",
    });

    expect(result).toEqual({ ok: false, reason: "cloud_connection_tenant_ambiguous" });
  });

  it("blocks unknown and failed connection lookups", async () => {
    await expect(
      resolveCloudApiTenantByConnection({
        sb: fakeSupabase([]),
        connectionId: "123456789",
      }),
    ).resolves.toEqual({ ok: false, reason: "cloud_connection_not_registered" });

    await expect(
      resolveCloudApiTenantByConnection({
        sb: fakeSupabase([], "database unavailable"),
        connectionId: "123456789",
      }),
    ).resolves.toEqual({ ok: false, reason: "cloud_connection_query_failed" });
  });
});

describe("direct WhatsApp rule resolution", () => {
  it("selects the rule bound to the current connection", async () => {
    const result = await resolveDirectWhatsAppAgentFromRules({
      sb: fakeDirectSupabase([
        {
          id: "rule-a",
          distribution_type: "automation_agent",
          agent_ids: ["agent-a"],
          order_index: 0,
          connection_id: "connection-a",
        },
        {
          id: "rule-b",
          distribution_type: "automation_agent",
          agent_ids: ["agent-b"],
          order_index: 1,
          connection_id: "connection-b",
        },
      ]),
      tenantId: "tenant-a",
      connectionId: "connection-b",
    });

    expect(result).toEqual({ agentId: "agent-b", ruleId: "rule-b" });
  });

  it("blocks ambiguous legacy rules instead of choosing the first agent", async () => {
    const result = await resolveDirectWhatsAppAgentFromRules({
      sb: fakeDirectSupabase([
        {
          id: "rule-a",
          distribution_type: "automation_agent",
          agent_ids: ["agent-a"],
          order_index: 0,
          connection_id: "connection-a",
        },
        {
          id: "rule-b",
          distribution_type: "automation_agent",
          agent_ids: ["agent-b"],
          order_index: 1,
          connection_id: "connection-a",
        },
      ]),
      tenantId: "tenant-a",
      connectionId: "connection-a",
    });

    expect(result).toBeNull();
  });

  it("blocks a legacy direct rule containing more than one agent", async () => {
    const result = await resolveDirectWhatsAppAgentFromRules({
      sb: fakeDirectSupabase([
        {
          id: "rule-a",
          distribution_type: "specific_agents",
          agent_ids: ["agent-a", "agent-b"],
          order_index: 0,
          connection_id: "connection-a",
        },
      ]),
      tenantId: "tenant-a",
      connectionId: "connection-a",
    });

    expect(result).toBeNull();
  });
});
