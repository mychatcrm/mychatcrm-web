import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import {
  extractPairingCodeFromConnectPayload,
  normalizeInstanceConnectToQrDataUrl,
} from "@/lib/integrations/evolution-connect-qr";
import { buildEvolutionWebhookUrl, getPublicBaseUrlFromRequest } from "@/lib/integrations/evolution-webhook-url";
import {
  applyClientEvolutionInstanceSettings,
  buildFreshEvolutionInstanceName,
  CLIENT_EVOLUTION_INSTANCE_SETTINGS,
  evolutionConnectionState,
  evolutionCreateInstance,
  evolutionEnsureWebhook,
  evolutionFetchInstances,
  evolutionInstanceConnect,
  evolutionSetWebhook,
  isEvolutionApiConfigured,
  normalizeEvolutionConnectionState,
  parseEvolutionConnectionStatePayload,
  pickEvolutionInstanceInfo,
} from "@/lib/integrations/evolution-api";
import {
  getEvolutionInstanceByTenantSlot,
  isEvolutionLifecycleState,
  upsertTenantEvolutionInstance,
} from "@/lib/server/tenant-evolution-instance-db";
import { reconcileLiveEvolutionInstance } from "@/lib/server/evolution-instance-reconciliation";
import {
  removeEvolutionSlotSafely,
  type EvolutionSlotRemovalResult,
} from "@/lib/server/evolution-slot-lifecycle";
import {
  notifyTenantIntegrationConnected,
  notifyTenantIntegrationDisconnected,
  shouldNotifyWhatsappConnect,
  shouldNotifyWhatsappDisconnect,
} from "@/lib/server/integration-disconnect-notifications";
import { assertSlotIndexAllowed } from "@/lib/server/whatsapp-slot-server";
import { getExtraWhatsappSlots } from "@/lib/server/whatsapp-extra-slots-db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST — cria/reaproveita instância Evolution, configura webhook e devolve QR + estado.
 * GET ?slotIndex= — estado remoto + QR se aplicável.
 * DELETE ?slotIndex= — remove a instância na Evolution após prova de ausência
 * remota, mas preserva o UUID lógico do slot para não quebrar regras vinculadas.
 */
async function notifyCompletedSlotRemoval(
  tenantId: string,
  slotIndex: number,
  result: Extract<EvolutionSlotRemovalResult, { state: "complete" }>,
): Promise<void> {
  if (!result.finalized) return;
  try {
    await notifyTenantIntegrationDisconnected({
      tenantId,
      integration: "whatsapp",
      source:
        result.operation === "resetting"
          ? "evolution_session_reset"
          : "evolution_session_manual_delete",
      sourceKey: result.previousInstanceName,
      instanceName: result.previousInstanceName,
      state: result.operation === "resetting" ? "reset" : "deleted",
      previousState: "open",
      manual: true,
      metadata: {
        slot_index: slotIndex,
        wa_jid: result.previousWaJid,
        evolution_removed: true,
        logical_connection_id: result.row.id,
        next_instance_name: result.row.instance_name,
      },
    });
  } catch (error) {
    console.warn("[evolution/session] lifecycle notification failed", error);
  }
}

