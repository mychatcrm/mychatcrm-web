import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import {
  extractPairingCodeFromConnectPayload,
  normalizeInstanceConnectToQrDataUrl,
} from "@/lib/integrations/evolution-connect-qr";
import { buildEvolutionWebhookUrl, getPublicBaseUrlFromRequest } from "@/lib/integrations/evolution-webhook-url";
import {
  buildEvolutionInstanceName,
  buildFreshEvolutionInstanceName,
  evolutionConnectionState,
  evolutionCreateInstance,
  evolutionEnsureWebhook,
  evolutionFetchInstances,
  evolutionInstanceConnect,
  evolutionRemoveInstanceCompletely,
  evolutionSetWebhook,
  isEvolutionApiConfigured,
  normalizeEvolutionConnectionState,
  parseEvolutionConnectionStatePayload,
  pickEvolutionInstanceInfo,
} from "@/lib/integrations/evolution-api";
import {
  deleteTenantEvolutionInstanceRow,
  getEvolutionInstanceByTenantSlot,
  upsertTenantEvolutionInstance,
} from "@/lib/server/tenant-evolution-instance-db";
import {
  notifyTenantIntegrationConnected,
  notifyTenantIntegrationDisconnected,
  shouldNotifyWhatsappConnect,
  shouldNotifyWhatsappDisconnect,
} from "@/lib/server/integration-disconnect-notifications";
import { assertSlotIndexAllowed } from "@/lib/server/whatsapp-slot-server";
import { getExtraWhatsappSlots } from "@/lib/server/whatsapp-extra-slots-db";

export const dynamic = "force-dynamic";

/**
 * POST — cria/reaproveita instância Evolution, configura webhook e devolve QR + estado.
 * GET ?slotIndex= — estado remoto + QR se aplicável.
 * DELETE ?slotIndex= — remove instância na Evolution e a linha somente após
 * prova de ausência remota. Para reset preservando regras, use /reset.
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
  const extraWhatsappSlots = await getExtraWhatsappSlots(session.tenantId);
  if (!Number.isInteger(slotIndex) || !assertSlotIndexAllowed(session, slotIndex, extraWhatsappSlots)) {
    return NextResponse.json({ error: "slotIndex inválido" }, { status: 400 });
  }

  const existingRow = await getEvolutionInstanceByTenantSlot(session.tenantId, slotIndex);
  // Reusa o nome se já existe registro; após apagar, gera nome NOVO (sufixo aleatório).
  const instanceName =
    existingRow?.instance_name?.trim() || buildFreshEvolutionInstanceName(session.tenantId, slotIndex);
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
  } else if (normalizeEvolutionConnectionState(row.connection_state, "close") === "open") {
    // Reverse zombie check: sair de "open" também não garante desconexão real — o
    // Baileys reconecta sozinho após blips momentâneos de rede, e connectionState pode
    // reportar "close" por um instante sem o WhatsApp ter sido deslogado de verdade.
    // Confirma via fetchInstances (mesma fonte de verdade do check acima); se ainda
    // achar um dono de sessão vivo, trata como se a transição não tivesse acontecido —
    // evita um alerta falso de "desconectado" e um "piscar" do status no painel.
    const fetchResult = await evolutionFetchInstances(row.instance_name);
    if (fetchResult.ok) {
      const instanceInfo = pickEvolutionInstanceInfo(fetchResult.data, row.instance_name);
      if (instanceInfo?.ownerJid) {
        remoteState = "open";
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

  const connectRes = await evolutionInstanceConnect(row.instance_name);
  const qrDataUrl =
    connectRes.ok ? normalizeInstanceConnectToQrDataUrl(connectRes.data as unknown) : null;
  const pairingCode = connectRes.ok ? extractPairingCodeFromConnectPayload(connectRes.data as unknown) : null;

  return NextResponse.json({
    instanceName: row.instance_name,
    connectionState: remoteState,
    qrDataUrl,
    pairingCode,
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
  if (row) {
    const removal = await evolutionRemoveInstanceCompletely(row.instance_name);
    if (!removal.verifiedAbsent) {
      console.warn("[evolution/session] delete instance unverified", removal.status, removal.error);
      return NextResponse.json(
        {
          error: "Não foi possível confirmar a exclusão da instância na Evolution. A conexão foi mantida para evitar inconsistências.",
          evolutionVerifiedAbsent: false,
          evolutionError: removal.error,
        },
        { status: 502 },
      );
    }
    try {
      await deleteTenantEvolutionInstanceRow(session.tenantId, slotIndex);
    } catch (e) {
      console.error("[evolution/session] delete row", e);
      return NextResponse.json(
        { error: "A sessão foi removida da Evolution, mas o registro local não pôde ser removido. Contacte o suporte.", evolutionVerifiedAbsent: true },
        { status: 503 },
      );
    }
    try {
      await notifyTenantIntegrationDisconnected({
        tenantId: session.tenantId,
        integration: "whatsapp",
        source: "evolution_session_manual_delete",
        sourceKey: row.instance_name,
        instanceName: row.instance_name,
        state: "deleted",
        previousState: row.connection_state,
        manual: true,
        metadata: {
          slot_index: slotIndex,
          wa_jid: row.wa_jid ?? null,
          evolution_removed: true,
          evolution_error: null,
        },
      });
    } catch (notifyError) {
      console.warn("[evolution/session] manual disconnect notification failed", notifyError);
    }

    return NextResponse.json({
      ok: true,
      deletedInstance: row.instance_name,
      evolutionRemoved: removal.deleted,
      evolutionVerifiedAbsent: removal.verifiedAbsent,
      evolutionError: removal.error,
    });
  }

  return NextResponse.json({ ok: true, deletedInstance: null, evolutionVerifiedAbsent: true });
}
