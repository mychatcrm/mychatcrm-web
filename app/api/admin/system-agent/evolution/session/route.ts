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
  evolutionConnectionState,
  evolutionCreateInstance,
  evolutionFetchInstances,
  evolutionInstanceConnect,
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
  getEvolutionInstanceByTenantSlot,
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
  const authenticated = connectionState === "open" && Boolean(info?.ownerJid ?? jidFromState);

  return { connectionState, waJid, profileName: info?.profileName ?? null, authenticated };
}

/** Sessão Baileys nova: apaga órfãs/número antigo, cria instância fresh e devolve QR. */
async function provisionFreshSystemEvolutionSession(request: Request) {
  const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    return NextResponse.json({ error: "EVOLUTION_WEBHOOK_SECRET em falta." }, { status: 503 });
  }

  const reset = await resetSystemAgentEvolutionBinding();
  const instanceName = buildFreshSystemInstanceName();
  const publicBase = getPublicBaseUrlFromRequest(request);
  const webhookUrl = buildEvolutionWebhookUrl(publicBase, webhookSecret);

  let createResult = await evolutionCreateInstance({ instanceName, webhookUrl });
  if (!createResult.ok && createResult.status === 403) {
    const probe = await evolutionConnectionState(instanceName);
    if (!probe.ok && probe.status === 404) {
      return NextResponse.json(
        { error: "Nome de instância em conflito na Evolution (403 sem instância). Contacte suporte." },
        { status: 409 },
      );
    }
    await evolutionSetWebhook({ instanceName, url: webhookUrl });
    createResult = { ok: true, status: 200, data: {} };
  } else if (!createResult.ok) {
    return NextResponse.json(
      { error: "Falha ao criar instância na Evolution.", detail: createResult.error },
      { status: 502 },
    );
  } else {
    await evolutionSetWebhook({ instanceName, url: webhookUrl });
  }

  const stateRes = await evolutionConnectionState(instanceName);
  const remoteState = normalizeEvolutionConnectionState(
    stateRes.ok ? parseEvolutionConnectionStatePayload(stateRes.data) : undefined,
    "close",
  );

  try {
    await upsertTenantEvolutionInstance({
      tenantId: SYSTEM_TENANT_ID,
      slotIndex: SYSTEM_SLOT_INDEX,
      instanceName,
      connectionState: remoteState,
      waJid: null,
      defaultAgentId: SYSTEM_AGENT_ID,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "Erro ao gravar instância do sistema.", detail: msg.slice(0, 400) }, { status: 503 });
  }

  if (remoteState === "open") {
    const identity = await resolveSystemInstanceIdentity(instanceName, remoteState, null);
    const displayState = displayConnectionState(identity.connectionState, identity.authenticated);
    await upsertTenantEvolutionInstance({
      tenantId: SYSTEM_TENANT_ID,
      slotIndex: SYSTEM_SLOT_INDEX,
      instanceName,
      connectionState: identity.connectionState,
      waJid: identity.waJid,
      defaultAgentId: SYSTEM_AGENT_ID,
    });
    return NextResponse.json({
      instanceName,
      connectionState: displayState,
      qrDataUrl: null,
      pairingCode: null,
      waJid: identity.waJid ?? null,
      authenticated: identity.authenticated,
      profileName: identity.profileName,
      purgedInstances: reset.purgedInstances,
    });
  }

  const connectRes = await evolutionInstanceConnect(instanceName);
  if (!connectRes.ok) {
    return NextResponse.json({
      instanceName,
      connectionState: remoteState,
      qrDataUrl: null,
      pairingCode: null,
      waJid: null,
      detail: connectRes.error,
      purgedInstances: reset.purgedInstances,
    });
  }

  return NextResponse.json({
    instanceName,
    connectionState: remoteState,
    qrDataUrl: normalizeInstanceConnectToQrDataUrl(connectRes.data as unknown),
    pairingCode: extractPairingCodeFromConnectPayload(connectRes.data as unknown),
    waJid: null,
    purgedInstances: reset.purgedInstances,
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

  const reset = await resetSystemAgentEvolutionBinding();

  return NextResponse.json({
    ok: true,
    deletedInstance: reset.deletedDbInstance,
    purgedInstances: reset.purgedInstances,
    evolutionRemoved: reset.purgedInstances.length > 0 || !reset.deletedDbInstance,
    evolutionVerifiedAbsent: true,
    evolutionError: null,
  });
}
