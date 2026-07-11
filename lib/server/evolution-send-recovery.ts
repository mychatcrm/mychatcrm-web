import {
  evolutionFetchInstances,
  evolutionRestartInstance,
  evolutionSendText,
  isEvolutionConnectionClosedError,
  pickEvolutionInstanceInfo,
} from "@/lib/integrations/evolution-api";
import {
  getEvolutionInstanceByName,
  isEvolutionLifecycleState,
} from "@/lib/server/tenant-evolution-instance-db";

type SendTextParams = Parameters<typeof evolutionSendText>[0];
type SendTextResult = Awaited<ReturnType<typeof evolutionSendText>>;

export type EvolutionRecoveredSendResult = SendTextResult & {
  attempts: number;
  recoveryAttempted: boolean;
  restarted: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RECOVERY_POLL_ATTEMPTS = 6;
const RECOVERY_POLL_INTERVAL_MS = 2_000;

async function readLifecycleLock(instanceName: string): Promise<"locked" | "unlocked" | "unknown"> {
  try {
    const row = await getEvolutionInstanceByName(instanceName);
    return isEvolutionLifecycleState(row?.connection_state) ? "locked" : "unlocked";
  } catch (error) {
    console.warn("[evolution-send-recovery] lifecycle_lookup_failed", {
      instance_name: instanceName,
      error: error instanceof Error ? error.message : String(error),
    });
    return "unknown";
  }
}

/**
 * Retries only the explicit Evolution "Connection Closed" failure. The retry
 * happens after a successful restart and a positive inventory check, avoiding
 * duplicate sends for ambiguous HTTP/network failures.
 */
export async function sendEvolutionTextWithConnectionRecovery(
  params: SendTextParams,
): Promise<EvolutionRecoveredSendResult> {
  const lifecycleBeforeSend = await readLifecycleLock(params.instanceName);
  if (lifecycleBeforeSend === "locked") {
    return {
      ok: false,
      status: 409,
      error: "evolution_lifecycle_operation_in_progress",
      attempts: 0,
      recoveryAttempted: false,
      restarted: false,
    };
  }

  const first = await evolutionSendText(params);
  if (first.ok || !isEvolutionConnectionClosedError(first.error)) {
    return {
      ...first,
      attempts: 1,
      recoveryAttempted: false,
      restarted: false,
    };
  }

  // Never revive an instance after a disconnect/reset acquired the slot lock.
  // If the database cannot confirm the lock state, fail closed for restart.
  const lifecycleBeforeRestart = await readLifecycleLock(params.instanceName);
  if (lifecycleBeforeRestart !== "unlocked") {
    return {
      ok: false,
      status: 409,
      error:
        lifecycleBeforeRestart === "locked"
          ? "evolution_lifecycle_operation_in_progress"
          : "evolution_lifecycle_state_unavailable",
      attempts: 1,
      recoveryAttempted: true,
      restarted: false,
    };
  }

  const restart = await evolutionRestartInstance(params.instanceName);
  if (!restart.ok) {
    console.error("[evolution-send-recovery] restart_failed", {
      instance_name: params.instanceName,
      status: restart.status,
      error: restart.error,
    });
    return {
      ...first,
      attempts: 1,
      recoveryAttempted: true,
      restarted: false,
    };
  }

  let verifiedOpen = false;
  let inventoryStatus = 0;
  let inventoryError: string | null = null;
  let connectionStatus: string | null = null;
  let hasOwnerJid = false;
  let pollAttempts = 0;

  for (let attempt = 1; attempt <= RECOVERY_POLL_ATTEMPTS; attempt += 1) {
    pollAttempts = attempt;
    await sleep(RECOVERY_POLL_INTERVAL_MS);
    const inventory = await evolutionFetchInstances(params.instanceName);
    inventoryStatus = inventory.status;
    if (!inventory.ok) {
      inventoryError = inventory.error;
      continue;
    }

    inventoryError = null;
    const info = pickEvolutionInstanceInfo(inventory.data, params.instanceName);
    connectionStatus = info?.connectionStatus ?? null;
    hasOwnerJid = Boolean(info?.ownerJid);
    if (connectionStatus === "open" && hasOwnerJid) {
      verifiedOpen = true;
      break;
    }
  }

  if (!verifiedOpen) {
    const error = inventoryError
      ? `evolution_connection_recovery_inventory_failed: ${inventoryError}`
      : "evolution_connection_recovery_not_open";
    console.error("[evolution-send-recovery] restart_unverified", {
      instance_name: params.instanceName,
      inventory_status: inventoryStatus,
      connection_status: connectionStatus,
      has_owner_jid: hasOwnerJid,
      poll_attempts: pollAttempts,
      error,
    });
    return {
      ok: false,
      status: inventoryError ? inventoryStatus : 409,
      error,
      attempts: 1,
      recoveryAttempted: true,
      restarted: true,
    };
  }

  const retry = await evolutionSendText(params);
  console.info("[evolution-send-recovery] retry_completed", {
    instance_name: params.instanceName,
    ok: retry.ok,
    status: retry.status,
    poll_attempts: pollAttempts,
  });
  return {
    ...retry,
    attempts: 2,
    recoveryAttempted: true,
    restarted: true,
  };
}
