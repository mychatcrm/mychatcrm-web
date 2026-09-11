import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: () => ({ from: m.from }) }));
import { labHasPendingAgentWork } from "@/lib/server/agent-test-lab/turn-observation";
const scope = { tenantId: "tenant-lab-fixture", agentId: "agent", remoteJid: "447700900001@s.whatsapp.net", channel: "evolution", connectionId: "connection", createdAt: "2026-09-10T12:00:00Z" };
function query(data: unknown[], error: unknown = null) {
  const q: Record<string, any> = {};
  for (const method of ["select", "eq", "gte", "in"]) q[method] = vi.fn(() => q);
  q.limit = vi.fn().mockResolvedValue({ data, error }); return q;
}
beforeEach(() => vi.resetAllMocks());
describe("actual laboratory agent work", () => {
  it.each(["evolution", "meta_cloud"])("isolates every query by contact, tenant, agent, channel and connection (%s)", async channel => {
    const q = query([]); m.from.mockReturnValue(q);
    expect(await labHasPendingAgentWork({ ...scope, channel })).toBe(false);
    for (const [field, value] of [["tenant_id", scope.tenantId], ["agent_id", scope.agentId], ["remote_jid", scope.remoteJid],
      ["channel", channel], ["connection_id", scope.connectionId]]) expect(q.eq).toHaveBeenCalledWith(field, value);
    expect(q.gte).toHaveBeenCalledWith("created_at", scope.createdAt);
    expect(q.in).toHaveBeenCalledWith("status", ["pending", "processing"]);
  });
  it.each([0, 1])("keeps waiting for pending work in queue %s", async index => {
    m.from.mockReturnValueOnce(query(index === 0 ? [{ id: "job" }] : [])).mockReturnValueOnce(query(index === 1 ? [{ id: "outbox" }] : []));
    expect(await labHasPendingAgentWork(scope)).toBe(true);
  });
  it("does not interpret database failure as no pending work", async () => {
    m.from.mockReturnValue(query([], { code: "unavailable" }));
    await expect(labHasPendingAgentWork(scope)).rejects.toThrow("lab_turn_observation_unavailable");
  });
  it.each([{ tenantId: "customer" }, { channel: "wrong" }, { connectionId: "" }, { createdAt: "invalid" }])("rejects invalid scope before querying", async override => {
    await expect(labHasPendingAgentWork({ ...scope, ...override })).rejects.toThrow("lab_turn_scope_invalid"); expect(m.from).not.toHaveBeenCalled();
  });
});
