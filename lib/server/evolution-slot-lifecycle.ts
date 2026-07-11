import "server-only";

import {
  buildFreshEvolutionInstanceName,
  evolutionRemoveInstanceCompletely,
  type EvolutionInstancePresence,
} from "@/lib/integrations/evolution-api";
import {
  claimTenantEvolutionInstanceLifecycle,
  finalizeTenantEvolutionInstanceRemoval,
  getEvolutionInstanceByTenantSlot,
  isEvolutionLifecycleState,
  type EvolutionLifecycleState,
  type TenantEvolutionInstanceRow,
} from "@/lib/server/tenant-evolution-instance-db";

export type EvolutionSlotRemovalMode = Extract<EvolutionLifecycleState, "deleting" | "resetting">;

export type EvolutionSlotRemovalResult =
  | { state: "missing"; row: null; operation: EvolutionSlotRemovalMode }
  | {
      state: "busy";
      row: TenantEvolutionInstanceRow;
      operation: EvolutionLifecycleState;
      error: "lifecycle_operation_in_progress";
    }
  | {
      state: "pending";
      row: TenantEvolutionInstanceRow;
      operation: EvolutionSlotRemovalMode;
      presence: EvolutionInstancePresence["state"];
      evolutionStatus: number | null;
      error: string | null;
    }
  | {
      state: "complete";
      row: TenantEvolutionInstanceRow;
      operation: EvolutionSlotRemovalMode;
      previousInstanceName: string;
      previousWaJid: string | null;
      finalized: boolean;
    };

// Prevents overlapping serverless polls while one request is waiting for the
// asynchronous Evolution cleanup to finish.
const OPERATION_LEASE_MS = 20_000;

function operationAgeMs(row: TenantEvolutionInstanceRow): number {
  const updatedAt = Date.parse(row.updated_at);
  return Number.isFinite(updatedAt) ? Math.max(0, Date.now() - updatedAt) : OPERATION_LEASE_MS;
}

async function acquireRemovalLease(params: {
  row: TenantEvolutionInstanceRow;
  mode: EvolutionSlotRemovalMode;
}): Promise<{ acquired: boolean; row: TenantEvolutionInstanceRow }> {
  const { row, mode } = params;
  if (isEvolutionLifecycleState(row.connection_state)) {
    if (row.connection_state !== mode || operationAgeMs(row) < OPERATION_LEASE_MS) {
      return { acquired: false, row };
    }
    const renewed = await claimTenantEvolutionInstanceLifecycle({
      tenantId: row.tenant_id,
      slotIndex: row.slot_index,
      instanceName: row.instance_name,
      expectedConnectionState: mode,
      expectedUpdatedAt: row.updated_at,
      lifecycleState: mode,
    });
    return { acquired: Boolean(renewed), row: renewed ?? row };
  }

  const claimed = await claimTenantEvolutionInstanceLifecycle({
    tenantId: row.tenant_id,
    slotIndex: row.slot_index,
    instanceName: row.instance_name,
    expectedConnectionState: row.connection_state,
    lifecycleState: mode,
  });
  return { acquired: Boolean(claimed), row: claimed ?? row };
}

/**
 * Starts or resumes a tenant QR slot removal. It never clears the logical row
 * until the Evolution inventory positively proves that the old instance is gone.
 */
export async function removeEvolutionSlotSafely(params: {
  tenantId: string;
  slotIndex: number;
  mode: EvolutionSlotRemovalMode;
}): Promise<EvolutionSlotRemovalResult> {
  let row = await getEvolutionInstanceByTenantSlot(params.tenantId, params.slotIndex);
  if (!row) return { state: "missing", row: null, operation: params.mode };

  if (isEvolutionLifecycleState(row.connection_state) && row.connection_state !== params.mode) {
    return {
      state: "busy",
      row,
      operation: row.connection_state,
      error: "lifecycle_operation_in_progress",
    };
  }

  const lease = await acquireRemovalLease({ row, mode: params.mode });
  row = lease.row;
  if (!lease.acquired) {
    const current = await getEvolutionInstanceByTenantSlot(params.tenantId, params.slotIndex);
    if (current && current.connection_state === params.mode) {
      return {
        state: "pending",
        row: current,
        operation: params.mode,
        presence: "unknown",
        evolutionStatus: null,
        error: null,
      };
    }
    return {
      state: "busy",
      row: current ?? row,
      operation: isEvolutionLifecycleState(current?.connection_state)
        ? current.connection_state
        : params.mode,
      error: "lifecycle_operation_in_progress",
    };
  }

  const previousInstanceName = row.instance_name;
  const removal = await evolutionRemoveInstanceCompletely(previousInstanceName, {
    verificationDelaysMs: [0, 500, 1_000, 2_000, 4_000, 8_000],
    retryDeleteDelayMs: 500,
  });
  if (!removal.verifiedAbsent) {
    return {
      state: "pending",
      row,
      operation: params.mode,
      presence: removal.presence,
      evolutionStatus: removal.status,
      error: removal.error,
    };
  }

  const nextInstanceName = buildFreshEvolutionInstanceName(params.tenantId, params.slotIndex);
  const finalized = await finalizeTenantEvolutionInstanceRemoval({
    tenantId: params.tenantId,
    slotIndex: params.slotIndex,
    previousInstanceName,
    lifecycleState: params.mode,
    nextInstanceName,
  });
  if (finalized) {
    return {
      state: "complete",
      row: finalized,
      operation: params.mode,
      previousInstanceName,
      previousWaJid: row.wa_jid,
      finalized: true,
    };
  }

  const current = await getEvolutionInstanceByTenantSlot(params.tenantId, params.slotIndex);
  if (current && current.instance_name !== previousInstanceName && !isEvolutionLifecycleState(current.connection_state)) {
    return {
      state: "complete",
      row: current,
      operation: params.mode,
      previousInstanceName,
      previousWaJid: row.wa_jid,
      finalized: false,
    };
  }

  return {
    state: "busy",
    row: current ?? row,
    operation: isEvolutionLifecycleState(current?.connection_state)
      ? current.connection_state
      : params.mode,
    error: "lifecycle_operation_in_progress",
  };
}
