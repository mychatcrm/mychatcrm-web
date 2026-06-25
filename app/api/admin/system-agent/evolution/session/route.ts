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
  evolutionConnectionState,
  evolutionCreateInstance,
  evolutionDeleteInstance,
  evolutionInstanceConnect,
  evolutionRestartInstance,
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

  const remoteWaJid =
    remoteState === "open" && stateRes.ok && stateRes.data
      ? extractInstanceJid(stateRes.data as Record<string, unknown>) ?? row.wa_jid
      : row.wa_jid;

  await upsertTenantEvolutionInstance({
    tenantId: SYSTEM_TENANT_ID,
    slotIndex: SYSTEM_SLOT_INDEX,
    instanceName: row.instance_name,
    connectionState: remoteState,
    waJid: remoteWaJid,
    defaultAgentId: SYSTEM_AGENT_ID,
  });

  if (remoteState === "open") {
    return NextResponse.json({
      instanceName: row.instance_name,
      connectionState: remoteState,
      qrDataUrl: null,
      pairingCode: null,
      waJid: remoteWaJid ?? null,
    });
  }

  const connectRes = await evolutionInstanceConnect(row.instance_name);
  return NextResponse.json({
    instanceName: row.instance_name,
    connectionState: remoteState,
    qrDataUrl: connectRes.ok ? normalizeInstanceConnectToQrDataUrl(connectRes.data as unknown) : null,
    pairingCode: connectRes.ok ? extractPairingCodeFromConnectPayload(connectRes.data as unknown) : null,
    waJid: remoteWaJid ?? null,
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

  const row = await getEvolutionInstanceByTenantSlot(SYSTEM_TENANT_ID, SYSTEM_SLOT_INDEX);
  if (!row?.instance_name) {
    return NextResponse.json({ error: "Instância do sistema não configurada." }, { status: 404 });
  }

  if (body.action?.trim() !== "restart") {
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
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

  const stateRes = await evolutionConnectionState(row.instance_name);
  const remoteState = normalizeEvolutionConnectionState(
    stateRes.ok ? parseEvolutionConnectionStatePayload(stateRes.data) : undefined,
    "close",
  );

  await upsertTenantEvolutionInstance({
    tenantId: SYSTEM_TENANT_ID,
    slotIndex: SYSTEM_SLOT_INDEX,
    instanceName: row.instance_name,
    connectionState: remoteState,
    waJid: row.wa_jid,
    defaultAgentId: SYSTEM_AGENT_ID,
  });

  return NextResponse.json({ ok: true, connectionState: remoteState });
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
