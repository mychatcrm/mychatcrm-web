import "server-only";

import { createHash } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

type InboxRow = {
  id: string;
  payload: unknown;
  claim_token: string;
  attempts: number;
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stableJson(row[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function instanceNameFromPayload(payload: unknown): string {
  const first = Array.isArray(payload) ? payload[0] : payload;
  if (!first || typeof first !== "object") return "unknown";
  const row = first as Record<string, unknown>;
  for (const candidate of [row.instance, row.instanceName, (row.data as Record<string, unknown> | undefined)?.instance]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "unknown";
}

export async function enqueueEvolutionWebhook(params: {
  sb?: SupabaseServiceClient;
  payload: unknown;
}): Promise<{ id: string | null; duplicate: boolean }> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const canonical = stableJson(params.payload);
  const eventKey = createHash("sha256").update(canonical, "utf8").digest("hex");
  const { data, error } = await sb.from("evolution_webhook_inbox").insert({
    event_key: eventKey,
    instance_name: instanceNameFromPayload(params.payload),
    payload: params.payload,
  }).select("id").maybeSingle();
  if (error?.code === "23505") return { id: null, duplicate: true };
  if (error) throw new Error(`evolution_inbox_persist_failed:${error.message}`);
  return { id: data?.id ? String(data.id) : null, duplicate: false };
}

async function finishInbox(params: {
  sb: SupabaseServiceClient;
  row: InboxRow;
  ok: boolean;
  retryable: boolean;
  error: string | null;
}) {
  const { data, error } = await params.sb.rpc("finish_evolution_webhook_inbox_v1", {
    p_id: params.row.id,
    p_claim_token: params.row.claim_token,
    p_ok: params.ok,
    p_retryable: params.retryable,
    p_last_error: params.error,
  });
  if (error || data !== true) throw new Error(`evolution_inbox_finish_failed:${error?.message ?? "claim_lost"}`);
}

export async function processEvolutionWebhookInbox(params: {
  origin: string;
  authHeaders: Record<string, string>;
  sb?: SupabaseServiceClient;
  batchSize?: number;
  deadlineMs?: number;
}): Promise<{ processed: number; completed: number; retried: number; deadLettered: number }> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const deadlineAt = Date.now() + Math.max(10_000, params.deadlineMs ?? 240_000);
  const { data, error } = await sb.rpc("claim_evolution_webhook_inbox_v1", {
    p_limit: Math.max(1, Math.min(params.batchSize ?? 3, 10)),
    p_claim_seconds: 300,
  });
  if (error) throw new Error(`evolution_inbox_claim_failed:${error.message}`);
  const rows = (Array.isArray(data) ? data : []) as InboxRow[];
  const totals = { processed: 0, completed: 0, retried: 0, deadLettered: 0 };
  for (const row of rows) {
    if (Date.now() >= deadlineAt) break;
    totals.processed += 1;
    try {
      const response = await fetch(new URL("/api/webhooks/evolution", params.origin), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mychatcrm-evolution-deferred": "1",
          "x-mychatcrm-evolution-inbox-worker": "1",
          ...params.authHeaders,
        },
        body: JSON.stringify(row.payload),
        signal: AbortSignal.timeout(Math.min(240_000, Math.max(15_000, deadlineAt - Date.now()))),
      });
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        await finishInbox({ sb, row, ok: false, retryable, error: `worker_http_${response.status}` });
        if (retryable && row.attempts + 1 < 6) totals.retried += 1;
        else totals.deadLettered += 1;
        continue;
      }
      await finishInbox({ sb, row, ok: true, retryable: false, error: null });
      totals.completed += 1;
    } catch (error_) {
      const reason = error_ instanceof Error ? error_.message : "worker_failed";
      await finishInbox({ sb, row, ok: false, retryable: true, error: reason }).catch(() => undefined);
      if (row.attempts + 1 < 6) totals.retried += 1;
      else totals.deadLettered += 1;
    }
  }
  console.info("[evolution-inbox] batch_complete", totals);
  return totals;
}
