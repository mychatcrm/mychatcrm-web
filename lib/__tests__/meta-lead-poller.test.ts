import { describe, expect, it } from "vitest";
import {
  buildSignedMetaWebhookHeaders,
  isMetaLeadAfterActivation,
  isMetaConnectionPollEligible,
  isRecentMetaLead,
  metaLeadCreatedAtMs,
} from "@/lib/server/meta-lead-poller";

describe("Meta lead poller helpers", () => {
  it("detects recent Meta leads inside the polling window", () => {
    const now = Date.parse("2026-05-22T18:40:00.000Z");

    expect(isRecentMetaLead("2026-05-22T18:31:41+0000", now, 120)).toBe(true);
    expect(isRecentMetaLead("2026-05-22T15:31:41+0000", now, 120)).toBe(false);
  });

  it("ignores invalid or missing created_time values", () => {
    const now = Date.parse("2026-05-22T18:40:00.000Z");

    expect(metaLeadCreatedAtMs(undefined)).toBeNull();
    expect(isRecentMetaLead("not-a-date", now, 120)).toBe(false);
  });

  it("blocks Meta leads created before rule activation", () => {
    const activation = Date.parse("2026-05-25T18:30:00.000Z");

    expect(isMetaLeadAfterActivation("2026-05-25T18:29:59+0000", activation)).toBe(false);
    expect(isMetaLeadAfterActivation("2026-05-25T18:30:00+0000", activation)).toBe(true);
    expect(isMetaLeadAfterActivation("2026-05-25T18:35:00+0000", activation)).toBe(true);
  });

  it("does not allow polling without a known activation boundary", () => {
    expect(isMetaLeadAfterActivation("2026-05-25T18:35:00+0000", null)).toBe(false);
  });

  it("builds a valid Meta signature header for forwarded webhook payloads", () => {
    const headers = buildSignedMetaWebhookHeaders("{\"ok\":true}", "secret");

    expect(headers["content-type"]).toBe("application/json");
    expect(headers["x-hub-signature-256"]).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it("keeps polling as a fallback when only webhook transport is unhealthy", () => {
    expect(
      isMetaConnectionPollEligible({
        health_status: "action_required",
        health_code: "app_webhook_callback_mismatch",
        lead_access_status: "verified_by_delivery",
      }),
    ).toBe(true);
    expect(
      isMetaConnectionPollEligible({
        health_status: "degraded",
        health_code: "graph_temporarily_unavailable",
        lead_access_status: "verified_by_retrieval",
      }),
    ).toBe(true);
  });

  it("never polls when current Meta lead access is denied", () => {
    expect(
      isMetaConnectionPollEligible({
        health_status: "action_required",
        health_code: "lead_access_denied",
        lead_access_status: "action_required",
      }),
    ).toBe(false);
    expect(
      isMetaConnectionPollEligible({
        health_status: "retrying",
        health_code: "graph_temporarily_unavailable",
        lead_access_status: "unverified",
      }),
    ).toBe(false);
  });
});
