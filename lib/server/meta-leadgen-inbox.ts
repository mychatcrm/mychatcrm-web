import "server-only";

import { createHash } from "node:crypto";
import { processMetaLeadgenEvent, type LeadgenValue } from "@/lib/server/meta-lead-ingest";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

const DEFAULT_CLAIM_LIMIT = 5;
const MAX_CLAIM_LIMIT = 25;
const CLAIM_TTL_SECONDS = 300;
const MAX_IDENTIFIER_LENGTH = 128;

export type MetaLeadgenEventField = "leadgen" | "leadgen_update";

export type MetaLeadgenInboxEvent = LeadgenValue & {
  event_field: MetaLeadgenEventField;
};

export type MetaLeadgenInboxRow = {
  id: string;
  page_id: string;
  leadgen_id: string;
  form_id: string | null;
  ad_id: string | null;
  ad_group_id: string | null;
  event_field: MetaLeadgenEventField;
  provider_created_at: string | null;
  status: "pending" | "processing" | "retrying" | "completed" | "dead_letter";
  attempts: number;
  max_attempts: number;
  claim_token: string | null;
};

export type MetaLeadgenInboxProcessResult = {
  claimed: number;
  completed: number;
  retrying: number;
  deadLetter: number;
  claimLost: number;
  errors: number;
};

type FailureDisposition = {
  code: string;
  fingerprint: string;
  terminal: boolean;
};

function normalizeOpaqueIdentifier(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  if (!normalized || normalized.length > MAX_IDENTIFIER_LENGTH) return null;
  return normalized;
}

export function buildMetaLeadgenInboxEvent(
  eventField: string,
  value: Partial<LeadgenValue> | null | undefined,
): MetaLeadgenInboxEvent | null {
  if (eventField !== "leadgen" && eventField !== "leadgen_update") return null;

  const pageId = normalizeOpaqueIdentifier(value?.page_id);
  const leadgenId = normalizeOpaqueIdentifier(value?.leadgen_id);
  if (!pageId || !leadgenId) return null;

  const createdTime =
    typeof value?.created_time === "number" &&
    Number.isFinite(value.created_time) &&
    value.created_time >= 0
      ? value.created_time
      : undefined;

  return {
    event_field: eventField,
    page_id: pageId,
    leadgen_id: leadgenId,
    form_id: normalizeOpaqueIdentifier(value?.form_id) ?? undefined,
    ad_id: normalizeOpaqueIdentifier(value?.ad_id) ?? undefined,
    ad_group_id: normalizeOpaqueIdentifier(value?.ad_group_id) ?? undefined,
    created_time: createdTime,
  };
}

export async function enqueueMetaLeadgenEvents(params: {
  events: MetaLeadgenInboxEvent[];
  sb?: SupabaseServiceClient;
}): Promise<{ jobIds: string[] }> {
  if (params.events.length < 1 || params.events.length > 100) {
    throw new Error("meta_leadgen_events_invalid_batch_size");
  }

  const sb = params.sb ?? createSupabaseServiceClient();
  // Rebuild the payload from the allowlisted provider identifiers. Even if a
  // future caller passes extra properties at runtime, contact PII cannot cross
  // this queue boundary.
  const durableEvents = params.events.map((event) => {
    const normalized = buildMetaLeadgenInboxEvent(event.event_field, event);
    if (!normalized) throw new Error("meta_leadgen_event_invalid");
    return normalized;
  });
  const { data, error } = await sb.rpc("enqueue_meta_leadgen_events", {
    p_events: durableEvents,
  });
  if (error) {
    throw new Error("meta_leadgen_inbox_persist_failed", { cause: error });
  }

  const jobIds = Array.from(
    new Set(
      ((data ?? []) as Array<{ id?: unknown }>)
        .map((row) => (typeof row.id === "string" ? row.id : ""))
        .filter(Boolean),
    ),
  );
  if (jobIds.length === 0) {
    throw new Error("meta_leadgen_inbox_persist_inconclusive");
  }
  return { jobIds };
}

function leadgenValueFromInboxRow(row: MetaLeadgenInboxRow): LeadgenValue {
  const providerCreatedAtMs = row.provider_created_at
    ? Date.parse(row.provider_created_at)
    : Number.NaN;
  return {
    page_id: row.page_id,
    leadgen_id: row.leadgen_id,
    form_id: row.form_id ?? undefined,
    ad_id: row.ad_id ?? undefined,
    ad_group_id: row.ad_group_id ?? undefined,
    created_time: Number.isFinite(providerCreatedAtMs)
      ? Math.floor(providerCreatedAtMs / 1000)
      : undefined,
  };
}

function errorFingerprint(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const rawMessage = error instanceof Error ? error.message : String(error);
  const structuralMessage = rawMessage
    .toLowerCase()
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, "[email]")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .slice(0, 512);
  return createHash("sha256")
    .update(`${name}:${structuralMessage}`)
    .digest("hex");
}

