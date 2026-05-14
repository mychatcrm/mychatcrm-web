import { describe, expect, it } from "vitest";
import {
  isJobStuckPastGrace,
  isSmartWaitGloballyDisabled,
} from "@/lib/server/agent-response-fallback";
import type { AgentResponseJobRow } from "@/lib/server/agent-response-jobs";

function makeJob(maxWaitUntil: string): AgentResponseJobRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    tenant_id: "t1",
    lead_id: null,
    remote_jid: "5562999999999@s.whatsapp.net",
    agent_id: "ag1",
    instance_name: "inst",
    status: "pending",
    first_message_at: "2026-05-14T10:00:00.000Z",
    last_message_at: "2026-05-14T10:00:00.000Z",
    scheduled_for: "2026-05-14T10:00:05.000Z",
    max_wait_until: maxWaitUntil,
    message_ids: ["00000000-0000-4000-8000-000000000002"],
    inbound_message_count: 1,
    attempt_count: 0,
    burst_generation: 1,
    locked_at: null,
    completed_at: null,
    failed_reason: null,
    created_at: "2026-05-14T10:00:00.000Z",
    updated_at: "2026-05-14T10:00:00.000Z",
  };
}

describe("smart wait fallback helpers", () => {
  it("detects job stuck after max_wait_until + grace", () => {
    const job = makeJob("2026-05-14T10:00:30.000Z");
    const now = new Date("2026-05-14T10:00:51.000Z").getTime();
    const graceMs = 20_000;
    expect(now > new Date(job.max_wait_until).getTime() + graceMs).toBe(true);
    expect(isJobStuckPastGrace(job, graceMs)).toBe(
      Date.now() > new Date(job.max_wait_until).getTime() + graceMs,
    );
  });

  it("reads SMART_WAIT_DISABLED env kill switch", () => {
    const prev = process.env.SMART_WAIT_DISABLED;
    process.env.SMART_WAIT_DISABLED = "true";
    expect(isSmartWaitGloballyDisabled()).toBe(true);
    process.env.SMART_WAIT_DISABLED = prev;
  });
});
