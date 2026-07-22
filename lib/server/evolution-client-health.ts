import "server-only";

import {
  evolutionConnectionState,
  evolutionEnsureClientInstanceSettings,
  evolutionEnsureWebhook,
  evolutionFetchInstances,
  evolutionRestartInstance,
  normalizeEvolutionConnectionState,
  parseEvolutionConnectionStatePayload,
  pickEvolutionInstanceInfo,
} from "@/lib/integrations/evolution-api";
import { reconcileLiveEvolutionInstance } from "@/lib/server/evolution-instance-reconciliation";
import {
  isEvolutionLifecycleState,
  listOpenEvolutionInstances,
  type TenantEvolutionInstanceRow,
} from "@/lib/server/tenant-evolution-instance-db";

export type EvolutionClientHealthResult = {
  checked: boolean;
  healthy: boolean;
  settingsReapplied: boolean;
  settingsVerified: boolean;
  webhookReapplied: boolean;
  webhookVerified: boolean;
  restarted: boolean;
  identityVerified: boolean;
  error: string | null;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function verifyAuthenticatedIdentity(
  instanceName: string,
  expectedOwnerJid: string | null,
): Promise<boolean> {
  const [state, inventory] = await Promise.all([
    evolutionConnectionState(instanceName),
    evolutionFetchInstances(instanceName),
  ]);
  if (!state.ok || !inventory.ok) return false;
  const normalized = normalizeEvolutionConnectionState(
    parseEvolutionConnectionStatePayload(state.data),
    "unknown",
  );
  const info = pickEvolutionInstanceInfo(inventory.data, instanceName);
  if (normalized !== "open" || !info?.ownerJid) return false;
  return !expectedOwnerJid || info.ownerJid === expectedOwnerJid;
}

async function waitForAuthenticatedIdentity(
  instanceName: string,
  expectedOwnerJid: string | null,
): Promise<boolean> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await verifyAuthenticatedIdentity(instanceName, expectedOwnerJid)) return true;
    if (attempt < 7) await wait(1_500);
  }
  return false;
}

/**
 * Repara somente settings e webhook. Nunca faz logout, remove ou recria a
 * instância; o restart opcional é reservado à manutenção explicitamente
 * autorizada e só acontece quando o setting precisou ser corrigido.
 */
export async function reconcileEvolutionClientHealth(params: {
  row: TenantEvolutionInstanceRow;
  webhookUrl: string;
  restartIfSettingsChanged?: boolean;
}): Promise<EvolutionClientHealthResult> {
  const base: EvolutionClientHealthResult = {
    checked: false,
    healthy: false,
    settingsReapplied: false,
    settingsVerified: false,
    webhookReapplied: false,
    webhookVerified: false,
    restarted: false,
    identityVerified: false,
    error: null,
  };
  if (isEvolutionLifecycleState(params.row.connection_state)) {
    return { ...base, error: "lifecycle_operation_in_progress" };
  }

  try {
    const live = await reconcileLiveEvolutionInstance(params.row);
    if (!live.ok) return { ...base, checked: true, error: live.reason };
    const row = live.instance;
    const settings = await evolutionEnsureClientInstanceSettings(row.instance_name);
    const webhook = await evolutionEnsureWebhook({
      instanceName: row.instance_name,
      url: params.webhookUrl,
    });

    let restarted = false;
    let identityVerified = await verifyAuthenticatedIdentity(row.instance_name, row.wa_jid);
    if (
      params.restartIfSettingsChanged === true &&
      settings.reapplied &&
      settings.verified &&
      identityVerified
    ) {
      const restart = await evolutionRestartInstance(row.instance_name);
      if (!restart.ok) {
        return {
          ...base,
          checked: true,
          settingsReapplied: settings.reapplied,
          settingsVerified: settings.verified,
          webhookReapplied: webhook.reapplied,
          webhookVerified: webhook.reapplyOk,
          identityVerified,
          error: `restart_failed:${restart.status}`,
        };
      }
      restarted = true;
      identityVerified = await waitForAuthenticatedIdentity(row.instance_name, row.wa_jid);
      if (identityVerified) {
        const postRestartWebhook = await evolutionEnsureWebhook({
          instanceName: row.instance_name,
          url: params.webhookUrl,
        });
        webhook.reapplied ||= postRestartWebhook.reapplied;
        webhook.reapplyOk &&= postRestartWebhook.reapplyOk;
      }
    }

    const webhookVerified = webhook.healthy || webhook.reapplyOk;
    const healthy = settings.verified && webhookVerified && identityVerified;
    return {
      checked: true,
      healthy,
      settingsReapplied: settings.reapplied,
      settingsVerified: settings.verified,
      webhookReapplied: webhook.reapplied,
      webhookVerified,
      restarted,
      identityVerified,
      error: healthy ? null : "health_verification_failed",
    };
  } catch (error) {
    return {
      ...base,
      checked: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function reconcileOpenEvolutionClientHealth(params: {
  webhookUrl: string;
  afterId?: string | null;
  limit?: number;
  maxBatches?: number;
  restartIfSettingsChanged?: boolean;
  onlyConnectionId?: string | null;
}): Promise<{
  checked: number;
  healthy: number;
  corrected: number;
  restarted: number;
  failed: number;
  nextCursor: string | null;
}> {
  const results = [] as EvolutionClientHealthResult[];
  const limit = params.limit ?? 50;
  const maxBatches = Math.max(1, Math.min(20, Math.trunc(params.maxBatches ?? 10)));
  let cursor = params.afterId ?? null;
  let nextCursor: string | null = null;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const rows = await listOpenEvolutionInstances({ afterId: cursor, limit });
    const selected = params.onlyConnectionId
      ? rows.filter((row) => row.id === params.onlyConnectionId)
      : rows;
    for (const row of selected) {
      results.push(
        await reconcileEvolutionClientHealth({
          row,
          webhookUrl: params.webhookUrl,
          restartIfSettingsChanged: params.restartIfSettingsChanged,
        }),
      );
    }
    if (params.onlyConnectionId && selected.length > 0) {
      nextCursor = null;
      break;
    }
    if (rows.length < limit) {
      nextCursor = null;
      break;
    }
    cursor = rows.at(-1)?.id ?? null;
    nextCursor = cursor;
    if (!cursor) break;
  }
  return {
    checked: results.filter((result) => result.checked).length,
    healthy: results.filter((result) => result.healthy).length,
    corrected: results.filter(
      (result) => result.settingsReapplied || result.webhookReapplied,
    ).length,
    restarted: results.filter((result) => result.restarted).length,
    failed: results.filter((result) => !result.healthy).length,
    nextCursor,
  };
}
