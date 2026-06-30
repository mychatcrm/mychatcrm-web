import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import {
  extractPairingCodeFromConnectPayload,
  normalizeInstanceConnectToQrDataUrl,
} from "@/lib/integrations/evolution-connect-qr";
import { buildEvolutionWebhookUrl, getPublicBaseUrlFromRequest } from "@/lib/integrations/evolution-webhook-url";
import { extractInstanceJid } from "@/lib/integrations/evolution-webhook-parse";
import {
  buildEvolutionInstanceName,
  buildFreshEvolutionInstanceName,
  checkEvolutionSessionAlive,
  evolutionConnectionState,
  evolutionCreateInstance,
  evolutionFetchInstances,
  evolutionGetInstancePresence,
  evolutionInstanceConnect,
  evolutionRemoveInstanceCompletely,
  evolutionRestartInstance,
  evolutionSetWebhook,
  isEvolutionApiConfigured,
  normalizeEvolutionConnectionState,
  parseEvolutionConnectionStatePayload,
  pickEvolutionInstanceInfo,
} from "@/lib/integrations/evolution-api";
import {
  SYSTEM_AGENT_ID,
  SYSTEM_SLOT_INDEX,
  SYSTEM_TENANT_ID,
  resetSystemAgentEvolutionBinding,
} from "@/lib/server/system-agent";
import {
  deleteTenantEvolutionInstanceRowIfName,
  finalizeTenantEvolutionInstanceReservation,
  getEvolutionInstanceByTenantSlot,
  reserveTenantEvolutionInstance,
  updateEvolutionInstanceStateByName,
  upsertTenantEvolutionInstance,
} from "@/lib/server/tenant-evolution-instance-db";

export const dynamic = "force-dynamic";

function displayConnectionState(connectionState: string, authenticated: boolean): string {
  if (connectionState === "open" && !authenticated) return "connecting";
  return connectionState;
}

function buildFreshSystemInstanceName(): string {
  return buildFreshEvolutionInstanceName(SYSTEM_TENANT_ID, SYSTEM_SLOT_INDEX);
}

function isRecentLifecycleOperation(connectionState: string, updatedAt: string): boolean {
  if (connectionState !== "provisioning" && connectionState !== "deleting") return false;
  const updatedAtMs = Date.parse(updatedAt);
  return Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs < 2 * 60 * 1000;
}

function assertAdminSystemAgent(session: Awaited<ReturnType<typeof getAdminSessionFromCookies>>) {
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "system-agent")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }
  return null;
}

async function resolveSystemInstanceIdentity(
  instanceName: string,
  fallbackState: string | null,
  fallbackJid: string | null,
): Promise<{ connectionState: string; waJid: string | null; profileName: string | null; authenticated: boolean }> {
  const identity = await evolutionFetchInstances(instanceName);
  const info = identity.ok ? pickEvolutionInstanceInfo(identity.data, instanceName) : null;

  const stateRes = await evolutionConnectionState(instanceName);
  const connStateRaw = stateRes.ok ? parseEvolutionConnectionStatePayload(stateRes.data) : undefined;

  const connectionState = normalizeEvolutionConnectionState(
    info?.connectionStatus ?? connStateRaw,
    normalizeEvolutionConnectionState(fallbackState ?? "close", "close"),
  );

  const jidFromState =
    stateRes.ok && stateRes.data ? extractInstanceJid(stateRes.data as Record<string, unknown>) : null;
  const waJid = info?.ownerJid ?? jidFromState ?? fallbackJid ?? null;
  let authenticated = connectionState === "open" && Boolean(info?.ownerJid ?? jidFromState);

  // Health check real: verifica se a sessão Baileys tem chaves na tabela Session.
  // ownerJid presente no Instance table não garante isso — daí a zombie session:
  // connectionStatus=open + ownerJid setado mas Session table vazia → ERROR em todos os envios.
  if (authenticated && waJid) {
    const digits = waJid.split("@")[0] ?? "";
    if (digits.length >= 8) {
      const alive = await checkEvolutionSessionAlive(instanceName, digits);
      if (!alive) authenticated = false;
    }
  }

  return { connectionState, waJid, profileName: info?.profileName ?? null, authenticated };
}

