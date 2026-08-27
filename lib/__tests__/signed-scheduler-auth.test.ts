import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FOLLOW_UP_SCHEDULER_PATH,
  verifyMetaSchedulerRequest,
  verifySignedSchedulerRequest,
} from "@/lib/server/meta-scheduler-auth";

const SECRET = "follow-up-scheduler-test-secret-with-32-bytes";
const NOW_MS = Date.parse("2026-08-26T20:00:00.000Z");
const TIMESTAMP = String(Math.floor(NOW_MS / 1000));
const NONCE = "2f6f266c-65e0-4da9-871d-123456789abc";

function signedRequest(path: string, signedPath = path, timestamp = TIMESTAMP): Request {
  const signature = createHmac("sha256", SECRET)
    .update(["POST", signedPath, timestamp, NONCE].join("\n"), "utf8")
    .digest("hex");
  return new Request(`https://www.mychatcrm.com.br${path}`, {
    method: "POST",
    headers: {
      "x-mychatcrm-timestamp": timestamp,
      "x-mychatcrm-nonce": NONCE,
      "x-mychatcrm-signature": `sha256=${signature}`,
    },
  });
}

describe("signed internal scheduler authentication", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts a valid signature only for the exact follow-up path", () => {
    vi.stubEnv("META_LEADGEN_SCHEDULER_SECRET", SECRET);
    expect(
      verifySignedSchedulerRequest(
        signedRequest(FOLLOW_UP_SCHEDULER_PATH),
        FOLLOW_UP_SCHEDULER_PATH,
        NOW_MS,
      ),
    ).toMatchObject({ ok: true, nonce: NONCE });

    expect(
      verifySignedSchedulerRequest(
        signedRequest("/api/internal/meta-maintenance", FOLLOW_UP_SCHEDULER_PATH),
        "/api/internal/meta-maintenance",
        NOW_MS,
      ),
    ).toMatchObject({ ok: false, code: "scheduler_signature_invalid" });
  });

  it("rejects expired signatures and unconfigured secrets", () => {
    vi.stubEnv("META_LEADGEN_SCHEDULER_SECRET", SECRET);
    const expired = String(Math.floor(NOW_MS / 1000) - 121);
    expect(
      verifySignedSchedulerRequest(
        signedRequest(FOLLOW_UP_SCHEDULER_PATH, FOLLOW_UP_SCHEDULER_PATH, expired),
        FOLLOW_UP_SCHEDULER_PATH,
        NOW_MS,
      ),
    ).toMatchObject({ ok: false, code: "scheduler_signature_invalid" });

    vi.stubEnv("META_LEADGEN_SCHEDULER_SECRET", "");
    expect(
      verifySignedSchedulerRequest(
        signedRequest(FOLLOW_UP_SCHEDULER_PATH),
        FOLLOW_UP_SCHEDULER_PATH,
        NOW_MS,
      ),
    ).toMatchObject({ ok: false, code: "scheduler_not_configured", status: 503 });
  });

  it("preserves the existing Meta maintenance verifier contract", () => {
    vi.stubEnv("META_LEADGEN_SCHEDULER_SECRET", SECRET);
    expect(
      verifyMetaSchedulerRequest(
        signedRequest("/api/internal/meta-maintenance"),
        NOW_MS,
      ),
    ).toMatchObject({ ok: true, nonce: NONCE });
  });
});
