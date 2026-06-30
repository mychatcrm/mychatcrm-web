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
import { upsertLeadFromWhatsAppContact } from "@/lib/server/auto-lead-upsert";
import { canAgentAutoContactLead } from "@/lib/server/agent-auto-contact-guard";
import { resolveDirectWhatsAppAgentFromRules } from "@/lib/server/agent-channel-authorization";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

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
 * Configure WHATSAPP_APP_SECRET, WHATSAPP_ACCESS_TOKEN, WHATSAPP_DEFAULT_TENANT_ID, WHATSAPP_DEFAULT_AGENT_ID.
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

  const tenantId = process.env.WHATSAPP_DEFAULT_TENANT_ID?.trim() || "public";
  const preferredAgentId = process.env.WHATSAPP_DEFAULT_AGENT_ID?.trim() || null;
  const sb = createSupabaseServiceClient();
  const organic = await resolveDirectWhatsAppAgentFromRules({
    sb,
    tenantId,
    preferredAgentId,
  });
  const agentId = organic?.agentId ?? null;

  await upsertLeadFromWhatsAppContact({
    tenantId,
    phone: inbound.fromWaId,
    senderJid: inbound.fromWaId,
    instancePhone: inbound.displayPhoneNumber,
    contactName: inbound.contactName,
    direction: "inbound",
    agentId,
    conversationId: inbound.fromWaId,
  });

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
    phone: inbound.fromWaId,
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
    customerId: inbound.fromWaId,
    feature: "agent_chat",
    messages: [{ role: "user", content: inbound.text }],
  });

  const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const replyText = result.ok
    ? result.text
    : "Não consegui gerar uma resposta agora. Por favor tente de novo em instantes.";

  if (token) {
    const send = await sendWhatsAppTextMessage({
      toWaId: inbound.fromWaId,
      text: replyText.slice(0, 4000),
      phoneNumberId: inbound.phoneNumberId,
      accessToken: token,
    });
    if (!send.ok) {
      console.error("[webhooks/whatsapp] send failed", send.status, send.error);
    } else {
      await upsertLeadFromWhatsAppContact({
        tenantId,
        phone: inbound.fromWaId,
        recipientJid: inbound.fromWaId,
        instancePhone: inbound.displayPhoneNumber,
        contactName: inbound.contactName,
        direction: "outbound",
        agentId,
        conversationId: inbound.fromWaId,
      });
    }
  } else {
    console.warn("[webhooks/whatsapp] WHATSAPP_ACCESS_TOKEN ausente — inferência registada mas sem envio de resposta.");
  }

  return NextResponse.json({ ok: true });
}
