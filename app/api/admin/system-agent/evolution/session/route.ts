import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import {
  extractPairingCodeFromConnectPayload,
  normalizeInstanceConnectToQrDataUrl,
} from "@/lib/integrations/evolution-connect-qr";
import { buildEvolutionWebhookUrl, getPublicBaseUrlFromRequest } from "@/lib/integrations/evolution-webhook-url";
import {
  buildEvolutionInstanceName,
  evolutionConnectionState,
  evolutionCreateInstance,
  evolutionDeleteInstance,
  evolutionInstanceConnect,
  evolutionSetWebhook,
  isEvolutionApiConfigured,
  normalizeEvolutionConnectionState,
  parseEvolutionConnectionStatePayload,
} from "@/lib/integrations/evolution-api";
import { SYSTEM_AGENT_ID, SYSTEM_TENANT_ID } from "@/lib/server/system-agent";
import {
  deleteTenantEvolutionInstanceRow,
  getEvolutionInstanceByTenantSlot,
  upsertTenantEvolutionInstance,
} from "@/lib/server/tenant-evolution-instance-db";

export const dynamic = "force-dynamic";

const SYSTEM_SLOT_INDEX = 0;

function assertAdminSystemAgent(session: Awaited<ReturnType<typeof getAdminSessionFromCookies>>) {
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "system-agent")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }
  return null;
}

export async function POST(request: Request) {
  const session = await getAdminSessionFromCookies();
  const denied = assertAdminSystemAgent(session);
  if (denied) return denied;
  if (!isEvolutionApiConfigured()) {
    return NextResponse.json({ error: "Evolution API não configurada no servidor." }, { status: 503 });
  }
  const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    return NextResponse.json({ error: "EVOLUTION_WEBHOOK_SECRET em falta." }, { status: 503 });
  }

  const instanceName = buildEvolutionInstanceName(SYSTEM_TENANT_ID, SYSTEM_SLOT_INDEX);
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
      defaultAgentId: SYSTEM_AGENT_ID,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "Erro ao gravar instância do sistema.", detail: msg.slice(0, 400) }, { status: 503 });
  }

  if (remoteState === "open") {
    return NextResponse.json({
      instanceName,
      connectionState: remoteState,
      qrDataUrl: null,
      pairingCode: null,
      waJid: null,
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
    });
  }

  return NextResponse.json({
    instanceName,
    connectionState: remoteState,
    qrDataUrl: normalizeInstanceConnectToQrDataUrl(connectRes.data as unknown),
    pairingCode: extractPairingCodeFromConnectPayload(connectRes.data as unknown),
    waJid: null,
  });
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

  const stateRes = await evolutionConnectionState(row.instance_name);
  const remoteState = normalizeEvolutionConnectionState(
    stateRes.ok ? parseEvolutionConnectionStatePayload(stateRes.data) : row.connection_state,
    normalizeEvolutionConnectionState(row.connection_state, "close"),
  );

  await upsertTenantEvolutionInstance({
    tenantId: SYSTEM_TENANT_ID,
    slotIndex: SYSTEM_SLOT_INDEX,
    instanceName: row.instance_name,
    connectionState: remoteState,
    waJid: row.wa_jid,
    defaultAgentId: SYSTEM_AGENT_ID,
  });

  if (remoteState === "open") {
    return NextResponse.json({
      instanceName: row.instance_name,
      connectionState: remoteState,
      qrDataUrl: null,
      pairingCode: null,
      waJid: row.wa_jid ?? null,
    });
  }

  const connectRes = await evolutionInstanceConnect(row.instance_name);
  return NextResponse.json({
    instanceName: row.instance_name,
    connectionState: remoteState,
    qrDataUrl: connectRes.ok ? normalizeInstanceConnectToQrDataUrl(connectRes.data as unknown) : null,
    pairingCode: connectRes.ok ? extractPairingCodeFromConnectPayload(connectRes.data as unknown) : null,
    waJid: row.wa_jid ?? null,
  });
}

export async function DELETE(request: Request) {
  const session = await getAdminSessionFromCookies();
  const denied = assertAdminSystemAgent(session);
  if (denied) return denied;
  if (!isEvolutionApiConfigured()) {
    return NextResponse.json({ error: "Evolution API não configurada no servidor." }, { status: 503 });
  }

  const row = await getEvolutionInstanceByTenantSlot(SYSTEM_TENANT_ID, SYSTEM_SLOT_INDEX);
  if (row) {
    const del = await evolutionDeleteInstance(row.instance_name);
    if (!del.ok && del.status !== 404) {
      console.warn("[admin/system-agent/evolution] delete instance", del.status, del.error);
    }
    await deleteTenantEvolutionInstanceRow(SYSTEM_TENANT_ID, SYSTEM_SLOT_INDEX).catch(() => null);
  }

  return NextResponse.json({ ok: true });
}
