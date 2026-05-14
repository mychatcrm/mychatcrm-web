import { generateAgentResponse } from "@/lib/ai/generate-agent-response";
import { detectSupportedLanguageCode, type SupportedLanguageCode } from "@/lib/ai/language-detect";
import { sanitizeAgentResponseSettings } from "@/lib/agents";
import { smartWaitFromMetadata } from "@/lib/agents/smart-wait-settings";
import {
  buildGroupedUserPrompt,
  deduplicateInboundTexts,
} from "@/lib/conversas/inbound-message-dedupe";
import {
  evolutionSendAudio,
  evolutionSendText,
  remoteJidToEvoNumber,
} from "@/lib/integrations/evolution-api";
import { textToSpeechElevenLabs } from "@/lib/integrations/elevenlabs";
import { uploadMediaToR2 } from "@/lib/integrations/r2-storage";
import { upsertLeadFromWhatsAppContact } from "@/lib/server/auto-lead-upsert";
import type { AgentResponseJobRow } from "@/lib/server/agent-response-jobs";
import {
  buildDeterministicHandoffSummary,
  getRecentConversationMessages,
  saveConversationSummary,
  shouldTriggerHandoff,
} from "@/lib/server/conversation-memory";
import { markWaitingForHuman } from "@/lib/server/conversation-operation";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

type PendingInboundRow = {
  id: string;
  content: string;
  kind: string;
  message_id: string | null;
  remote_jid: string;
  created_at: string;
};

function localizedGenericFailureReply(languageCode: SupportedLanguageCode): string {
  const replies: Record<SupportedLanguageCode, string> = {
    pt: "Não consegui gerar uma resposta agora. Por favor tente de novo em instantes.",
    en: "I couldn't generate a response right now. Please try again in a moment.",
    es: "No pude generar una respuesta ahora. Por favor inténtalo de nuevo en unos instantes.",
    fr: "Je n'ai pas pu générer de réponse pour le moment. Veuillez réessayer dans quelques instants.",
    de: "Ich konnte gerade keine Antwort erstellen. Bitte versuchen Sie es gleich noch einmal.",
    it: "Non sono riuscito a generare una risposta ora. Riprova tra poco.",
  };
  return replies[languageCode];
}

async function saveOutboundMessage(opts: {
  tenantId: string;
  remoteJid: string;
  kind: "text" | "audio";
  content: string;
  agentId: string;
  leadId?: string | null;
  mediaUrl?: string | null;
}): Promise<void> {
  const sb = createSupabaseServiceClient();
  await sb.from("whatsapp_messages").insert({
    tenant_id: opts.tenantId,
    remote_jid: opts.remoteJid,
    direction: "outbound",
    kind: opts.kind,
    content: opts.content,
    agent_id: opts.agentId,
    lead_id: opts.leadId ?? null,
    media_url: opts.mediaUrl ?? null,
  });
}