function pendingRemovalResponse(result: Extract<EvolutionSlotRemovalResult, { state: "pending" }>) {
  return NextResponse.json(
    {
      ok: true,
      operationPending: true,
      operation: result.operation,
      connectionState: result.operation,
      instanceName: result.row.instance_name,
      waJid: result.row.wa_jid,
      qrDataUrl: null,
      pairingCode: null,
      evolutionVerifiedAbsent: false,
      evolutionPresence: result.presence,
      evolutionError: result.error,
    },
    { status: 202 },
  );
}

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
  const extraWhatsappSlots = await getExtraWhatsappSlots(session.tenantId);
  if (!Number.isInteger(slotIndex) || !assertSlotIndexAllowed(session, slotIndex, extraWhatsappSlots)) {
    return NextResponse.json({ error: "slotIndex inválido" }, { status: 400 });
  }

  let existingRow = await getEvolutionInstanceByTenantSlot(session.tenantId, slotIndex);
  if (existingRow && isEvolutionLifecycleState(existingRow.connection_state)) {
    return NextResponse.json(
      {
        error: "A conexão já possui uma operação em andamento. Aguarde a conclusão antes de conectar novamente.",
        operationPending: true,
        operation: existingRow.connection_state,
        connectionState: existingRow.connection_state,
        instanceName: existingRow.instance_name,
      },
      { status: 409 },
    );
  }
  if (existingRow) {
    const liveConnection = await reconcileLiveEvolutionInstance(existingRow);
    if (liveConnection.ok) {
      existingRow = liveConnection.instance;
    } else if (existingRow.wa_jid) {
      return NextResponse.json(
        {
          error:
            "A sessão já está vinculada e ainda não está aberta na Evolution. Aguarde a reconexão ou use Resetar conexão antes de gerar outro QR.",
          connectionState: existingRow.connection_state,
          instanceName: existingRow.instance_name,
          waJid: existingRow.wa_jid,
          recoveryRequired: true,
          reason: liveConnection.reason,
        },
        { status: 409 },
      );
    }
  }
  // Reusa o nome se já existe registro; após apagar, gera nome NOVO (sufixo aleatório).
  const instanceName =
    existingRow?.instance_name?.trim() || buildFreshEvolutionInstanceName(session.tenantId, slotIndex);
  const publicBase = getPublicBaseUrlFromRequest(request);
  const webhookUrl = buildEvolutionWebhookUrl(publicBase, webhookSecret);
  const defaultAgentId = process.env.EVOLUTION_DEFAULT_AGENT_ID?.trim() || null;

  // `alwaysOnline: true` inline na criação — evita que a mensagem seguinte de um
  // burst chegue ~60 s atrasada (WhatsApp entregando por retry quando o device
  // aparece offline). Reforçado por applyClientEvolutionInstanceSettings abaixo,
  // pois o /instance/create nem sempre persiste settings inline.
  let createResult = await evolutionCreateInstance({
    instanceName,
    webhookUrl,
    settings: { ...CLIENT_EVOLUTION_INSTANCE_SETTINGS },
  });
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

  // Garante os settings mesmo quando o create não os persistiu inline (idempotente).
  await applyClientEvolutionInstanceSettings(instanceName);

  // Verify-after-write: confirma que a Evolution realmente gravou o webhook
  // (enabled + URL certa + MESSAGES_UPSERT). evolutionEnsureWebhook re-aplica
  // uma vez se a leitura não bater; se ainda assim falhar, deixa um marcador
  // explícito nos logs — sem isto, uma config perdida só aparece quando um
  // cliente reclama que o agente parou de responder.
  try {
    const verify = await evolutionEnsureWebhook({ instanceName, url: webhookUrl });
    if (verify.reapplied && !verify.reapplyOk) {
      console.error("[evolution/session] webhook_verify_failed", {
        tenant_id: session.tenantId,
        instance_name: instanceName,
      });
    }
  } catch (e) {
    console.warn("[evolution/session] webhook verify error", e instanceof Error ? e.message : e);
  }

  const stateRes = await evolutionConnectionState(instanceName);
  const remoteState = normalizeEvolutionConnectionState(
    stateRes.ok ? parseEvolutionConnectionStatePayload(stateRes.data) : undefined,
    "close",
  );

  try {
    await upsertTenantEvolutionInstance({
      tenantId: session.tenantId,
      slotIndex,
      instanceName,
      connectionState: remoteState,
      defaultAgentId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[evolution/session] POST upsert", msg);
    return NextResponse.json(
      {
        error:
          "Não foi possível gravar a sessão no Supabase. Aplique a migração 20260513_tenant_evolution_instances.sql no projecto ligado a NEXT_PUBLIC_SUPABASE_URL.",
        detail: msg.slice(0, 400),
      },
      { status: 503 },
    );
  }

  if (remoteState === "open") {
    return NextResponse.json({
      instanceName,
      connectionState: remoteState,
      qrDataUrl: null as string | null,
      pairingCode: null as string | null,
      waJid: null as string | null,
    });
  }

  const connectRes = await evolutionInstanceConnect(instanceName);
  if (!connectRes.ok) {
    return NextResponse.json(
      {
        instanceName,
        connectionState: remoteState,
        qrDataUrl: null as string | null,
        pairingCode: null as string | null,
        waJid: null as string | null,
        detail: connectRes.error,
      },
      { status: 200 },
    );
  }

  const qrDataUrl = normalizeInstanceConnectToQrDataUrl(connectRes.data as unknown);
  const pairingCode = extractPairingCodeFromConnectPayload(connectRes.data as unknown);

  return NextResponse.json({
    instanceName,
    connectionState: remoteState,
    qrDataUrl,
    pairingCode,
    waJid: null as string | null,
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
  const extraWhatsappSlotsGet = await getExtraWhatsappSlots(session.tenantId);
  if (!Number.isInteger(slotIndex) || !assertSlotIndexAllowed(session, slotIndex, extraWhatsappSlotsGet)) {
    return NextResponse.json({ error: "slotIndex inválido" }, { status: 400 });
  }

  let row: Awaited<ReturnType<typeof getEvolutionInstanceByTenantSlot>>;
  try {
    row = await getEvolutionInstanceByTenantSlot(session.tenantId, slotIndex);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[evolution/session] GET select slot", msg);
    return NextResponse.json({ error: "Erro interno ao consultar instância." }, { status: 503 });
  }
  if (!row) {
    return NextResponse.json({
      instanceName: null,
      connectionState: "none",
      qrDataUrl: null as string | null,
      pairingCode: null as string | null,
      waJid: null as string | null,
    });
  }

  if (row.connection_state === "deleting" || row.connection_state === "resetting") {
    const lifecycle = await removeEvolutionSlotSafely({
      tenantId: session.tenantId,
      slotIndex,
      mode: row.connection_state,
    });
    if (lifecycle.state === "pending") return pendingRemovalResponse(lifecycle);
    if (lifecycle.state === "complete") {
      await notifyCompletedSlotRemoval(session.tenantId, slotIndex, lifecycle);
      return NextResponse.json({
        ok: true,
        operationComplete: true,
        operation: lifecycle.operation,
        connectionState: "none",
        instanceName: lifecycle.row.instance_name,
        waJid: null,
        qrDataUrl: null,
        pairingCode: null,
        evolutionVerifiedAbsent: true,
      });
    }
    if (lifecycle.state === "missing") {
      return NextResponse.json({
        ok: true,
        operationComplete: true,
        connectionState: "none",
        instanceName: null,
        waJid: null,
        qrDataUrl: null,
        pairingCode: null,
        evolutionVerifiedAbsent: true,
      });
    }
    return NextResponse.json(
      {
        error: "Outra operação desta conexão ainda está em andamento.",
        operationPending: true,
        connectionState: lifecycle.row.connection_state,
        instanceName: lifecycle.row.instance_name,
      },
      { status: 409 },
    );
  }
  if (row.connection_state === "provisioning") {
    return NextResponse.json(
      {
        ok: true,
        operationPending: true,
        operation: "provisioning",
        connectionState: "provisioning",
        instanceName: row.instance_name,
        waJid: row.wa_jid,
        qrDataUrl: null,
        pairingCode: null,
      },
      { status: 202 },
    );
  }

  const liveConnection = await reconcileLiveEvolutionInstance(row);
  if (liveConnection.ok) row = liveConnection.instance;

  const stateRes = await evolutionConnectionState(row.instance_name);
  let remoteState = normalizeEvolutionConnectionState(
    stateRes.ok ? parseEvolutionConnectionStatePayload(stateRes.data) : row.connection_state,
    normalizeEvolutionConnectionState(row.connection_state, "close"),
  );

  // Zombie check: connectionStatus="open" não garante que Session table tem chaves Baileys.
  // Se fetchInstances retornar ownerJid ausente → sessão zumbi → forçar reconexão com QR.
  let resolvedWaJid = row.wa_jid;
  // Só true quando este poll confirmou, agora, um ownerJid real via fetchInstances —
  // usado para exigir prova fresca antes de avisar "conectado" (ver abaixo). Sem essa
  // prova, "open" pode ser um estado zumbi que o fetchInstances não conseguiu corrigir
  // (erro de rede, timeout) e o wa_jid seria só o valor antigo em cache (row.wa_jid).
  let ownerJidConfirmedThisPoll = false;
  if (remoteState === "open") {
    const fetchResult = await evolutionFetchInstances(row.instance_name);
    if (fetchResult.ok) {
      const instanceInfo = pickEvolutionInstanceInfo(fetchResult.data, row.instance_name);
      if (!instanceInfo?.ownerJid) {
        remoteState = "close";
      } else {
        resolvedWaJid = instanceInfo.ownerJid;
        ownerJidConfirmedThisPoll = true;
      }
    }
  }

  try {
    await upsertTenantEvolutionInstance({
      tenantId: session.tenantId,
      slotIndex,
      instanceName: row.instance_name,
      connectionState: remoteState,
      waJid: resolvedWaJid,
      defaultAgentId: row.default_agent_id,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[evolution/session] GET upsert", msg);
    return NextResponse.json(
      {
        error: "Supabase indisponível ou migração em falta (tenant_evolution_instances).",
        detail: msg.slice(0, 400),
        instanceName: row.instance_name,
        connectionState: remoteState,
        qrDataUrl: null as string | null,
        pairingCode: null as string | null,
        waJid: resolvedWaJid ?? null,
      },
      { status: 503 },
    );
  }

  if (shouldNotifyWhatsappDisconnect({ previousState: row.connection_state, nextState: remoteState })) {
    try {
      await notifyTenantIntegrationDisconnected({
        tenantId: session.tenantId,
        integration: "whatsapp",
        source: "evolution_session_status_probe",
        sourceKey: row.instance_name,
        instanceName: row.instance_name,
        state: remoteState,
        previousState: row.connection_state,
        manual: false,
        metadata: {
          slot_index: slotIndex,
          wa_jid: resolvedWaJid ?? null,
        },
      });
    } catch (notifyError) {
      console.warn("[evolution/session] status disconnect notification failed", notifyError);
    }
  }

  // Exige prova fresca (ownerJid confirmado NESTE poll) além da transição de estado —
  // sem isso, um "open" zumbi que o fetchInstances não conseguiu corrigir (falha de
  // rede/timeout) poderia disparar um aviso de "conectado" para uma sessão já morta.
  if (
    ownerJidConfirmedThisPoll &&
    shouldNotifyWhatsappConnect({ previousState: row.connection_state, nextState: remoteState })
  ) {
    try {
      await notifyTenantIntegrationConnected({
        tenantId: session.tenantId,
        integration: "whatsapp",
        source: "evolution_session_status_probe",
        sourceKey: row.instance_name,
        instanceName: row.instance_name,
        waJid: resolvedWaJid ?? null,
        metadata: {
          slot_index: slotIndex,
        },
      });
    } catch (notifyError) {
      console.warn("[evolution/session] status connect notification failed", notifyError);
    }
  }

  if (remoteState === "open") {
    // Auto-cura do webhook: a Evolution pode perder a config silenciosamente
    // (reinício, recriação de sessão) — a sessão fica "conectada" mas nenhuma
    // mensagem chega em /api/webhooks/evolution. Sempre que o painel confirma
    // uma sessão viva, confere a config e re-aplica se necessário.
    const webhookSecretGet = process.env.EVOLUTION_WEBHOOK_SECRET?.trim();
    if (ownerJidConfirmedThisPoll && webhookSecretGet) {
      try {
        const expectedUrl = buildEvolutionWebhookUrl(getPublicBaseUrlFromRequest(request), webhookSecretGet);
        const ensure = await evolutionEnsureWebhook({ instanceName: row.instance_name, url: expectedUrl });
        if (ensure.reapplied) {
          console.warn("[evolution/session] webhook_reapplied", {
            tenant_id: session.tenantId,
            instance_name: row.instance_name,
            reapply_ok: ensure.reapplyOk,
          });
        }
      } catch (e) {
        console.warn("[evolution/session] webhook ensure failed", e instanceof Error ? e.message : e);
      }
    }
    return NextResponse.json({
      instanceName: row.instance_name,
      connectionState: remoteState,
      qrDataUrl: null as string | null,
      pairingCode: null as string | null,
      waJid: resolvedWaJid ?? null,
    });
  }

  // GET e polling são estritamente passivos. Gerar QR/conectar é uma mutação e
  // acontece somente no POST iniciado explicitamente pela interface.
  return NextResponse.json({
    instanceName: row.instance_name,
    connectionState: remoteState,
    qrDataUrl: null,
    pairingCode: null,
    waJid: resolvedWaJid ?? null,
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
  const extraWhatsappSlotsDel = await getExtraWhatsappSlots(session.tenantId);
  if (!Number.isInteger(slotIndex) || !assertSlotIndexAllowed(session, slotIndex, extraWhatsappSlotsDel)) {
    return NextResponse.json({ error: "slotIndex inválido" }, { status: 400 });
  }

  let row: Awaited<ReturnType<typeof getEvolutionInstanceByTenantSlot>>;
  try {
    row = await getEvolutionInstanceByTenantSlot(session.tenantId, slotIndex);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[evolution/session] DELETE select slot", msg);
    return NextResponse.json({ error: "Erro interno ao consultar instância." }, { status: 503 });
  }
  if (!row) {
    return NextResponse.json({ ok: true, deletedInstance: null, evolutionVerifiedAbsent: true });
  }

  const lifecycle = await removeEvolutionSlotSafely({
    tenantId: session.tenantId,
    slotIndex,
    mode: "deleting",
  });
  if (lifecycle.state === "pending") return pendingRemovalResponse(lifecycle);
  if (lifecycle.state === "busy") {
    return NextResponse.json(
      {
        error: "Outra operação desta conexão ainda está em andamento.",
        operationPending: true,
        operation: lifecycle.operation,
        connectionState: lifecycle.row.connection_state,
        instanceName: lifecycle.row.instance_name,
      },
      { status: 409 },
    );
  }
  if (lifecycle.state === "missing") {
    return NextResponse.json({ ok: true, deletedInstance: null, evolutionVerifiedAbsent: true });
  }

  await notifyCompletedSlotRemoval(session.tenantId, slotIndex, lifecycle);
  return NextResponse.json({
    ok: true,
    operationComplete: true,
    operation: lifecycle.operation,
    deletedInstance: lifecycle.previousInstanceName,
    evolutionRemoved: true,
    evolutionVerifiedAbsent: true,
    evolutionError: null,
    connectionId: lifecycle.row.id,
    instanceName: lifecycle.row.instance_name,
    connectionState: "none",
  });
}
