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
import {
  generateAgentResponse,
  isAgentMissingInstructionsResult,
} from "@/lib/ai/generate-agent-response";
import {
  parseWhatsAppCloudInbound,
  parseWhatsAppCloudPayload,
  parseWhatsAppCloudStatuses,
  sendWhatsAppTextMessage,
} from "@/lib/integrations/whatsapp-cloud";
import { applyMetaSystemNotificationStatus } from "@/lib/server/system-agent";
import { handleSystemMetaInbound } from "@/lib/server/system-meta-inbound";
import { canAgentAutoContactLead } from "@/lib/server/agent-auto-contact-guard";
import { resolveCloudApiTenantByConnection } from "@/lib/server/agent-channel-authorization";
import { lookupWhatsAppCloudConnectionByPhoneNumberId } from "@/lib/server/whatsapp-cloud-connections";
import { getSlotActiveProvider } from "@/lib/server/whatsapp-slot-provider";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  authorizeActiveJourney,
  isJourneyIsolationEnabled,
  resolveDirectJourneyAgent,
  touchLeadJourney,
} from "@/lib/server/lead-journeys";
import {
  cancelLeadRedistributionTrigger,
  scheduleLeadRedistribution,
} from "@/lib/server/lead-redistribution";
import { revealConversationOnInbound } from "@/lib/server/conversation-visibility";
import {
  commitTenantLeadQuotaReservation,
  releaseTenantLeadQuotaReservation,
  reserveTenantLeadQuota,
} from "@/lib/server/lead-quota";
import { getTenantPlanSnapshot } from "@/lib/server/tenant-plan-snapshot";

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

  const { error: inboundInsertError } = await sb.from("whatsapp_messages").insert({
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
  });
  if (inboundInsertError?.code === "23505") {
    return NextResponse.json({ ok: true });
  }
  if (inboundInsertError) {
    console.warn("[webhooks/whatsapp] inbound_persist_failed", {
      tenant_id: tenantId,
      error: inboundInsertError.message,
    });
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

  // Atendimento direto autorizado não cria automaticamente um lead no CRM,
  // mas ainda precisa consumir a franquia uma única vez no primeiro contato.
  // A reserva só é confirmada quando a resposta é entregue pela Cloud API.
  let directQuotaReservationId: string | null = null;
  if (journey?.source === "whatsapp_direct") {
    const tenantPlan = await getTenantPlanSnapshot(tenantId);
    const admission = await reserveTenantLeadQuota({
      tenantId,
      plan: tenantPlan.plan,
      operationalLimits: tenantPlan.operationalLimits,
      contactKey: inbound.fromWaId,
      source: "whatsapp_direct",
      idempotencyKey: `direct-cloud:${inbound.phoneNumberId}:${phone}`,
      isExistingContact: Boolean(leadId),
      metadata: {
        connection_id: inbound.phoneNumberId,
        journey_id: journey.id,
        agent_id: agentId,
      },
    });
    if (!admission.admitted) {
      console.info("[webhooks/whatsapp] auto reply blocked by lead quota", {
        tenant_id: tenantId,
        agent_id: agentId,
        reason: admission.reason,
        used: admission.used,
        cap: admission.cap,
      });
      return NextResponse.json({ ok: true, blocked: admission.reason });
    }
    directQuotaReservationId = admission.eventId;
  }

  const result = await generateAgentResponse({
    tenantId,
    agentId,
    conversationId: inbound.fromWaId,
    journeyId: journey?.id ?? null,
    customerId: inbound.fromWaId,
    feature: "agent_chat",
    messages: [{ role: "user", content: inbound.text }],
  });

  if (isAgentMissingInstructionsResult(result)) {
    await releaseTenantLeadQuotaReservation(
      directQuotaReservationId,
      "agent_missing_instructions",
    );
    console.warn("[webhooks/whatsapp] automatic reply blocked because agent has no instructions", {
      tenant_id: tenantId,
      agent_id: agentId,
      journey_id: journey?.id ?? null,
      connection_id: inbound.phoneNumberId,
    });
    return NextResponse.json({ ok: true, blocked: "agent_missing_instructions" });
  }

  // Send with the connection's own token (client numbers); the global env token
  // remains the fallback for numbers without a stored connection.
  const token = cloudConnection?.access_token?.trim() || process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const replyText = result.ok
    ? result.text
    : "Não consegui gerar uma resposta agora. Por favor tente de novo em instantes.";

  if (token) {
    if (isJourneyIsolationEnabled()) {
      const currentJourney = await authorizeActiveJourney({
        sb,
        tenantId,
        remoteJid: inbound.fromWaId,
        preferredAgentId: agentId,
        connectionId: inbound.phoneNumberId,
      });
      if (!currentJourney.ok || currentJourney.journey?.id !== journey?.id) {
        console.info("[webhooks/whatsapp] response cancelled before send", {
          tenant_id: tenantId,
          reason: currentJourney.ok ? "journey_superseded_before_send" : currentJourney.reason,
        });
        await releaseTenantLeadQuotaReservation(
          directQuotaReservationId,
          "journey_superseded_before_send",
        );
        return NextResponse.json({ ok: true });
      }
    }
    const send = await sendWhatsAppTextMessage({
      toWaId: inbound.fromWaId,
      text: replyText.slice(0, 4000),
      phoneNumberId: inbound.phoneNumberId,
      accessToken: token,
    });
    if (!send.ok) {
      console.error("[webhooks/whatsapp] send failed", send.status, send.error);
      await releaseTenantLeadQuotaReservation(
        directQuotaReservationId,
        "initial_direct_cloud_delivery_failed",
      );
    } else {
      const sentAt = new Date().toISOString();
      await sb.from("whatsapp_messages").insert({
        tenant_id: tenantId,
        remote_jid: inbound.fromWaId,
        direction: "outbound",
        kind: "text",
        content: replyText.slice(0, 4000),
        message_id: send.messageId ?? null,
        agent_id: agentId,
        lead_id: leadId,
        journey_id: journey?.id ?? null,
        channel: "meta_cloud",
        connection_id: inbound.phoneNumberId,
      });
      if (leadId) {
        await sb
          .from("leads")
          .update({ last_message_at: sentAt, updated_at: sentAt })
          .eq("tenant_id", tenantId)
          .eq("id", leadId);
      }
      if (journey) {
        await touchLeadJourney({
          sb,
          tenantId,
          journeyId: journey.id,
          leadId,
          occurredAt: sentAt,
        });
        await scheduleLeadRedistribution({
          sb,
          tenantId,
          journeyId: journey.id,
          ruleId: journey.ruleId,
          currentAgentId: agentId,
          trigger: "customer_silence",
        });
      }
      await commitTenantLeadQuotaReservation({
        eventId: directQuotaReservationId,
        leadId,
        journeyId: journey?.id ?? null,
      });
    }
  } else {
    console.warn("[webhooks/whatsapp] WHATSAPP_ACCESS_TOKEN ausente — inferência registada mas sem envio de resposta.");
    await releaseTenantLeadQuotaReservation(
      directQuotaReservationId,
      "whatsapp_cloud_access_token_missing",
    );
  }

  return NextResponse.json({ ok: true });
}
