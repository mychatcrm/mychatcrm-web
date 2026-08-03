import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const processMetaLeadgenEvent = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/server/meta-lead-ingest", () => ({
  processMetaLeadgenEvent,
}));

import {
  buildMetaLeadgenInboxEvent,
  enqueueMetaLeadgenEvents,
  metaLeadgenRetryDelaySeconds,
  processMetaLeadgenInbox,
} from "@/lib/server/meta-leadgen-inbox";

function claimedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    page_id: "page-1",
    leadgen_id: "lead-1",
    form_id: "form-1",
    ad_id: null,
    ad_group_id: null,
    event_field: "leadgen",
    provider_created_at: "2026-07-28T20:00:00.000Z",
    status: "processing",
    attempts: 1,
    max_attempts: 8,
    claim_token: "7a7cf9fc-e9c8-4b30-bdf8-9013b1602142",
    ...overrides,
  };
}

describe("Meta leadgen durable inbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds a PII-free event from allowlisted provider identifiers", () => {
    const event = buildMetaLeadgenInboxEvent("leadgen", {
      page_id: " page-1 ",
      leadgen_id: " lead-1 ",
      form_id: "form-1",
      ad_id: "ad-1",
      ad_group_id: "adset-1",
      created_time: 1_775_000_000,
      // Runtime payloads may contain extra fields; they must not be copied.
      field_data: [{ name: "email", values: ["person@example.com"] }],
    } as never);

    expect(event).toEqual({
      event_field: "leadgen",
      page_id: "page-1",
      leadgen_id: "lead-1",
      form_id: "form-1",
      ad_id: "ad-1",
      ad_group_id: "adset-1",
      created_time: 1_775_000_000,
    });
    expect(JSON.stringify(event)).not.toContain("person@example.com");
  });

  it("rejects events without the two identifiers required for idempotency", () => {
    expect(
      buildMetaLeadgenInboxEvent("leadgen", {
        page_id: "page-1",
      }),
    ).toBeNull();
    expect(
      buildMetaLeadgenInboxEvent("messages", {
        page_id: "page-1",
        leadgen_id: "lead-1",
      }),
    ).toBeNull();
  });

  it("persists only the allowlisted minimal event and returns unique job ids", async () => {
    const rpc = vi.fn(async () => ({
      data: [
        { id: "job-1", status: "pending" },
        { id: "job-1", status: "pending" },
      ],
      error: null,
    }));
    const event = {
      event_field: "leadgen" as const,
      page_id: "page-1",
      leadgen_id: "lead-1",
      form_id: "form-1",
      contact_email: "person@example.com",
    };

    const result = await enqueueMetaLeadgenEvents({
      sb: { rpc } as never,
      events: [event as never],
    });

    expect(result).toEqual({ jobIds: ["job-1"] });
    expect(rpc).toHaveBeenCalledWith("enqueue_meta_leadgen_events", {
      p_events: [
        {
          event_field: "leadgen",
          page_id: "page-1",
          leadgen_id: "lead-1",
          form_id: "form-1",
          ad_id: undefined,
          ad_group_id: undefined,
          created_time: undefined,
        },
      ],
    });
    expect(JSON.stringify(rpc.mock.calls[0])).not.toContain("person@example.com");
  });

  it("claims transactionally, invokes the existing processor once, and completes with its claim token", async () => {
    const row = claimedRow();
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_meta_leadgen_events") return { data: [row], error: null };
      if (name === "complete_meta_leadgen_event") return { data: true, error: null };
      throw new Error(`unexpected rpc ${name}`);
    });

    const result = await processMetaLeadgenInbox({
      sb: { rpc } as never,
      limit: 1,
      jobIds: ["job-1"],
    });

    expect(processMetaLeadgenEvent).toHaveBeenCalledWith({
      page_id: "page-1",
      leadgen_id: "lead-1",
      form_id: "form-1",
      ad_id: undefined,
      ad_group_id: undefined,
      created_time: Math.floor(Date.parse("2026-07-28T20:00:00.000Z") / 1000),
    });
    expect(rpc).toHaveBeenCalledWith("claim_meta_leadgen_events", {
      p_limit: 1,
      p_claim_ttl_seconds: 300,
      p_job_ids: ["job-1"],
    });
    expect(rpc).toHaveBeenCalledWith("complete_meta_leadgen_event", {
      p_id: "job-1",
      p_claim_token: row.claim_token,
    });
    expect(result).toEqual({
      claimed: 1,
      completed: 1,
      retrying: 0,
      deadLetter: 0,
      reviewRequired: 0,
      claimLost: 0,
      errors: 0,
    });
  });

  it("records only a structured code and fingerprint before retrying a failed claim", async () => {
    const row = claimedRow({ attempts: 2 });
    processMetaLeadgenEvent.mockRejectedValueOnce(
      new Error("fetch failed for person@example.com and phone 5511999999999"),
    );
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_meta_leadgen_events") return { data: [row], error: null };
      if (name === "fail_meta_leadgen_event_v2") return { data: "retrying", error: null };
      throw new Error(`unexpected rpc ${name}`);
    });

    const result = await processMetaLeadgenInbox({
      sb: { rpc } as never,
      limit: 1,
    });

    const failureCall = rpc.mock.calls.find(
      ([name]) => name === "fail_meta_leadgen_event_v2",
    );
    expect(failureCall?.[1]).toMatchObject({
      p_id: "job-1",
      p_claim_token: row.claim_token,
      p_error_code: "upstream_network_error",
      p_error_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_retryable: true,
    });
    expect(JSON.stringify(failureCall)).not.toContain("person@example.com");
    expect(JSON.stringify(failureCall)).not.toContain("5511999999999");
    expect(result.retrying).toBe(1);
  });

  it("dead-letters typed non-retryable failures immediately", async () => {
    const row = claimedRow();
    processMetaLeadgenEvent.mockRejectedValueOnce(
      Object.assign(new Error("outbound_dispatch_ambiguous"), {
        processingCode: "outbound_dispatch_ambiguous",
        retryable: false,
      }),
    );
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_meta_leadgen_events") return { data: [row], error: null };
      if (name === "fail_meta_leadgen_event_v2") return { data: "dead_letter", error: null };
      throw new Error(`unexpected rpc ${name}`);
    });

    const result = await processMetaLeadgenInbox({
      sb: { rpc } as never,
      limit: 1,
    });

    expect(rpc).toHaveBeenCalledWith(
      "fail_meta_leadgen_event_v2",
      expect.objectContaining({
        p_error_code: "outbound_dispatch_ambiguous",
        p_retryable: false,
      }),
    );
    expect(result.deadLetter).toBe(1);
    expect(result.retrying).toBe(0);
  });

  it("moves an exhausted retryable failure to manual review instead of losing it", async () => {
    const row = claimedRow({ attempts: 8, max_attempts: 8 });
    processMetaLeadgenEvent.mockRejectedValueOnce(new Error("fetch failed"));
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_meta_leadgen_events") return { data: [row], error: null };
      if (name === "fail_meta_leadgen_event_v2") {
        return { data: "review_required", error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    });

    const result = await processMetaLeadgenInbox({ sb: { rpc } as never, limit: 1 });

    expect(rpc).toHaveBeenCalledWith(
      "fail_meta_leadgen_event_v2",
      expect.objectContaining({ p_retryable: true }),
    );
    expect(result.reviewRequired).toBe(1);
    expect(result.deadLetter).toBe(0);
  });

  it("terminalizes and audits a stale crash after the final allowed claim", () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260728215953_meta_leadgen_durable_inbox.sql",
      ),
      "utf8",
    );

    expect(migration).toContain("inbox.attempts >= inbox.max_attempts");
    expect(migration).toContain("claim_expired_after_final_attempt");
    expect(migration).toContain("INSERT INTO public.meta_leadgen_inbox_failures");
    expect(migration).toContain("FOR UPDATE SKIP LOCKED");
  });

  it("uses capped exponential retry delays", () => {
    expect(metaLeadgenRetryDelaySeconds(1)).toBe(15);
    expect(metaLeadgenRetryDelaySeconds(2)).toBe(30);
    expect(metaLeadgenRetryDelaySeconds(7)).toBe(900);
    expect(metaLeadgenRetryDelaySeconds(20)).toBe(900);
  });
});