export function classifyMetaLeadgenInboxFailure(error: unknown): FailureDisposition {
  const processingCode =
    error && typeof error === "object" && "processingCode" in error
      ? String(
          (error as { processingCode?: unknown }).processingCode ?? "",
        )
      : "";
  const retryable =
    error && typeof error === "object" && "retryable" in error
      ? (error as { retryable?: unknown }).retryable
      : undefined;
  const rawCode =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  const message = error instanceof Error ? error.message : String(error);
  const normalized = `${rawCode} ${message}`.toLowerCase();

  let code = processingCode
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96) || "processing_failed";
  if (!processingCode) {
    if (/timeout|timed out|abort/.test(normalized)) code = "upstream_timeout";
    else if (/429|rate.?limit|too many requests/.test(normalized)) code = "upstream_rate_limited";
    else if (/fetch|network|econn|enotfound|socket/.test(normalized)) code = "upstream_network_error";
    else if (/jwt|token|permission|oauth|access denied|unauthorized|forbidden/.test(normalized)) {
      code = "meta_access_rejected";
    } else if (/meta_leadgen_event_invalid|invalid_input/.test(normalized)) {
      code = "invalid_event";
    }
  }

  return {
    code,
    fingerprint: errorFingerprint(error),
    terminal: retryable === false || code === "invalid_event",
  };
}

export function metaLeadgenRetryDelaySeconds(attempts: number): number {
  return Math.min(15 * 2 ** Math.max(0, attempts - 1), 900);
}

async function completeClaimedJob(
  sb: SupabaseServiceClient,
  row: MetaLeadgenInboxRow,
): Promise<boolean> {
  if (!row.claim_token) return false;
  const { data, error } = await sb.rpc("complete_meta_leadgen_event", {
    p_id: row.id,
    p_claim_token: row.claim_token,
  });
  if (error) throw new Error("meta_leadgen_inbox_complete_failed", { cause: error });
  return data === true;
}

async function failClaimedJob(
  sb: SupabaseServiceClient,
  row: MetaLeadgenInboxRow,
  error: unknown,
): Promise<"retrying" | "dead_letter" | "claim_lost"> {
  if (!row.claim_token) return "claim_lost";
  const failure = classifyMetaLeadgenInboxFailure(error);
  const delaySeconds = metaLeadgenRetryDelaySeconds(row.attempts);
  const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
  const { data, error: rpcError } = await sb.rpc("fail_meta_leadgen_event", {
    p_id: row.id,
    p_claim_token: row.claim_token,
    p_error_code: failure.code,
    p_error_fingerprint: failure.fingerprint,
    p_next_attempt_at: nextAttemptAt,
    p_force_terminal: failure.terminal,
  });
  if (rpcError) {
    throw new Error("meta_leadgen_inbox_fail_failed", { cause: rpcError });
  }
  return data === "retrying" || data === "dead_letter" ? data : "claim_lost";
}

async function processClaimedJob(
  sb: SupabaseServiceClient,
  row: MetaLeadgenInboxRow,
): Promise<"completed" | "retrying" | "dead_letter" | "claim_lost" | "error"> {
  try {
    await processMetaLeadgenEvent(leadgenValueFromInboxRow(row));
    const completed = await completeClaimedJob(sb, row);
    if (!completed) {
      console.warn("[meta-leadgen-inbox] completion_claim_lost", {
        inbox_id: row.id,
        attempts: row.attempts,
      });
      return "claim_lost";
    }
    return "completed";
  } catch (error) {
    try {
      const disposition = await failClaimedJob(sb, row, error);
      const failure = classifyMetaLeadgenInboxFailure(error);
      console.warn("[meta-leadgen-inbox] processing_failed", {
        inbox_id: row.id,
        attempts: row.attempts,
        disposition,
        error_code: failure.code,
        error_fingerprint: failure.fingerprint,
      });
      return disposition;
    } catch (finalizeError) {
      const failure = classifyMetaLeadgenInboxFailure(finalizeError);
      console.error("[meta-leadgen-inbox] failure_finalize_failed", {
        inbox_id: row.id,
        attempts: row.attempts,
        error_code: failure.code,
        error_fingerprint: failure.fingerprint,
      });
      return "error";
    }
  }
}

export async function processMetaLeadgenInbox(params: {
  sb?: SupabaseServiceClient;
  limit?: number;
  jobIds?: string[];
} = {}): Promise<MetaLeadgenInboxProcessResult> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const limit = Math.max(
    1,
    Math.min(Math.floor(params.limit ?? DEFAULT_CLAIM_LIMIT), MAX_CLAIM_LIMIT),
  );
  const jobIds = params.jobIds?.filter(Boolean).slice(0, MAX_CLAIM_LIMIT);
  const { data, error } = await sb.rpc("claim_meta_leadgen_events", {
    p_limit: limit,
    p_claim_ttl_seconds: CLAIM_TTL_SECONDS,
    p_job_ids: jobIds?.length ? jobIds : null,
  });
  if (error) {
    throw new Error("meta_leadgen_inbox_claim_failed", { cause: error });
  }

  const rows = (data ?? []) as MetaLeadgenInboxRow[];
  const outcomes = await Promise.all(rows.map((row) => processClaimedJob(sb, row)));
  const result: MetaLeadgenInboxProcessResult = {
    claimed: rows.length,
    completed: 0,
    retrying: 0,
    deadLetter: 0,
    claimLost: 0,
    errors: 0,
  };
  for (const outcome of outcomes) {
    if (outcome === "completed") result.completed += 1;
    else if (outcome === "retrying") result.retrying += 1;
    else if (outcome === "dead_letter") result.deadLetter += 1;
    else if (outcome === "claim_lost") result.claimLost += 1;
    else result.errors += 1;
  }
  return result;
}
