import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const {
  getEvolutionInstanceByIdForTenant,
  lookupWhatsAppCloudConnectionByPhoneNumberId,
} = vi.hoisted(() => ({
  getEvolutionInstanceByIdForTenant: vi.fn(),
  lookupWhatsAppCloudConnectionByPhoneNumberId: vi.fn(),
}));

vi.mock("@/lib/server/tenant-evolution-instance-db", () => ({
  getEvolutionInstanceByIdForTenant,
}));

vi.mock("@/lib/server/whatsapp-cloud-connections", () => ({
  lookupWhatsAppCloudConnectionByPhoneNumberId,
}));

import {
  FOLLOW_UP_BATCH_LIMIT,
  FOLLOW_UP_CLAIM_TTL_MS,
  FOLLOW_UP_PROCESS_CONCURRENCY,
  processDueFollowUpJobs,
  reclaimStuckFollowUpJobs,
  resolveFollowUpOutboundTransport,
} from "@/lib/server/follow-up-jobs";

describe("follow-up exact transport resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEvolutionInstanceByIdForTenant.mockResolvedValue(null);
    lookupWhatsAppCloudConnectionByPhoneNumberId.mockResolvedValue(null);
  });

  it("resolves an exact active Meta Cloud connection", async () => {
    lookupWhatsAppCloudConnectionByPhoneNumberId.mockResolvedValue({
      phone_number_id: "PN-1",
      tenant_id: "tenant-1",
      access_token: "secret",
      active: true,
    });

    const result = await resolveFollowUpOutboundTransport({
      tenantId: "tenant-1",
      connectionId: "PN-1",
      channel: "meta_cloud",
    });

    expect(result).toMatchObject({
      ok: true,
      channel: "meta_cloud",
      connectionId: "PN-1",
    });
    expect(getEvolutionInstanceByIdForTenant).not.toHaveBeenCalled();
  });

  it("never switches provider when the stored channel is exact", async () => {
    lookupWhatsAppCloudConnectionByPhoneNumberId.mockResolvedValue({
      phone_number_id: "same-id",
      tenant_id: "tenant-1",
      access_token: "secret",
      active: true,
    });
    getEvolutionInstanceByIdForTenant.mockResolvedValue({
      id: "same-id",
      tenant_id: "tenant-1",
      instance_name: "instance-1",
      connection_state: "open",
    });

    await expect(resolveFollowUpOutboundTransport({
      tenantId: "tenant-1",
      connectionId: "same-id",
      channel: "evolution",
    })).resolves.toMatchObject({ ok: true, channel: "evolution", connectionId: "same-id" });
    expect(lookupWhatsAppCloudConnectionByPhoneNumberId).not.toHaveBeenCalled();
  });

  it("does not fall back without an exact connection", async () => {
    const result = await resolveFollowUpOutboundTransport({
      tenantId: "tenant-1",
      connectionId: "",
      channel: "evolution",
    });

    expect(result).toEqual({ ok: false, reason: "missing_authorized_connection" });
    expect(getEvolutionInstanceByIdForTenant).not.toHaveBeenCalled();
    expect(lookupWhatsAppCloudConnectionByPhoneNumberId).not.toHaveBeenCalled();
  });
});

describe("follow-up claim recovery", () => {
  it("reclaims only processing jobs older than the explicit TTL", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 1, error: null });
    const sb = {
      rpc,
    } as never;
    const now = new Date("2026-08-24T12:00:00.000Z");

    await expect(reclaimStuckFollowUpJobs(sb, now)).resolves.toBe(1);
    expect(rpc).toHaveBeenCalledWith("recover_expired_follow_up_jobs_v2", {
      p_now: now.toISOString(),
    });
  });
});

describe("follow-up durable claim contract", () => {
  it("keeps a lease longer than the processing function budget", () => {
    expect(FOLLOW_UP_CLAIM_TTL_MS).toBeGreaterThan(120_000);
  });

  it("claims due work as a database batch instead of read-then-update", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "reconcile_agent_runtime_state_v1") {
        return { data: {}, error: null };
      }
      if (name === "recover_expired_follow_up_jobs_v2") {
        return { data: 0, error: null };
      }
      if (name === "claim_follow_up_jobs_v2") {
        return { data: [], error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    });
    const sb = { rpc } as never;

    await expect(processDueFollowUpJobs(sb)).resolves.toEqual({
      processed: 0,
      sent: 0,
      cancelled: 0,
      exhausted: 0,
      failed: 0,
    });
    expect(rpc).toHaveBeenCalledWith("claim_follow_up_jobs_v2", {
      p_limit: FOLLOW_UP_BATCH_LIMIT,
      p_claim_seconds: FOLLOW_UP_CLAIM_TTL_MS / 1000,
    });
    expect(FOLLOW_UP_PROCESS_CONCURRENCY).toBeGreaterThan(0);
    expect(FOLLOW_UP_PROCESS_CONCURRENCY).toBeLessThanOrEqual(FOLLOW_UP_BATCH_LIMIT);
  });

  it("reschedules temporary cooldowns and renews the exact journey after delivery", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/server/follow-up-jobs.ts"),
      "utf8",
    );
    expect(source).toContain('lastError: "rescheduled_cooldown"');
    expect(source).toContain("scheduledAt: decision.nextRetryAt");
    expect(source).toContain("touchLeadJourney({");
    expect(source).toContain('throw new Error("journey_activity_renewal_failed_after_send")');
    expect(source).toContain("provider_delivery_committed: true");
  });

  it("finishes every claimed job through the token-guarded RPC", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/server/follow-up-jobs.ts"),
      "utf8",
    );
    const processSource = source.slice(source.indexOf("export async function processFollowUpJob"));
    expect(source).toContain('rpc("finish_follow_up_job_v2"');
    expect(processSource).toContain("finishClaimedFollowUpJob");
    expect(processSource).not.toMatch(/from\("follow_up_jobs"\)\s*\n\s*\.update\(/);
    expect(processSource).not.toContain("localizedAgentFailureReply");
  });

  it("creates a successor with the exact omnichannel identity in one transaction", () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260824160856_agent_runtime_hardening_v2.sql",
      ),
      "utf8",
    );
    const finishFunction = migration.slice(
      migration.indexOf("create or replace function public.finish_follow_up_job_v2"),
      migration.indexOf("create or replace function public.cancel_active_follow_up_jobs_v2"),
    );
    for (const field of [
      "journey_id",
      "rule_id",
      "channel",
      "connection_id",
      "automation_epoch",
    ]) {
      expect(finishFunction).toContain(field);
    }
    expect(finishFunction).toContain("claim_token = p_claim_token");
    expect(finishFunction).toContain("claim_expires_at > v_now");
  });

  it("blocks only time-restricted follow-up without an explicit timezone and records review", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/server/follow-up-jobs.ts"),
      "utf8",
    );
    const migration = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260824160856_agent_runtime_hardening_v2.sql",
      ),
      "utf8",
    );
    expect(source).toContain("settings.usarHorarioComercial");
    expect(source).toContain("isValidIanaTimezone(settings.timezone)");
    expect(source).toContain('lastError: "follow_up_timezone_required"');
    expect(migration).toContain("follow_up_timezone_required");
    expect(migration).toContain("mark_agent_runtime_review_reason_v1");
    expect(migration).toMatch(
      /revoke all on function public\.mark_agent_runtime_review_reason_v1[\s\S]+from public, anon, authenticated/,
    );
  });
});
