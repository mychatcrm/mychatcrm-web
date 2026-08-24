import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";
import { reconcileMetaLeadConnections } from "@/lib/server/meta-lead-connection-reconciler";
import {
  processMetaLeadgenInbox,
  type MetaLeadgenInboxProcessResult,
} from "@/lib/server/meta-leadgen-inbox";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { verifyMetaSchedulerRequest } from "@/lib/server/meta-scheduler-auth";
import { processAgentKnowledgeJobs } from "@/lib/server/agent-knowledge-processing";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const INBOX_BATCH_SIZE = 5;
const MAX_INBOX_ROUNDS = 10;
const MAINTENANCE_BUDGET_MS = 45_000;

function emptyInboxResult(): MetaLeadgenInboxProcessResult {
  return {
    claimed: 0,
    completed: 0,
    retrying: 0,
    deadLetter: 0,
    reviewRequired: 0,
    claimLost: 0,
    errors: 0,
  };
}

function mergeInboxResult(
  total: MetaLeadgenInboxProcessResult,
  batch: MetaLeadgenInboxProcessResult,
): void {
  total.claimed += batch.claimed;
  total.completed += batch.completed;
  total.retrying += batch.retrying;
  total.deadLetter += batch.deadLetter;
  total.reviewRequired += batch.reviewRequired;
  total.claimLost += batch.claimLost;
  total.errors += batch.errors;
}

async function drainMetaLeadgenInbox(): Promise<MetaLeadgenInboxProcessResult> {
  const startedAt = Date.now();
  const total = emptyInboxResult();

  for (let round = 0; round < MAX_INBOX_ROUNDS; round += 1) {
    if (Date.now() - startedAt >= MAINTENANCE_BUDGET_MS) break;
    const batch = await processMetaLeadgenInbox({ limit: INBOX_BATCH_SIZE });
    mergeInboxResult(total, batch);
    if (batch.claimed < INBOX_BATCH_SIZE) break;
  }

  return total;
}

async function runMetaMaintenance(params: { runId: string; leaseToken: string }): Promise<void> {
  const [inboxResult, healthResult, knowledgeResult] = await Promise.allSettled([
    drainMetaLeadgenInbox(),
    reconcileMetaLeadConnections({
      sb: createSupabaseServiceClient(),
      limit: 50,
    }),
    processAgentKnowledgeJobs({ limit: 2 }),
  ]);

  if (inboxResult.status === "fulfilled") {
    console.info("[meta-maintenance] inbox_completed", inboxResult.value);
  } else {
    console.error("[meta-maintenance] inbox_failed", {
      error:
        inboxResult.reason instanceof Error
          ? inboxResult.reason.message
          : "meta_inbox_maintenance_failed",
    });
  }

  if (healthResult.status === "fulfilled") {
    console.info("[meta-maintenance] health_completed", {
      checked: healthResult.value.checked,
      ready: healthResult.value.ready,
      degraded: healthResult.value.degraded,
      action_required: healthResult.value.actionRequired,
      grants_checked: healthResult.value.grantsChecked,
      pages_discovered: healthResult.value.pagesDiscovered,
    });
  } else {
    console.error("[meta-maintenance] health_failed", {
      error:
        healthResult.reason instanceof Error
          ? healthResult.reason.message
          : "meta_health_maintenance_failed",
    });
  }

  if (knowledgeResult.status === "fulfilled") {
    console.info("[agent-knowledge] maintenance_completed", knowledgeResult.value);
  } else {
    console.error("[agent-knowledge] maintenance_failed", {
      error:
        knowledgeResult.reason instanceof Error
          ? knowledgeResult.reason.message
          : "knowledge_maintenance_failed",
    });
  }

  const inbox = inboxResult.status === "fulfilled" ? inboxResult.value : emptyInboxResult();
  const health = healthResult.status === "fulfilled" ? healthResult.value : null;
  const status = inboxResult.status === "fulfilled" && healthResult.status === "fulfilled" && knowledgeResult.status === "fulfilled"
    ? "completed"
    : inboxResult.status === "rejected" && healthResult.status === "rejected" && knowledgeResult.status === "rejected"
      ? "failed"
      : "partial";
  const sb = createSupabaseServiceClient();
  const { error: finishError } = await sb.rpc("finish_meta_maintenance_run_v2", {
    p_run_id: params.runId,
    p_lease_token: params.leaseToken,
    p_status: status,
    p_inbox_claimed: inbox.claimed,
    p_inbox_completed: inbox.completed,
    p_inbox_retrying: inbox.retrying,
    p_inbox_dead_letter: inbox.deadLetter,
    p_inbox_review_required: inbox.reviewRequired,
    p_inbox_claim_lost: inbox.claimLost,
    p_inbox_errors: inbox.errors,
    p_health_checked: health?.checked ?? 0,
    p_health_ready: health?.ready ?? 0,
    p_health_degraded: health?.degraded ?? 0,
    p_health_action_required: health?.actionRequired ?? 0,
    p_grants_checked: health?.grantsChecked ?? 0,
    p_pages_discovered: health?.pagesDiscovered ?? 0,
    p_inbox_error_code: inboxResult.status === "rejected" ? "inbox_maintenance_failed" : null,
    p_health_error_code: healthResult.status === "rejected" ? "health_maintenance_failed" : null,
  });
  if (finishError) console.error("[meta-maintenance] finish_failed", { error: finishError.message });
}

export async function POST(request: Request) {
  const auth = verifyMetaSchedulerRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      {
        error:
          auth.status === 503
            ? "Scheduler não configurado."
            : "Não autorizado.",
      },
      { status: auth.status },
    );
  }

  const sb = createSupabaseServiceClient();
  const { data: claimRows, error: claimError } = await sb.rpc(
    "claim_meta_maintenance_request",
    {
      p_nonce: auth.nonce,
      p_issued_at: auth.issuedAt,
      p_clock_skew_seconds: 120,
      p_lease_seconds: 55,
    },
  );
  const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
  if (claimError || !claim || claim.accepted !== true || !claim.run_id || !claim.lease_token) {
    return NextResponse.json(
      { ok: true, accepted: false, reason: claimError?.message ?? claim?.code ?? "lease_unavailable" },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  }
  waitUntil(runMetaMaintenance({ runId: claim.run_id, leaseToken: claim.lease_token }));
  return NextResponse.json(
    { ok: true, accepted: true },
    {
      status: 202,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
