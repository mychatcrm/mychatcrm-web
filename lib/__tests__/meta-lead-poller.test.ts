import { describe, expect, it } from "vitest";
import {
  buildSignedMetaWebhookHeaders,
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

  it("builds a valid Meta signature header for forwarded webhook payloads", () => {
    const headers = buildSignedMetaWebhookHeaders("{\"ok\":true}", "secret");

    expect(headers["content-type"]).toBe("application/json");
    expect(headers["x-hub-signature-256"]).toMatch(/^sha256=[a-f0-9]{64}$/);
  });
});
