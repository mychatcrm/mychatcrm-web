/**
 * Corpo do processamento de um payload de webhook da WhatsApp Cloud API
 * (object: "whatsapp_business_account"), extraído de app/api/webhooks/whatsapp
 * para ser reusado também por app/api/webhooks/meta — o app Meta único deste
 * projeto entrega TODOS os objetos inscritos (page + whatsapp_business_account)
 * na mesma callback URL configurada no dashboard, e essa URL nem sempre é
 * a /api/webhooks/whatsapp esperada. Processar o mesmo payload de qualquer uma
 * das duas rotas evita depender de qual delas está de fato registada na Meta.
 */
import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import {
  parseWhatsAppCloudInbound,
  parseWhatsAppCloudPayload,
  parseWhatsAppCloudStatuses,
} from "@/lib/integrations/whatsapp-cloud";
import { applyMetaSystemNotificationStatus } from "@/lib/server/system-agent";
import { handleSystemMetaInbound } from "@/lib/server/system-meta-inbound";
import { canAgentAutoContactLead } from "@/lib/server/agent-auto-contact-guard";
import { resolveCloudApiTenantByConnection } from "@/lib/server/agent-channel-authorization";
import { lookupWhatsAppCloudConnectionByPhoneNumberId } from "@/lib/server/whatsapp-cloud-connections";
import { getSlotActiveProvider } from "@/lib/server/whatsapp-slot-provider";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  resolveDirectJourneyAgent,
  touchLeadJourney,
} from "@/lib/server/lead-journeys";
import {
  cancelLeadRedistributionTrigger,
} from "@/lib/server/lead-redistribution";
import { revealConversationOnInbound } from "@/lib/server/conversation-visibility";
import { runInboundSmartWaitFlow } from "@/lib/server/evolution-webhook-agent-flow";
import { smartWaitFromMetadata } from "@/lib/agents/smart-wait-settings";

