import "server-only";

import {
  buildEvolutionInstanceName,
  evolutionFetchInstances,
  type EvolutionInstanceInfo,
} from "@/lib/integrations/evolution-api";
import {
  getEvolutionInstanceByIdForTenant,
  getEvolutionInstanceByName,
  type TenantEvolutionInstanceRow,
  upsertTenantEvolutionInstance,
} from "@/lib/server/tenant-evolution-instance-db";

export type LiveEvolutionConnectionResolution =
  | {
      ok: true;
      instance: TenantEvolutionInstanceRow;
      adoptedSibling: boolean;
    }
  | {
      ok: false;
      instance: TenantEvolutionInstanceRow | null;
      reason:
        | "connection_not_found"
        | "inventory_unavailable"
        | "connection_not_open"
        | "ambiguous_connected_siblings"
        | "connected_sibling_already_bound"
        | "reconciliation_failed";
    };

function isConnected(info: EvolutionInstanceInfo): info is EvolutionInstanceInfo & {
  name: string;
  ownerJid: string;
} {
  return info.connectionStatus === "open" && Boolean(info.name && info.ownerJid);
}

/**
 * Resolves the live Evolution instance behind a stable connection UUID.
 *
 * A reset can create a fresh remote instance name while preserving the logical
 * tenant/slot row used by lead rules. If persistence is interrupted, the row
 * can keep pointing at the disconnected predecessor. We only self-heal when
 * exactly one authenticated sibling exists for the deterministic slot prefix.
 */
export async function reconcileLiveEvolutionInstance(
  row: TenantEvolutionInstanceRow,
): Promise<LiveEvolutionConnectionResolution> {
  const inventory = await evolutionFetchInstances();
  if (!inventory.ok) {
    return { ok: false, instance: row, reason: "inventory_unavailable" };
  }

  const exact = inventory.data.find((item) => item.name === row.instance_name) ?? null;
  if (exact && isConnected(exact)) {
    if (row.connection_state === "open" && row.wa_jid === exact.ownerJid) {
      return { ok: true, instance: row, adoptedSibling: false };
    }
    try {
      const refreshed = await upsertTenantEvolutionInstance({
        tenantId: row.tenant_id,
        slotIndex: row.slot_index,
        instanceName: row.instance_name,
        connectionState: "open",
        waJid: exact.ownerJid,
        defaultAgentId: row.default_agent_id,
      });
      return { ok: true, instance: refreshed, adoptedSibling: false };
    } catch (error) {
      console.error("[evolution-instance-reconciliation] refresh_failed", {
        tenant_id: row.tenant_id,
        connection_id: row.id,
        slot_index: row.slot_index,
        error: error instanceof Error ? error.message : String(error),
      });
      return { ok: false, instance: row, reason: "reconciliation_failed" };
    }
  }

  const slotPrefix = buildEvolutionInstanceName(row.tenant_id, row.slot_index);
  const connectedSiblings = inventory.data
    .filter(isConnected)
    .filter((item) => item.name.startsWith(slotPrefix));

  if (connectedSiblings.length === 0) {
    return { ok: false, instance: row, reason: "connection_not_open" };
  }
  if (connectedSiblings.length > 1) {
    console.error("[evolution-instance-reconciliation] ambiguous_connected_siblings", {
      tenant_id: row.tenant_id,
      connection_id: row.id,
      slot_index: row.slot_index,
      count: connectedSiblings.length,
    });
    return { ok: false, instance: row, reason: "ambiguous_connected_siblings" };
  }

  const sibling = connectedSiblings[0];
  try {
    const alreadyBound = await getEvolutionInstanceByName(sibling.name);
    if (alreadyBound && alreadyBound.id !== row.id) {
      console.error("[evolution-instance-reconciliation] connected_sibling_already_bound", {
        tenant_id: row.tenant_id,
        connection_id: row.id,
        slot_index: row.slot_index,
        sibling_connection_id: alreadyBound.id,
      });
      return { ok: false, instance: row, reason: "connected_sibling_already_bound" };
    }

    const adopted = await upsertTenantEvolutionInstance({
      tenantId: row.tenant_id,
      slotIndex: row.slot_index,
      instanceName: sibling.name,
      connectionState: "open",
      waJid: sibling.ownerJid,
      defaultAgentId: row.default_agent_id,
    });
    console.warn("[evolution-instance-reconciliation] connected_sibling_adopted", {
      tenant_id: row.tenant_id,
      connection_id: row.id,
      slot_index: row.slot_index,
      previous_instance_name: row.instance_name,
      instance_name: sibling.name,
    });
    return { ok: true, instance: adopted, adoptedSibling: true };
  } catch (error) {
    console.error("[evolution-instance-reconciliation] reconciliation_failed", {
      tenant_id: row.tenant_id,
      connection_id: row.id,
      slot_index: row.slot_index,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, instance: row, reason: "reconciliation_failed" };
  }
}

export async function resolveLiveEvolutionInstanceByIdForTenant(
  tenantId: string,
  connectionId: string,
): Promise<LiveEvolutionConnectionResolution> {
  try {
    const row = await getEvolutionInstanceByIdForTenant(tenantId, connectionId);
    if (!row) return { ok: false, instance: null, reason: "connection_not_found" };
    return await reconcileLiveEvolutionInstance(row);
  } catch (error) {
    console.error("[evolution-instance-reconciliation] lookup_failed", {
      tenant_id: tenantId,
      connection_id: connectionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, instance: null, reason: "reconciliation_failed" };
  }
}
