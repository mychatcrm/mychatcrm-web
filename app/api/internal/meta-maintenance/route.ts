import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";
import { reconcileMetaLeadConnections } from "@/lib/server/meta-lead-connection-reconciler";
import {
  processMetaLeadgenInbox,
  type MetaLeadgenInboxProcessResult,
} from "@/lib/server/meta-leadgen-inbox";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { verifyMetaSchedulerRequest } from "@/lib/server/meta-scheduler-auth";

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

async function runMetaMaintenance(): Promise<void> {
  const [inboxResult, healthResult] = await Promise.allSettled([
    drainMetaLeadgenInbox(),
    reconcileMetaLeadConnections({
      sb: createSupabaseServiceClient(),
      limit: 50,
    }),
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

  waitUntil(runMetaMaintenance());
  return NextResponse.json(
    { ok: true, accepted: true },
    {
      status: 202,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
