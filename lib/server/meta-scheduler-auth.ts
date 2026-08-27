import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

const META_SCHEDULER_PATH = "/api/internal/meta-maintenance";
export const FOLLOW_UP_SCHEDULER_PATH = "/api/internal/process-follow-ups";
const MAX_CLOCK_SKEW_SECONDS = 120;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNATURE_PATTERN = /^sha256=([0-9a-f]{64})$/i;

export type SignedSchedulerAuthResult =
  | { ok: true; nonce: string; issuedAt: string }
  | {
      ok: false;
      status: 401 | 503;
      code: "scheduler_not_configured" | "scheduler_signature_invalid";
    };

function safeHexEquals(candidate: string, expected: string): boolean {
  const candidateBytes = Buffer.from(candidate, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  if (
    candidateBytes.length !== 32 ||
    expectedBytes.length !== 32 ||
    candidateBytes.length !== expectedBytes.length
  ) {
    return false;
  }
  try {
    return timingSafeEqual(candidateBytes, expectedBytes);
  } catch {
    return false;
  }
}

export function verifyMetaSchedulerRequest(
  request: Request,
  nowMs = Date.now(),
): SignedSchedulerAuthResult {
  return verifySignedSchedulerRequest(request, META_SCHEDULER_PATH, nowMs);
}

/**
 * Verifies a Supabase/Vault HMAC scheduler call for one exact internal path.
 * The path is part of the signature so a valid request for one worker can
 * never be replayed against another worker.
 */
export function verifySignedSchedulerRequest(
  request: Request,
  expectedPath: string,
  nowMs = Date.now(),
): SignedSchedulerAuthResult {
  const secret = process.env.META_LEADGEN_SCHEDULER_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    return {
      ok: false,
      status: 503,
      code: "scheduler_not_configured",
    };
  }

  let pathname: string;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return {
      ok: false,
      status: 401,
      code: "scheduler_signature_invalid",
    };
  }
  if (
    request.method !== "POST" ||
    !expectedPath.startsWith("/api/internal/") ||
    pathname !== expectedPath
  ) {
    return {
      ok: false,
      status: 401,
      code: "scheduler_signature_invalid",
    };
  }

  const timestamp = request.headers.get("x-mychatcrm-timestamp")?.trim() ?? "";
  const nonce = request.headers.get("x-mychatcrm-nonce")?.trim() ?? "";
  const signature =
    request.headers.get("x-mychatcrm-signature")?.trim() ?? "";
  const signatureMatch = SIGNATURE_PATTERN.exec(signature);
  if (
    !/^\d{10,13}$/.test(timestamp) ||
    !UUID_PATTERN.test(nonce) ||
    !signatureMatch
  ) {
    return {
      ok: false,
      status: 401,
      code: "scheduler_signature_invalid",
    };
  }

  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor(nowMs / 1000);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS
  ) {
    return {
      ok: false,
      status: 401,
      code: "scheduler_signature_invalid",
    };
  }

  const canonical = [
    "POST",
    expectedPath,
    timestamp,
    nonce,
  ].join("\n");
  const expected = createHmac("sha256", secret)
    .update(canonical, "utf8")
    .digest("hex");

  return safeHexEquals(signatureMatch[1].toLowerCase(), expected)
    ? { ok: true, nonce, issuedAt: new Date(timestampSeconds * 1000).toISOString() }
    : {
        ok: false,
        status: 401,
        code: "scheduler_signature_invalid",
      };
}