async function rollbackProvisionedSystemInstance(instanceName: string): Promise<{
  verifiedAbsent: boolean;
  error: string | null;
}> {
  const removal = await evolutionRemoveInstanceCompletely(instanceName);
  if (removal.verifiedAbsent) {
    await deleteTenantEvolutionInstanceRowIfName(
      SYSTEM_TENANT_ID,
      SYSTEM_SLOT_INDEX,
      instanceName,
    );
    return { verifiedAbsent: true, error: null };
  }

  await updateEvolutionInstanceStateByName({
    instanceName,
    connectionState: "provisioning_failed",
    waJid: null,
  }).catch(() => null);
  return {
    verifiedAbsent: false,
    error: removal.error ?? "rollback_not_verified",
  };
}

/** Sessão Baileys nova: apaga órfãs/número antigo, cria instância fresh e devolve QR. */
async function provisionFreshSystemEvolutionSession(request: Request) {
  const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    return NextResponse.json({ error: "EVOLUTION_WEBHOOK_SECRET em falta." }, { status: 503 });
  }

  const reset = await resetSystemAgentEvolutionBinding();
  if (
    !reset.inventoryVerified ||
    !reset.currentInstanceRemoved ||
    reset.failedInstances.length > 0 ||
    !reset.databaseBindingCleared
  ) {
    const hasConfirmedPresent = reset.failedInstances.some((item) => item.presence === "present");
    return NextResponse.json(
      {
        error: hasConfirmedPresent
          ? "Ainda existe uma instância antiga do agente do sistema na Evolution."
          : "Não foi possível confirmar a remoção da instância antiga na Evolution.",
        code: hasConfirmedPresent
          ? "system_evolution_instance_still_present"
          : "system_evolution_inventory_unavailable",
        inventoryVerified: reset.inventoryVerified,
        currentInstanceRemoved: reset.currentInstanceRemoved,
        databaseBindingCleared: reset.databaseBindingCleared,
        failedInstances: reset.failedInstances,
        detail: reset.error,
      },
      { status: hasConfirmedPresent ? 409 : 502 },
    );
  }

  const instanceName = buildFreshSystemInstanceName();
  const publicBase = getPublicBaseUrlFromRequest(request);
  const webhookUrl = buildEvolutionWebhookUrl(publicBase, webhookSecret);

  let reservation;
  try {
    reservation = await reserveTenantEvolutionInstance({
      tenantId: SYSTEM_TENANT_ID,
      slotIndex: SYSTEM_SLOT_INDEX,
      instanceName,
      defaultAgentId: SYSTEM_AGENT_ID,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Não foi possível reservar a conexão do agente do sistema.",
        detail: error instanceof Error ? error.message : "reservation_failed",
      },
      { status: 503 },
    );
  }

  if (!reservation.reserved) {
    return NextResponse.json(
      {
        error: "Já existe uma operação de conexão em andamento.",
        code: "system_evolution_operation_in_progress",
        instanceName: reservation.row.instance_name,
        connectionState: reservation.row.connection_state,
      },
      { status: 409 },
    );
  }

  let createResult = await evolutionCreateInstance({
    instanceName,
    webhookUrl,
    settings: {
      groupsIgnore: true,
      readMessages: false,
      readStatus: false,
    },
  });
  if (!createResult.ok) {
    const presence = await evolutionGetInstancePresence(instanceName);
    if (presence.state === "present") {
      createResult = { ok: true, status: createResult.status, data: {} };
    } else {
      const rollback = await rollbackProvisionedSystemInstance(instanceName);
      return NextResponse.json(
        {
          error: "Falha ao criar instância na Evolution.",
          detail: createResult.error,
          rollbackVerified: rollback.verifiedAbsent,
          rollbackError: rollback.error,
        },
        { status: 502 },
      );
    }
  }

  const webhookResult = await evolutionSetWebhook({ instanceName, url: webhookUrl });
  if (!webhookResult.ok) {
    const rollback = await rollbackProvisionedSystemInstance(instanceName);
    return NextResponse.json(
      {
        error: "A instância foi criada, mas o webhook não pôde ser configurado.",
        detail: webhookResult.error,
        rollbackVerified: rollback.verifiedAbsent,
        rollbackError: rollback.error,
      },
      { status: 502 },
    );
  }

  const createdPresence = await evolutionGetInstancePresence(instanceName);
  if (createdPresence.state !== "present") {
    const rollback = await rollbackProvisionedSystemInstance(instanceName);
    return NextResponse.json(
      {
        error: "Não foi possível confirmar a nova instância no inventário da Evolution.",
        detail: createdPresence.error,
        presence: createdPresence.state,
        rollbackVerified: rollback.verifiedAbsent,
        rollbackError: rollback.error,
      },
      { status: 502 },
    );
  }

  const stateRes = await evolutionConnectionState(instanceName);
  const remoteState = normalizeEvolutionConnectionState(
    stateRes.ok ? parseEvolutionConnectionStatePayload(stateRes.data) : undefined,
    "close",
  );

  try {
    await finalizeTenantEvolutionInstanceReservation({
      tenantId: SYSTEM_TENANT_ID,
      slotIndex: SYSTEM_SLOT_INDEX,
      instanceName,
      connectionState: remoteState,
      waJid: null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const rollback = await rollbackProvisionedSystemInstance(instanceName);
    return NextResponse.json(
      {
        error: "Erro ao gravar instância do sistema.",
        detail: msg.slice(0, 400),
        rollbackVerified: rollback.verifiedAbsent,
        rollbackError: rollback.error,
      },
      { status: 503 },
    );
  }

  let responseState = remoteState;
  if (remoteState === "open") {
    const identity = await resolveSystemInstanceIdentity(instanceName, remoteState, null);
    responseState = displayConnectionState(identity.connectionState, identity.authenticated);
    await finalizeTenantEvolutionInstanceReservation({
      tenantId: SYSTEM_TENANT_ID,
      slotIndex: SYSTEM_SLOT_INDEX,
      instanceName,
      connectionState: identity.connectionState,
      waJid: identity.waJid,
    });
    if (identity.authenticated) {
      return NextResponse.json({
        instanceName,
        connectionState: responseState,
        qrDataUrl: null,
        pairingCode: null,
        waJid: identity.waJid ?? null,
        authenticated: true,
        profileName: identity.profileName,
        removedInstances: reset.removedInstances,
      });
    }
  }

  const connectRes = await evolutionInstanceConnect(instanceName);
  if (!connectRes.ok) {
    return NextResponse.json(
      {
        error: "A instância foi criada, mas o QR Code não pôde ser gerado.",
        instanceName,
        connectionState: responseState,
        qrDataUrl: null,
        pairingCode: null,
        waJid: null,
        detail: connectRes.error,
        removedInstances: reset.removedInstances,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    instanceName,
    connectionState: responseState,
    qrDataUrl: normalizeInstanceConnectToQrDataUrl(connectRes.data as unknown),
    pairingCode: extractPairingCodeFromConnectPayload(connectRes.data as unknown),
    waJid: null,
    removedInstances: reset.removedInstances,
  });
}

export async function POST(request: Request) {
  const session = await getAdminSessionFromCookies();
  const denied = assertAdminSystemAgent(session);
  if (denied) return denied;
  if (!isEvolutionApiConfigured()) {
    return NextResponse.json({ error: "Evolution API não configurada no servidor." }, { status: 503 });
  }

  const existingRow = await getEvolutionInstanceByTenantSlot(SYSTEM_TENANT_ID, SYSTEM_SLOT_INDEX);
  if (existingRow?.instance_name) {
    if (isRecentLifecycleOperation(existingRow.connection_state, existingRow.updated_at)) {
      return NextResponse.json(
        {
          error:
            existingRow.connection_state === "deleting"
              ? "A desconexão ainda está em andamento."
              : "A conexão ainda está sendo preparada.",
          code: "system_evolution_operation_in_progress",
          instanceName: existingRow.instance_name,
          connectionState: existingRow.connection_state,
        },
        { status: 409 },
      );
    }

    const identity = await resolveSystemInstanceIdentity(
      existingRow.instance_name,
      existingRow.connection_state,
      existingRow.wa_jid,
    );

    if (identity.authenticated) {
      const displayState = displayConnectionState(identity.connectionState, identity.authenticated);
      await upsertTenantEvolutionInstance({
        tenantId: SYSTEM_TENANT_ID,
        slotIndex: SYSTEM_SLOT_INDEX,
        instanceName: existingRow.instance_name,
        connectionState: identity.connectionState,
        waJid: identity.waJid,
        defaultAgentId: SYSTEM_AGENT_ID,
      });

      const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET?.trim();
      if (webhookSecret) {
        const publicBase = getPublicBaseUrlFromRequest(request);
        const webhookUrl = buildEvolutionWebhookUrl(publicBase, webhookSecret);
        await evolutionSetWebhook({ instanceName: existingRow.instance_name, url: webhookUrl }).catch(() => null);
      }

      return NextResponse.json({
        instanceName: existingRow.instance_name,
        connectionState: displayState,
        qrDataUrl: null,
        pairingCode: null,
        waJid: identity.waJid ?? null,
        authenticated: true,
        profileName: identity.profileName,
      });
    }
  }

  return provisionFreshSystemEvolutionSession(request);
}

export async function GET(request: Request) {
  const session = await getAdminSessionFromCookies();
  const denied = assertAdminSystemAgent(session);
  if (denied) return denied;
  if (!isEvolutionApiConfigured()) {
    return NextResponse.json({ error: "Evolution API não configurada no servidor." }, { status: 503 });
  }

  const url = new URL(request.url);
  const slotIndex = Number(url.searchParams.get("slotIndex") ?? SYSTEM_SLOT_INDEX);
  if (slotIndex !== SYSTEM_SLOT_INDEX) {
    return NextResponse.json({ error: "slotIndex inválido para agente do sistema." }, { status: 400 });
  }

  const row = await getEvolutionInstanceByTenantSlot(SYSTEM_TENANT_ID, SYSTEM_SLOT_INDEX);
  if (!row) {
    return NextResponse.json({
      instanceName: buildEvolutionInstanceName(SYSTEM_TENANT_ID, SYSTEM_SLOT_INDEX),
      connectionState: "none",
      qrDataUrl: null,
      pairingCode: null,
      waJid: null,
    });
  }

  if (row.connection_state === "provisioning" || row.connection_state === "deleting") {
    return NextResponse.json({
      instanceName: row.instance_name,
      connectionState: row.connection_state,
      qrDataUrl: null,
      pairingCode: null,
      waJid: row.wa_jid,
      operationPending: true,
    });
  }

  const identity = await resolveSystemInstanceIdentity(row.instance_name, row.connection_state, row.wa_jid);
  const displayState = displayConnectionState(identity.connectionState, identity.authenticated);

  await upsertTenantEvolutionInstance({
    tenantId: SYSTEM_TENANT_ID,
    slotIndex: SYSTEM_SLOT_INDEX,
    instanceName: row.instance_name,
    connectionState: identity.connectionState,
    waJid: identity.waJid,
    defaultAgentId: SYSTEM_AGENT_ID,
  });

  if (identity.connectionState === "open" && identity.authenticated) {
    return NextResponse.json({
      instanceName: row.instance_name,
      connectionState: displayState,
      qrDataUrl: null,
      pairingCode: null,
      waJid: identity.waJid ?? null,
      authenticated: identity.authenticated,
      profileName: identity.profileName,
    });
  }

  const connectRes = await evolutionInstanceConnect(row.instance_name);
  return NextResponse.json({
    instanceName: row.instance_name,
    connectionState: displayState,
    qrDataUrl: connectRes.ok ? normalizeInstanceConnectToQrDataUrl(connectRes.data as unknown) : null,
    pairingCode: connectRes.ok ? extractPairingCodeFromConnectPayload(connectRes.data as unknown) : null,
    waJid: identity.waJid ?? null,
    authenticated: identity.authenticated,
    profileName: identity.profileName,
  });
}

export async function PATCH(request: Request) {
  const session = await getAdminSessionFromCookies();
  const denied = assertAdminSystemAgent(session);
  if (denied) return denied;
  if (!isEvolutionApiConfigured()) {
    return NextResponse.json({ error: "Evolution API não configurada no servidor." }, { status: 503 });
  }

  let body: { action?: string } = {};
  try {
    body = (await request.json()) as { action?: string };
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const action = body.action?.trim();
  if (action !== "restart" && action !== "reconnect") {
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  }

  if (action === "reconnect") {
    return provisionFreshSystemEvolutionSession(request);
  }

  const row = await getEvolutionInstanceByTenantSlot(SYSTEM_TENANT_ID, SYSTEM_SLOT_INDEX);
  if (!row?.instance_name) {
    return NextResponse.json({ error: "Instância do sistema não configurada." }, { status: 404 });
  }

  const restart = await evolutionRestartInstance(row.instance_name);
  if (!restart.ok) {
    return NextResponse.json(
      { error: "Falha ao reiniciar sessão na Evolution.", detail: restart.error },
      { status: 502 },
    );
  }

  const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET?.trim();
  if (webhookSecret) {
    const publicBase = getPublicBaseUrlFromRequest(request);
    const webhookUrl = buildEvolutionWebhookUrl(publicBase, webhookSecret);
    await evolutionSetWebhook({ instanceName: row.instance_name, url: webhookUrl }).catch(() => null);
  }

  const identity = await resolveSystemInstanceIdentity(row.instance_name, row.connection_state, row.wa_jid);
  const displayState = displayConnectionState(identity.connectionState, identity.authenticated);

  await upsertTenantEvolutionInstance({
    tenantId: SYSTEM_TENANT_ID,
    slotIndex: SYSTEM_SLOT_INDEX,
    instanceName: row.instance_name,
    connectionState: identity.connectionState,
    waJid: identity.waJid,
    defaultAgentId: SYSTEM_AGENT_ID,
  });

  if (identity.connectionState === "open" && identity.authenticated) {
    return NextResponse.json({
      ok: true,
      connectionState: displayState,
      waJid: identity.waJid ?? null,
      authenticated: identity.authenticated,
    });
  }

  const connectRes = await evolutionInstanceConnect(row.instance_name);
  return NextResponse.json({
    ok: true,
    connectionState: displayState,
    qrDataUrl: connectRes.ok ? normalizeInstanceConnectToQrDataUrl(connectRes.data as unknown) : null,
    pairingCode: connectRes.ok ? extractPairingCodeFromConnectPayload(connectRes.data as unknown) : null,
    waJid: identity.waJid ?? null,
    authenticated: identity.authenticated,
    detail: connectRes.ok ? null : connectRes.error,
  });
}

export async function DELETE(request: Request) {
  const session = await getAdminSessionFromCookies();
  const denied = assertAdminSystemAgent(session);
  if (denied) return denied;
  if (!isEvolutionApiConfigured()) {
    return NextResponse.json({ error: "Evolution API não configurada no servidor." }, { status: 503 });
  }

  const existingRow = await getEvolutionInstanceByTenantSlot(SYSTEM_TENANT_ID, SYSTEM_SLOT_INDEX);
  if (existingRow?.instance_name) {
    try {
      await updateEvolutionInstanceStateByName({
        instanceName: existingRow.instance_name,
        connectionState: "deleting",
        waJid: existingRow.wa_jid,
      });
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          error: "Não foi possível iniciar a desconexão com segurança.",
          detail: error instanceof Error ? error.message : "delete_lock_failed",
        },
        { status: 503 },
      );
    }
  }

  const reset = await resetSystemAgentEvolutionBinding();
  const evolutionVerifiedAbsent =
    reset.inventoryVerified &&
    reset.currentInstanceRemoved &&
    reset.failedInstances.length === 0;
  const ok = evolutionVerifiedAbsent && reset.databaseBindingCleared;

  if (!ok) {
    if (existingRow?.instance_name && !reset.databaseBindingCleared) {
      await updateEvolutionInstanceStateByName({
        instanceName: existingRow.instance_name,
        connectionState: existingRow.connection_state,
        waJid: existingRow.wa_jid,
      }).catch(() => null);
    }
    return NextResponse.json(
      {
        ok: false,
        error: "Não foi possível confirmar a exclusão na Evolution. O vínculo foi preservado.",
        deletedInstance: reset.currentInstance,
        removedInstances: reset.removedInstances,
        failedInstances: reset.failedInstances,
        inventoryVerified: reset.inventoryVerified,
        databaseBindingCleared: reset.databaseBindingCleared,
        evolutionVerifiedAbsent,
        evolutionError: reset.error,
      },
      { status: reset.failedInstances.some((item) => item.presence === "present") ? 409 : 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    deletedInstance: reset.currentInstance,
    removedInstances: reset.removedInstances,
    failedInstances: [],
    inventoryVerified: true,
    databaseBindingCleared: true,
    evolutionRemoved: reset.removedInstances.length > 0,
    evolutionVerifiedAbsent: true,
    evolutionError: null,
  });
}