export async function handleWhatsAppCloudWebhookPayload(json: unknown): Promise<NextResponse> {
  // Delivery status updates from Meta (outgoing messages: sent/delivered/read/failed).
  const statuses = parseWhatsAppCloudStatuses(json);
  if (statuses.length > 0) {
    for (const s of statuses) {
      await applyMetaSystemNotificationStatus({
        wamid: s.id,
        status: s.status,
        errorCode: s.errorCode,
        errorTitle: s.errorTitle,
        errorDetail: s.errorDetail,
      }).catch((error) => {
        console.warn("[webhooks/whatsapp] meta_status_update_failed", {
          wamid: s.id,
          status: s.status,
          error: error instanceof Error ? error.message : "update_failed",
        });
      });
    }
    return NextResponse.json({ ok: true });
  }

  // Inbound destinado ao número Meta do agente do sistema → pipeline próprio
  // (salva no chat de monitoramento, interpreta áudio/imagem e responde com IA).
  const systemInbound = parseWhatsAppCloudInbound(json);
  if (systemInbound) {
    const handled = await handleSystemMetaInbound(systemInbound).catch((error) => {
      console.warn("[webhooks/whatsapp] system_meta_inbound_failed", {
        error: error instanceof Error ? error.message : "handle_failed",
      });
      return false;
    });
    if (handled) return NextResponse.json({ ok: true });
  }

  const inbound = parseWhatsAppCloudPayload(json);
  if (!inbound) {
    return NextResponse.json({ ok: true });
  }

  const sb = createSupabaseServiceClient();
  // Connection saved by the client's Embedded Signup (may be null for numbers
  // routed purely by lead_distribution_rules, e.g. the system agent number).
  const cloudConnection = await lookupWhatsAppCloudConnectionByPhoneNumberId(inbound.phoneNumberId);
  const tenantResolution = await resolveCloudApiTenantByConnection({
    sb,
    connectionId: inbound.phoneNumberId,
  });
  let tenantId: string;
  if (tenantResolution.ok) {
    tenantId = tenantResolution.tenantId;
  } else if (cloudConnection) {
    // Distribution rules stay the primary source; the connection table keeps
    // inbound from being silently dropped before the client creates a rule.
    tenantId = cloudConnection.tenant_id;
    console.info("[webhooks/whatsapp] tenant_resolved_via_cloud_connection", {
      connection_id: inbound.phoneNumberId,
      tenant_id: tenantId,
    });
  } else {
    console.warn("[webhooks/whatsapp] inbound_without_tenant_connection", {
      connection_id: inbound.phoneNumberId,
      reason: tenantResolution.reason,
      message_id: inbound.messageId || null,
    });
    return NextResponse.json({ ok: true, blocked: tenantResolution.reason });
  }
  const journeyAuth = await resolveDirectJourneyAgent({
    sb,
    tenantId,
    remoteJid: inbound.fromWaId,
    connectionId: inbound.phoneNumberId,
  });
  const journey = journeyAuth.journey;
  const agentId = journeyAuth.ok ? journeyAuth.agentId : null;
  const phone = inbound.fromWaId.replace(/\D/g, "");
  const { data: existingLead } = await sb
    .from("leads")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("phone", phone)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const leadId =
    (existingLead as { id?: string } | null)?.id ??
    journey?.leadId ??
    null;
  const receivedAt = new Date().toISOString();

  const { data: inboundSaved, error: inboundInsertError } = await sb
    .from("whatsapp_messages")
    .insert({
      tenant_id: tenantId,
      remote_jid: inbound.fromWaId,
      direction: "inbound",
      kind: "text",
      content: inbound.text,
      message_id: inbound.messageId || null,
      agent_id: null,
      lead_id: leadId,
      journey_id: journey?.id ?? null,
      // Toda linha gravada aqui veio da API Oficial Meta — usado pelo painel de
      // Conversas ao vivo (admin) e pelo filtro por canal.
      channel: "meta_cloud",
      // Identifica QUAL número Meta do tenant (pode ter vários) — usado pelo
      // filtro por número em /dashboard/conversas.
      connection_id: inbound.phoneNumberId,
      received_at: receivedAt,
    })
    .select("id,created_at,received_at")
    .single();
  if (inboundInsertError?.code === "23505") {
    return NextResponse.json({ ok: true });
  }
  if (inboundInsertError) {
    console.warn("[webhooks/whatsapp] inbound_persist_failed", {
      tenant_id: tenantId,
      error: inboundInsertError.message,
    });
    return NextResponse.json({ ok: true, blocked: "inbound_persist_failed" });
  }

  await revealConversationOnInbound({
    sb,
    tenantId,
    remoteJid: inbound.fromWaId,
    leadId,
    agentId,
    activeJourneyId: journey?.id ?? null,
    lastMessageAt: receivedAt,
  });
  if (journey) {
    await cancelLeadRedistributionTrigger({
      sb,
      tenantId,
      journeyId: journey.id,
      trigger: "customer_silence",
      reason: "customer_replied",
    });
    await touchLeadJourney({
      sb,
      tenantId,
      journeyId: journey.id,
      leadId,
      occurredAt: receivedAt,
    });
  }

  if (!agentId) {
    console.info("[webhooks/whatsapp] agent skipped", {
      reason: "blocked_no_direct_whatsapp_rule",
      tenant_id: tenantId,
      wa_id_last4: inbound.fromWaId.replace(/\D/g, "").slice(-4),
    });
    return NextResponse.json({ ok: true });
  }

  // Linha pode ter QR e Meta conectados ao mesmo tempo (alternador) — só o
  // lado marcado como ativo responde, evitando os dois lados responderem ao
  // mesmo contato. connection_id nulo (número fora do fluxo multi-linha, ex.
  // agente do sistema) preserva o comportamento antigo (sempre responde).
  if (cloudConnection) {
    const activeProvider = await getSlotActiveProvider(tenantId, cloudConnection.slot_index);
    if (activeProvider !== "cloud_api") {
      console.info("[webhooks/whatsapp] auto_reply_skipped_inactive_provider", {
        tenant_id: tenantId,
        slot_index: cloudConnection.slot_index,
      });
      return NextResponse.json({ ok: true });
    }
  }

  const guard = await canAgentAutoContactLead({
    sb,
    tenantId,
    agentId,
    phone,
    remoteJid: inbound.fromWaId,
    journeyId: journey?.id ?? null,
    connectionId: inbound.phoneNumberId,
    triggerSource: "whatsapp_cloud_inbound_auto_reply",
  });
  if (!guard.ok) {
    console.warn("[webhooks/whatsapp] auto contact blocked", {
      tenant_id: tenantId,
      agent_id: agentId,
      lead_id: guard.leadId,
      reason: guard.reason,
    });
    return NextResponse.json({ ok: true });
  }

  const { data: agentConfig } = await sb
    .from("tenant_agents")
    .select("metadata")
    .eq("tenant_id", tenantId)
    .eq("agent_id", agentId)
    .maybeSingle();
  const metadata = agentConfig?.metadata && typeof agentConfig.metadata === "object"
    ? (agentConfig.metadata as Record<string, unknown>)
    : {};
  const flow = await runInboundSmartWaitFlow({
    sb,
    tenantId,
    remoteJid: inbound.fromWaId,
    leadId,
    journeyId: journey?.id ?? null,
    agentId,
    instanceName: inbound.phoneNumberId,
    channel: "meta_cloud",
    connectionId: inbound.phoneNumberId,
    inboundMessageKey: String(inboundSaved.id),
    occurredAt: String(inboundSaved.created_at ?? receivedAt),
    receivedAt: String(inboundSaved.received_at ?? receivedAt),
    smartWait: { ...smartWaitFromMetadata(metadata), enabled: true },
    // Igual à Evolution: mantém o ACK do webhook Meta fora do tempo de espera
    // do disparo do processador (a chamada HTTP interna pode levar até 8s).
    // Sem isso, o handler bloqueava a própria resposta ao Meta nesse tempo.
    deferProcessor: (task) => {
      waitUntil(task.then(() => undefined));
    },
  });
  if (flow.reason === "job_create_failed") {
    console.error("[webhooks/whatsapp] durable agent turn was not created", {
      tenant_id: tenantId,
      agent_id: agentId,
      connection_id: inbound.phoneNumberId,
    });
  }

  return NextResponse.json({ ok: true });
}
