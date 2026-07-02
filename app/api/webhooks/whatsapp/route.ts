import { NextResponse } from "next/server";
import { generateAgentResponse } from "@/lib/ai/generate-agent-response";
import {
  parseWhatsAppCloudInbound,
  parseWhatsAppCloudPayload,
  parseWhatsAppCloudStatuses,
  sendWhatsAppTextMessage,
  verifyMetaSignature256,
} from "@/lib/integrations/whatsapp-cloud";
import { applyMetaSystemNotificationStatus } from "@/lib/server/system-agent";
import { handleSystemMetaInbound } from "@/lib/server/system-meta-inbound";
import { canAgentAutoContactLead } from "@/lib/server/agent-auto-contact-guard";
import { resolveCloudApiTenantByConnection } from "@/lib/server/agent-channel-authorization";
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

export const dynamic = "force-dynamic";

/** Verificação do webhook (Meta envia GET na subscrição). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

/**
 * Webhook WhatsApp Cloud API → mesma OPENAI_API_KEY central via generateAgentResponse.
 * O tenant é resolvido pelo phone_number_id explicitamente cadastrado na regra.
 */
export async function POST(request: Request) {
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim();
  const rawBody = await request.text();

  if (appSecret) {
    const sig = request.headers.get("x-hub-signature-256");
    if (!verifyMetaSignature256(rawBody, sig, appSecret)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  let json: unknown;
  try {
    json = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return NextResponse.json({ ok: true });
  }

  // Delivery status updates from Meta (outgoing messages: sent/delivered/read/failed).
  const statuses = parseWhatsAppCloudStatuses(json);
  if (statuses.length > 0) {
    for (const s of statuses) {
      await applyMetaSystemNotificationStatus({ wamid: s.id, status: s.status }).catch((error) => {
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
  const tenantResolution = await resolveCloudApiTenantByConnection({
    sb,
    connectionId: inbound.phoneNumberId,
  });
  if (!tenantResolution.ok) {
    console.warn("[webhooks/whatsapp] inbound_without_tenant_connection", {
      connection_id: inbound.phoneNumberId,
      reason: tenantResolution.reason,
      message_id: inbound.messageId || null,
    });
    return NextResponse.json({ ok: true, blocked: tenantResolution.reason });
  }
  const tenantId = tenantResolution.tenantId;
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

  const guard = await canAgentAutoContactLead({
    sb,
    tenantId,
    agentId,
    phone,
    remoteJid: inbound.fromWaId,
    journeyId: journey?.id ?? null,
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

  const result = await generateAgentResponse({
    tenantId,
    agentId,
    conversationId: inbound.fromWaId,
    journeyId: journey?.id ?? null,
    customerId: inbound.fromWaId,
    feature: "agent_chat",
    messages: [{ role: "user", content: inbound.text }],
  });

  const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
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
      });
      if (!currentJourney.ok || currentJourney.journey?.id !== journey?.id) {
        console.info("[webhooks/whatsapp] response cancelled before send", {
          tenant_id: tenantId,
          reason: currentJourney.ok ? "journey_superseded_before_send" : currentJourney.reason,
        });
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
    }
  } else {
    console.warn("[webhooks/whatsapp] WHATSAPP_ACCESS_TOKEN ausente — inferência registada mas sem envio de resposta.");
  }

  return NextResponse.json({ ok: true });
}