export async function processAgentResponseJob(
  sb: SupabaseServiceClient,
  job: AgentResponseJobRow,
): Promise<{ ok: true; dedupedCount: number } | { ok: false; error: string; dedupedCount?: number }> {
  const { data: rows, error } = await sb
    .from("whatsapp_messages")
    .select("id, content, kind, message_id, remote_jid, created_at")
    .eq("tenant_id", job.tenant_id)
    .eq("remote_jid", job.remote_jid)
    .eq("direction", "inbound")
    .in("id", job.message_ids)
    .order("created_at", { ascending: true });
  if (error) return { ok: false, error: error.message };

  const inboundRows = (rows ?? []) as PendingInboundRow[];
  if (!inboundRows.length) return { ok: false, error: "no_inbound_messages" };

  const { data: agentRow } = await sb
    .from("tenant_agents")
    .select("metadata, voice_id, response_mode")
    .eq("tenant_id", job.tenant_id)
    .eq("agent_id", job.agent_id)
    .maybeSingle();
  const metadata =
    agentRow?.metadata && typeof agentRow.metadata === "object"
      ? (agentRow.metadata as Record<string, unknown>)
      : {};
  const smartWait = smartWaitFromMetadata(metadata);
  const deduped = smartWait.dedupeRepeated
    ? deduplicateInboundTexts(
        inboundRows.map((row) => ({
          id: row.id,
          content: row.content,
          messageId: row.message_id,
          kind: row.kind,
        })),
      )
    : {
        messages: inboundRows.map((row) => ({
          id: row.id,
          content: row.content,
          messageId: row.message_id,
          kind: row.kind,
        })),
        dedupedCount: 0,
      };

  const groupedPrompt = buildGroupedUserPrompt(deduped.messages);
  const languageCode = detectSupportedLanguageCode(groupedPrompt);
  const handoffKeywords = Array.isArray(metadata.handoffKeywords)
    ? metadata.handoffKeywords.filter((item): item is string => typeof item === "string")
    : [];
  const handoffEnabled = metadata.ctaHandoffAtivo === true;
  const handoffMessage =
    handoffEnabled && typeof metadata.handoffMensagem === "string" && metadata.handoffMensagem.trim()
      ? metadata.handoffMensagem.trim()
      : null;
  const handoffCheck = shouldTriggerHandoff(groupedPrompt, handoffKeywords);

  const result = await generateAgentResponse({
    tenantId: job.tenant_id,
    agentId: job.agent_id,
    conversationId: job.remote_jid,
    customerId: job.remote_jid,
    feature: "agent_chat",
    messages: groupedPrompt ? [{ role: "user", content: groupedPrompt }] : [],
  });

  let replyText = result.ok
    ? result.text
    : localizedGenericFailureReply(languageCode);

  const number = remoteJidToEvoNumber(job.remote_jid);
  if (!number) return { ok: false, error: "invalid_remote_jid", dedupedCount: deduped.dedupedCount };

  if (handoffCheck.trigger) {
    if (handoffMessage) replyText = handoffMessage;
    const messages = await getRecentConversationMessages({
      sb,
      tenantId: job.tenant_id,
      remoteJid: job.remote_jid,
    });
    const summary = buildDeterministicHandoffSummary({
      lead: job.lead_id
        ? {
            id: job.lead_id,
            name: null,
            phone: job.remote_jid.split("@")[0]?.replace(/\D/g, "") ?? null,
            source: "whatsapp",
            status: null,
            crmFunnelId: null,
            notes: null,
            agentId: job.agent_id,
            aiSummary: null,
            leadTemperature: null,
            suggestedNextAction: null,
            profileMetadata: {},
          }
        : null,
      messages,
      reason: handoffCheck.reason ?? "handoff",
    });
    await saveConversationSummary({
      sb,
      tenantId: job.tenant_id,
      remoteJid: job.remote_jid,
      leadId: job.lead_id,
      agentId: job.agent_id,
      summary,
    });
    await markWaitingForHuman({
      sb,
      tenantId: job.tenant_id,
      remoteJid: job.remote_jid,
      leadId: job.lead_id,
      agentId: job.agent_id,
      reason: handoffCheck.reason ?? "handoff",
    });
  }

  const lastQuoted = [...deduped.messages].reverse().find((m) => m.messageId && m.kind === "text");
  const quoted =
    lastQuoted?.messageId
      ? {
          messageId: lastQuoted.messageId,
          remoteJid: job.remote_jid,
          fromMe: false,
          conversation: lastQuoted.content,
        }
      : null;

  const { responseMode, voiceId } = sanitizeAgentResponseSettings({
    responseMode: agentRow?.response_mode,
    voiceId: agentRow?.voice_id,
  });
  const lastKind = inboundRows[inboundRows.length - 1]?.kind;
  const useAudio = lastKind === "audio" && responseMode === "audio" && Boolean(voiceId);

  if (useAudio) {
    try {
      const audioBuffer = await textToSpeechElevenLabs(replyText.slice(0, 5000), voiceId!, {
        languageCode,
      });
      const ttsKey = `whatsapp/${job.tenant_id}/tts/${Date.now()}_reply.mp3`;
      const r2Key = await uploadMediaToR2(audioBuffer, ttsKey, "audio/mpeg");
      const mediaUrl = r2Key ? `/api/client/media/${ttsKey}` : null;
      const send = await evolutionSendAudio({
        instanceName: job.instance_name,
        number,
        audio: audioBuffer.toString("base64"),
      });
      if (!send.ok) return { ok: false, error: send.error, dedupedCount: deduped.dedupedCount };
      await saveOutboundMessage({
        tenantId: job.tenant_id,
        remoteJid: job.remote_jid,
        kind: "audio",
        content: replyText.slice(0, 4000),
        agentId: job.agent_id,
        leadId: job.lead_id,
        mediaUrl,
      });
    } catch {
      const send = await evolutionSendText({
        instanceName: job.instance_name,
        number,
        text: replyText.slice(0, 4000),
        quoted,
      });
      if (!send.ok) return { ok: false, error: send.error, dedupedCount: deduped.dedupedCount };
      await saveOutboundMessage({
        tenantId: job.tenant_id,
        remoteJid: job.remote_jid,
        kind: "text",
        content: replyText.slice(0, 4000),
        agentId: job.agent_id,
        leadId: job.lead_id,
      });
    }
  } else {
    const send = await evolutionSendText({
      instanceName: job.instance_name,
      number,
      text: replyText.slice(0, 4000),
      quoted,
    });
    if (!send.ok) return { ok: false, error: send.error, dedupedCount: deduped.dedupedCount };
    await saveOutboundMessage({
      tenantId: job.tenant_id,
      remoteJid: job.remote_jid,
      kind: "text",
      content: replyText.slice(0, 4000),
      agentId: job.agent_id,
      leadId: job.lead_id,
    });
  }

  await upsertLeadFromWhatsAppContact({
    tenantId: job.tenant_id,
    remoteJid: job.remote_jid,
    recipientJid: job.remote_jid,
    direction: "outbound",
    agentId: job.agent_id,
    conversationId: job.remote_jid,
  });

  return { ok: true, dedupedCount: deduped.dedupedCount };
}
