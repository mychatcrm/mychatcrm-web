import { describe, expect, it } from "vitest";
import { scheduleAgentResponseJob } from "@/lib/server/agent-response-jobs";

describe("agent response job connection contract", () => {
  it("fails closed before any database call when connectionId is blank", async () => {
    const sb = {
      rpc: () => {
        throw new Error("RPC must not run without an exact connection");
      },
      from: () => {
        throw new Error("database must not be read without an exact connection");
      },
    } as never;

    await expect(scheduleAgentResponseJob({
      sb,
      tenantId: "tenant-anywhere",
      remoteJid: "447700900123@s.whatsapp.net",
      leadId: "lead-arbitrary",
      journeyId: "journey-arbitrary",
      agentId: "agent-arbitrary",
      instanceName: "instance-arbitrary",
      channel: "evolution",
      connectionId: "   ",
      whatsappMessageId: "223e4567-e89b-42d3-a456-426614174000",
      occurredAt: "2026-07-21T12:00:00.000Z",
      settings: { enabled: true, initialSeconds: 1, followupSeconds: 1, maxSeconds: 5 },
    })).resolves.toBeNull();
  });
});
