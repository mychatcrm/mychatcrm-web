import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { buildEvolutionWebhookUrl, getPublicBaseUrlFromRequest } from "@/lib/integrations/evolution-webhook-url";
import {
  buildEvolutionInstanceName,
  evolutionConnectionState,
  evolutionCreateInstance,
  evolutionDeleteInstance,
  evolutionInstanceConnect,
  evolutionSetWebhook,
  isEvolutionApiConfigured,
} from "@/lib/integrations/evolution-api";
import {
  deleteTenantEvolutionInstanceRow,
  getEvolutionInstanceByTenantSlot,
  upsertTenantEvolutionInstance,
} from "@/lib/server/tenant-evolution-instance-db";
import { assertSlotIndexAllowed } from "@/lib/server/whatsapp-slot-server";

export const dynamic = "force-dynamic";

function qrCodeToDataUrl(code: string): string {
  const trimmed = code.trim();
  if (trimmed.startsWith("data:image")) return trimmed;
  return `data:image/png;base64,${trimmed}`;
}

/**
 * POST — cria/reaproveita instância Evolution, configura webhook e devolve QR + estado.
 * GET ?slotIndex= — estado remoto + QR se aplicável.
 * DELETE ?slotIndex= — remove instância na Evolution e linha na BD.
 */
export async function POST(request: Request) {
  const session = await getClientSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  if (!isEvolutionApiConfigured()) {
    return NextResponse.json({ error: "Evolution API não configurada no servidor." }, { status: 503 });
  }
  const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    return NextResponse.json({ error: "EVOLUTION_WEBHOOK_SECRET em falta." }, { status: 503 });
  }

  let body: { slotIndex?: number };
  try {
    body = (await request.json()) as { slotIndex?: number };
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const slotIndex = typeof body.slotIndex === "number" ? body.slotIndex : Number(body.slotIndex);
  if (!Number.isInteger(slotIndex) || !assertSlotIndexAllowed(session, slotIndex)) {
    return NextResponse.json({ error: "slotIndex inválido" }, { status: 400 });
  }

  const instanceName = buildEvolutionInstanceName(session.tenantId, slotIndex);
  const publicBase = getPublicBaseUrlFromRequest(request);
  const webhookUrl = buildEvolutionWebhookUrl(publicBase, webhookSecret);
  const defaultAgentId = process.env.EVOLUTION_DEFAULT_AGENT_ID?.trim() || null;

  let createResult = await evolutionCreateInstance({ instanceName, webhookUrl });
  if (!createResult.ok && createResult.status === 403) {
    const probe = await evolutionConnectionState(instanceName);
    if (!probe.ok && probe.status === 404) {
      return NextResponse.json(
        { error: "Nome de instância em conflito na Evolution (403 sem instância). Contacte suporte." },
        { status: 409 },
      );
    }
    const wh = await evolutionSetWebhook({ instanceName, url: webhookUrl });
    if (!wh.ok) {
      console.warn("[evolution/session] setWebhook after 403", wh.status, wh.error);
    }
    createResult = { ok: true, status: 200, data: {} };
  } else if (!createResult.ok) {
    return NextResponse.json(
      { error: "Falha ao criar instância na Evolution.", detail: createResult.error },
      { status: 502 },
    );
  } else {
    const wh = await evolutionSetWebhook({ instanceName, url: webhookUrl });
    if (!wh.ok) {
      console.warn("[evolution/session] setWebhook", wh.status, wh.error);
    }
  }

  const stateRes = await evolutionConnectionState(instanceName);
  const remoteState = stateRes.ok ? (stateRes.data.instance?.state ?? "close") : "close";

  await upsertTenantEvolutionInstance({
    tenantId: session.tenantId,
    slotIndex,
    instanceName,
    connectionState: remoteState,
    defaultAgentId,
  });

  if (remoteState === "open") {
    return NextResponse.json({
      instanceName,
      connectionState: remoteState,
      qrDataUrl: null as string | null,
    });
  }

  const connectRes = await evolutionInstanceConnect(instanceName);
  if (!connectRes.ok) {
    return NextResponse.json(
      {
        instanceName,
        connectionState: remoteState,
        qrDataUrl: null as string | null,
        detail: connectRes.error,
      },
      { status: 200 },
    );
  }

  const code = connectRes.data.code;
  const qrDataUrl = typeof code === "string" && code.length > 0 ? qrCodeToDataUrl(code) : null;

  return NextResponse.json({
    instanceName,
    connectionState: remoteState,
    qrDataUrl,
  });
}

export async function GET(request: Request) {
  const session = await getClientSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  if (!isEvolutionApiConfigured()) {
    return NextResponse.json({ error: "Evolution API não configurada no servidor." }, { status: 503 });
  }

  const url = new URL(request.url);
  const slotIndex = Number(url.searchParams.get("slotIndex"));
  if (!Number.isInteger(slotIndex) || !assertSlotIndexAllowed(session, slotIndex)) {
    return NextResponse.json({ error: "slotIndex inválido" }, { status: 400 });
  }

  const row = await getEvolutionInstanceByTenantSlot(session.tenantId, slotIndex);
  if (!row) {
    return NextResponse.json({
      instanceName: null,
      connectionState: "none",
      qrDataUrl: null as string | null,
    });
  }

  const stateRes = await evolutionConnectionState(row.instance_name);
  const remoteState = stateRes.ok ? (stateRes.data.instance?.state ?? row.connection_state) : row.connection_state;

  await upsertTenantEvolutionInstance({
    tenantId: session.tenantId,
    slotIndex,
    instanceName: row.instance_name,
    connectionState: remoteState,
    waJid: row.wa_jid,
    defaultAgentId: row.default_agent_id,
  });

  if (remoteState === "open") {
    return NextResponse.json({
      instanceName: row.instance_name,
      connectionState: remoteState,
      qrDataUrl: null as string | null,
    });
  }

  const connectRes = await evolutionInstanceConnect(row.instance_name);
  const code = connectRes.ok && typeof connectRes.data.code === "string" ? connectRes.data.code : null;
  const qrDataUrl = code && code.length > 0 ? qrCodeToDataUrl(code) : null;

  return NextResponse.json({
    instanceName: row.instance_name,
    connectionState: remoteState,
    qrDataUrl,
  });
}

export async function DELETE(request: Request) {
  const session = await getClientSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  if (!isEvolutionApiConfigured()) {
    return NextResponse.json({ error: "Evolution API não configurada no servidor." }, { status: 503 });
  }

  const url = new URL(request.url);
  const slotIndex = Number(url.searchParams.get("slotIndex"));
  if (!Number.isInteger(slotIndex) || !assertSlotIndexAllowed(session, slotIndex)) {
    return NextResponse.json({ error: "slotIndex inválido" }, { status: 400 });
  }

  const row = await getEvolutionInstanceByTenantSlot(session.tenantId, slotIndex);
  if (row) {
    const del = await evolutionDeleteInstance(row.instance_name);
    if (!del.ok && del.status !== 404) {
      console.warn("[evolution/session] delete instance", del.status, del.error);
    }
    await deleteTenantEvolutionInstanceRow(session.tenantId, slotIndex);
  }

  return NextResponse.json({ ok: true });
}
