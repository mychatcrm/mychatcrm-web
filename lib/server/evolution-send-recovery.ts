import {
  evolutionFetchInstances,
  evolutionRestartInstance,
  evolutionSendText,
  isEvolutionConnectionClosedError,
  pickEvolutionInstanceInfo,
} from "@/lib/integrations/evolution-api";

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

/**
 * Retries only the explicit Evolution "Connection Closed" failure. The retry
 * happens after a successful restart and a positive inventory check, avoiding
 * duplicate sends for ambiguous HTTP/network failures.
 */
export async function sendEvolutionTextWithConnectionRecovery(
  params: SendTextParams,
): Promise<EvolutionRecoveredSendResult> {
  const first = await evolutionSendText(params);
  if (first.ok || !isEvolutionConnectionClosedError(first.error)) {
    return {
      ...first,
      attempts: 1,
      recoveryAttempted: false,
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

  await sleep(2500);
  const inventory = await evolutionFetchInstances(params.instanceName);
  const info = inventory.ok
    ? pickEvolutionInstanceInfo(inventory.data, params.instanceName)
    : null;
  if (!inventory.ok || info?.connectionStatus !== "open" || !info.ownerJid) {
    const error = inventory.ok
      ? "evolution_connection_recovery_not_open"
      : `evolution_connection_recovery_inventory_failed: ${inventory.error}`;
    console.error("[evolution-send-recovery] restart_unverified", {
      instance_name: params.instanceName,
      inventory_status: inventory.status,
      connection_status: info?.connectionStatus ?? null,
      has_owner_jid: Boolean(info?.ownerJid),
      error,
    });
    return {
      ok: false,
      status: inventory.ok ? 409 : inventory.status,
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
  });
  return {
    ...retry,
    attempts: 2,
    recoveryAttempted: true,
    restarted: true,
  };
}
