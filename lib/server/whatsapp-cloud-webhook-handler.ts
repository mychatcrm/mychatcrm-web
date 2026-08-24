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
  fetchWhatsAppCloudMedia,
  parseWhatsAppCloudInbound,
  parseWhatsAppCloudStatuses,
} from "@/lib/integrations/whatsapp-cloud";
import { uploadMediaToR2 } from "@/lib/integrations/r2-storage";
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
import { buildWhatsappRemoteJid } from "@/lib/server/meta-lead-processing";
import { scheduleFollowUpAfterInbound } from "@/lib/server/follow-up-jobs";
import { followUpInteligenteFromMetadata } from "@/lib/server/follow-up-settings";

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

  // O mesmo parser cobre texto, áudio, imagem, vídeo e documento. O parser
  // legado de texto fazia mídia de clientes comuns desaparecer antes do job.
  const inbound = systemInbound ?? parseWhatsAppCloudInbound(json);
  if (!inbound) {
    return NextResponse.json({ ok: true });
  }

  const sb = createSupabaseServiceClient();
  // Connection saved by the client's Embedded Signup (may be null for numbers
  // routed purely by lead_distribution_rules, e.g. the system agent number).
  const [cloudConnection, tenantResolution] = await Promise.all([
    lookupWhatsAppCloudConnectionByPhoneNumberId(inbound.phoneNumberId),
    resolveCloudApiTenantByConnection({
      sb,
      connectionId: inbound.phoneNumberId,
    }),
  ]);
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

  // Lead Ads / Conversas gravam remote_jid como digits@s.whatsapp.net.
  // A Meta entrega só o wa_id (dígitos) — sem normalizar, o journey ativo
  // nunca é encontrado e o agente deixa de responder após o 1º contacto.
  const phone = inbound.fromWaId.replace(/\D/g, "");
  const remoteJid = buildWhatsappRemoteJid(phone);
  const receivedAt = new Date().toISOString();

  // A mensagem mínima é persistida antes das consultas de jornada/lead para
  // alimentar o painel em tempo real. O enriquecimento continua obrigatório e
  // termina antes de qualquer automação ou mutação de agenda.
  const { data: inboundSaved, error: inboundInsertError } = await sb
    .from("whatsapp_messages")
    .insert({
      tenant_id: tenantId,
      remote_jid: remoteJid,
      direction: "inbound",
      kind: inbound.kind,
      content:
        inbound.text.trim() ||
        (inbound.kind === "audio"
          ? "[Áudio]"
          : inbound.kind === "image"
            ? "[Imagem]"
            : inbound.kind === "video"
              ? "[Video]"
              : inbound.kind === "document"
                ? "[Document]"
                : ""),
      message_id: inbound.messageId || null,
      agent_id: null,
      lead_id: null,
      journey_id: null,
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

  // Persiste os bytes antes de iniciar automação. O motor V2 só recebe a
  // chave privada do R2 e faz transcrição/análise no adaptador de entrada.
  if (inbound.kind !== "text" && inbound.mediaId) {
    if (!cloudConnection?.access_token) {
      console.warn("[webhooks/whatsapp] inbound_media_token_missing", {
        tenant_id: tenantId,
        connection_id: inbound.phoneNumberId,
        message_id: inbound.messageId || null,
      });
      return NextResponse.json({ ok: true, blocked: "inbound_media_token_missing" });
    }
    const media = await fetchWhatsAppCloudMedia(inbound.mediaId, cloudConnection.access_token);
    if (!media) {
      await sb
        .from("whatsapp_messages")
        .update({ analysis_status: "failed" })
        .eq("tenant_id", tenantId)
        .eq("id", inboundSaved.id);
      return NextResponse.json({ ok: true, blocked: "inbound_media_download_failed" });
    }
    const extension = (media.mimeType.split("/")[1] || "bin").split(";")[0]!.replace(/[^a-z0-9.+-]/gi, "") || "bin";
    const safeMessageId = (inbound.messageId || String(inboundSaved.id)).replace(/[^a-zA-Z0-9._-]/g, "_");
    const storageKey = await uploadMediaToR2(
      media.buffer,
      `whatsapp/${tenantId}/meta-inbound/${safeMessageId}.${extension}`,
      media.mimeType,
    );
    if (!storageKey) {
      return NextResponse.json({ ok: true, blocked: "inbound_media_storage_failed" });
    }
    const { error: mediaUpdateError } = await sb
      .from("whatsapp_messages")
      .update({
        storage_key: storageKey,
        mime_type: media.mimeType,
        analysis_status: inbound.kind === "image" ? "pending" : null,
        transcription_status: inbound.kind === "audio" ? "pending" : null,
      })
      .eq("tenant_id", tenantId)
      .eq("id", inboundSaved.id);
    if (mediaUpdateError) {
      return NextResponse.json({ ok: true, blocked: "inbound_media_persist_failed" });
    }
  }

  const [journeyAuth, existingLead] = await Promise.all([
    resolveDirectJourneyAgent({
      sb,
      tenantId,
      remoteJid,
      connectionId: inbound.phoneNumberId,
    }),
    (async () => {
      const { data } = await sb
        .from("leads")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("phone", phone)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as { id?: string } | null;
    })(),
  ]);
  const journey = journeyAuth.journey;
  const agentId = journeyAuth.ok ? journeyAuth.agentId : null;
  const leadId = existingLead?.id ?? journey?.leadId ?? null;

  if (leadId || journey?.id) {
    const { error: attributionUpdateError } = await sb
      .from("whatsapp_messages")
      .update({
        lead_id: leadId,
        journey_id: journey?.id ?? null,
      })
      .eq("tenant_id", tenantId)
      .eq("id", inboundSaved.id);
    if (attributionUpdateError) {
      console.warn("[webhooks/whatsapp] inbound_attribution_failed", {
        tenant_id: tenantId,
        message_id: inboundSaved.id,
        error: attributionUpdateError.message,
      });
      return NextResponse.json({ ok: true, blocked: "inbound_attribution_failed" });
    }
  }

  await revealConversationOnInbound({
    sb,
    tenantId,
    remoteJid,
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
      reason: journeyAuth.ok ? "missing_agent" : journeyAuth.reason,
      tenant_id: tenantId,
      wa_id_last4: phone.slice(-4),
    });
    return NextResponse.json({ ok: true });
  }

  // Linha pode ter QR e Meta conectados ao mesmo tempo (alternador). Respostas
  // espontâneas respeitam o provedor ativo; se já existe journey Lead Ads /
  // Cloud nesta linha Meta, a Cloud deve responder mesmo com o slot em QR
  // (senão o 1º contacto Cloud fica órfão — a Evolution não recebe o webhook Meta).
  if (cloudConnection) {
    const activeProvider = await getSlotActiveProvider(tenantId, cloudConnection.slot_index);
    const journeyBoundToThisCloud = journey?.connectionId === inbound.phoneNumberId;
    if (activeProvider !== "cloud_api" && !journeyBoundToThisCloud) {
      console.info("[webhooks/whatsapp] auto_reply_skipped_inactive_provider", {
        tenant_id: tenantId,
        slot_index: cloudConnection.slot_index,
        active_provider: activeProvider,
      });
      return NextResponse.json({ ok: true });
    }
  }

  const guard = await canAgentAutoContactLead({
    sb,
    tenantId,
    agentId,
    phone,
    remoteJid,
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
  await scheduleFollowUpAfterInbound({
    sb,
    tenantId,
    agentId,
    remoteJid,
    leadId,
    journeyId: journey?.id ?? null,
    channel: "meta_cloud",
    connectionId: inbound.phoneNumberId,
    settings: followUpInteligenteFromMetadata(metadata),
  }).catch((error) => {
    console.warn("[webhooks/whatsapp] follow_up_schedule_failed", {
      tenant_id: tenantId,
      agent_id: agentId,
      connection_id: inbound.phoneNumberId,
      error: error instanceof Error ? error.message : "schedule_failed",
    });
  });
  const flow = await runInboundSmartWaitFlow({
    sb,
    tenantId,
    remoteJid,
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
