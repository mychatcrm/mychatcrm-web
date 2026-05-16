import { NextResponse } from "next/server";
import { generateAgentResponse } from "@/lib/ai/generate-agent-response";
import { detectSupportedLanguageCode, type SupportedLanguageCode } from "@/lib/ai/language-detect";
import { sanitizeAgentResponseSettings } from "@/lib/agents";
import {
  extractConnectionState,
  extractInboundMessagesFromEvolutionPayload,
  extractInstanceJid,
  extractInstanceName,
  normalizeEvolutionEventName,
  type EvolutionInboundMessage,
} from "@/lib/integrations/evolution-webhook-parse";
import { evolutionSendAudio, evolutionSendText, remoteJidToEvoNumber } from "@/lib/integrations/evolution-api";
import { resolveOutboundMediaForAgentResponse } from "@/lib/server/agent-media-files";
import { sendAgentOutboundMediaViaEvolution } from "@/lib/server/send-agent-outbound-media-evolution";
import { resolveEvolutionAgentId } from "@/lib/server/evolution-agent-resolve";
import { upsertLeadFromWhatsAppContact } from "@/lib/server/auto-lead-upsert";
import { getEvolutionInstanceByName, updateEvolutionInstanceStateByName } from "@/lib/server/tenant-evolution-instance-db";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { uploadMediaToR2 } from "@/lib/integrations/r2-storage";
import { textToSpeechElevenLabs } from "@/lib/integrations/elevenlabs";
import {
  buildDeterministicHandoffSummary,
  getConversationState,
  getRecentConversationMessages,
  saveConversationSummary,
  shouldTriggerHandoff,
  upsertConversationState,
} from "@/lib/server/conversation-memory";
import { applyHumanConversationCommand } from "@/lib/server/conversation-human-control";
import { revealConversationOnInbound } from "@/lib/server/conversation-visibility";
import { isAgentAutomationAllowed, markWaitingForHuman } from "@/lib/server/conversation-operation";
import { smartWaitFromMetadata } from "@/lib/agents/smart-wait-settings";
import { isSmartWaitGloballyDisabled, runInboundSmartWaitFlow } from "@/lib/server/evolution-webhook-agent-flow";
import { scheduleFollowUpAfterInbound } from "@/lib/server/follow-up-jobs";
import { followUpInteligenteFromMetadata } from "@/lib/server/follow-up-settings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function verifyWebhookToken(request: Request): boolean {
  const expected = process.env.EVOLUTION_WEBHOOK_SECRET?.trim();
  if (!expected) return false;
  const url = new URL(request.url);
  const q = url.searchParams.get("token");
  if (q && q === expected) return true;
  const hdr = request.headers.get("x-mychatcrm-webhook-secret");
  return Boolean(hdr && hdr === expected);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

// ---------------------------------------------------------------------------
// Helpers — persistência de mensagens
// ---------------------------------------------------------------------------

function kindFromMsg(msg: EvolutionInboundMessage): "text" | "audio" | "image" | "video" | "document" {
  if (msg.type === "audio") return "audio";
  if (msg.type === "image") return "image";
  if (msg.type === "video") return "video";
  if (msg.type === "document") return "document";
  return "text";
}

function contentFromMsg(msg: EvolutionInboundMessage): string {
  if (msg.type === "text") return msg.text;
  if (msg.type === "audio") return "[Áudio]";
  if (msg.type === "image") return msg.caption ? `[Imagem] ${msg.caption}` : "[Imagem]";
  if (msg.type === "video") return msg.caption ? `[Vídeo] ${msg.caption}` : "[Vídeo]";
  if (msg.type === "document") {
    const name = msg.fileName?.trim() || "documento";
    return msg.caption ? `[Documento] ${name} — ${msg.caption}` : `[Documento] ${name}`;
  }
  return "";
}

function inboundLanguageSource(msg: EvolutionInboundMessage, fallbackText = ""): string {
  if (msg.type === "text") return msg.text;
  if (msg.type === "image" || msg.type === "video" || msg.type === "document") {
    return msg.caption || fallbackText;
  }
  return fallbackText;
}

function localizedMediaFailureReply(
  languageCode: SupportedLanguageCode,
  mediaLabel: "audio" | "image" | "video",
): string {
  const labels: Record<SupportedLanguageCode, Record<"audio" | "image" | "video", string>> = {
    pt: { audio: "áudio", image: "imagem", video: "vídeo" },
    en: { audio: "audio", image: "image", video: "video" },
    es: { audio: "audio", image: "imagen", video: "video" },
    fr: { audio: "audio", image: "image", video: "vidéo" },
    de: { audio: "Audio", image: "Bild", video: "Video" },
    it: { audio: "audio", image: "immagine", video: "video" },
  };
  const replies: Record<SupportedLanguageCode, string> = {
    pt: `Recebi seu ${labels.pt[mediaLabel]} mas não consegui processar. Pode enviar em texto?`,
    en: `I received your ${labels.en[mediaLabel]}, but I couldn't process it. Could you send it as text?`,
    es: `Recibí tu ${labels.es[mediaLabel]}, pero no pude procesarlo. ¿Puedes enviarlo en texto?`,
    fr: `J'ai bien reçu votre ${labels.fr[mediaLabel]}, mais je n'ai pas pu le traiter. Pouvez-vous l'envoyer en texte ?`,
    de: `Ich habe Ihr ${labels.de[mediaLabel]} erhalten, konnte es aber nicht verarbeiten. Können Sie es als Text senden?`,
    it: `Ho ricevuto il tuo ${labels.it[mediaLabel]}, ma non sono riuscito a elaborarlo. Puoi inviarlo come testo?`,
  };
  return replies[languageCode];
}

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

function pickContactName(row: Record<string, unknown>): string | null {
  const fields = ["pushName", "pushname", "notifyName", "senderName", "contactName", "name"];
  for (const field of fields) {
    const value = row[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function extractContactNameFromPayload(
  payload: Record<string, unknown>,
  msg: EvolutionInboundMessage,
): string | null {
  function visit(value: unknown, depth: number): string | null {
    if (!value || depth > 8) return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    if (typeof value !== "object") return null;

    const row = value as Record<string, unknown>;
    const key = row.key;
    const keyRecord = key && typeof key === "object" ? (key as Record<string, unknown>) : null;
    const matchesMessage =
      keyRecord?.remoteJid === msg.remoteJid ||
      keyRecord?.remoteJidAlt === msg.remoteJid ||
      keyRecord?.id === msg.messageId ||
      row.remoteJid === msg.remoteJid ||
      row.id === msg.messageId;

    if (matchesMessage) {
      const name = pickContactName(row);
      if (name) return name;
    }

    for (const child of Object.values(row)) {
      const found = visit(child, depth + 1);
      if (found) return found;
    }
    return null;
  }

  return visit(payload, 0);
}

function mimeToExt(mimetype: string): string {
  const base = mimetype.split(";")[0]?.trim() ?? mimetype;
  return base.split("/")[1]?.trim() ?? "bin";
}

/**
 * Tenta baixar a mídia (CDN → Evolution API fallback) e faz upload para o R2.
 * Retorna a URL proxy `/api/client/media/...` ou null em caso de falha.
 * Nunca lança excepção.
 */
async function downloadAndStoreMedia(
  msg: EvolutionInboundMessage,
  tenantId: string,
  instanceName: string,
): Promise<{ mediaUrl: string; storageKey: string; mimeType: string; fileName: string | null; caption: string | null; durationSeconds: number | null } | null> {
  if (msg.type !== "audio" && msg.type !== "image" && msg.type !== "video" && msg.type !== "document") {
    return null;
  }

  const { mimetype, rawNode } = msg;
  const ext = mimeToExt(mimetype);
  const safeId = (msg.messageId || String(Date.now())).replace(/[^a-zA-Z0-9_-]/g, "");
  const fileName =
    msg.type === "document" && msg.fileName?.trim() ? msg.fileName.trim() : `${safeId}.${ext}`;
  const filename = `whatsapp/${tenantId}/${safeId}_${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

  let buffer: Buffer | null = null;

  // 0. Prioridade máxima: base64 pré-decodificado que vem no rawNode do webhook
  //    (Evolution API configurada com webhookBase64: true já inclui os bytes no payload)
  const rawBase64 = typeof rawNode.base64 === "string" && rawNode.base64.length > 0
    ? rawNode.base64
    : null;

  if (rawBase64) {
    let b64 = rawBase64;
    if (b64.startsWith("data:")) {
      const commaIdx = b64.indexOf(",");
      if (commaIdx !== -1) b64 = b64.slice(commaIdx + 1);
    }
    try {
      buffer = Buffer.from(b64, "base64");
      console.log("[webhooks/evolution] media base64 do rawNode ok", buffer.byteLength, "bytes");
    } catch {
      buffer = null;
    }
  }

  // 1. Fallback: Evolution API /chat/getBase64FromMediaMessage (Baileys descriptografa)
  //    NOTA: CDN da Meta serve dados ENCRIPTADOS — fetch directo CDN é inútil sem
  //    a mediaKey. Saltamos para Evolution API que usa Baileys para decriptar.
  if (!buffer) {
    console.log("[webhooks/evolution] rawNode.base64 ausente — tentando Evolution API");
    const evoBase = process.env.EVOLUTION_API_BASE_URL?.replace(/\/+$/, "") ?? "";
    const evoKey =
      process.env.EVOLUTION_API_KEY?.trim() ||
      process.env.AUTHENTICATION_API_KEY?.trim() ||
      "";
    if (evoBase && evoKey) {
      const messageField =
        msg.type === "audio"
          ? "audioMessage"
          : msg.type === "video"
            ? "videoMessage"
            : msg.type === "document"
              ? "documentMessage"
              : "imageMessage";
      try {
        const res = await fetch(
          `${evoBase}/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: evoKey },
            body: JSON.stringify({
              message: {
                key: { remoteJid: msg.remoteJid, fromMe: msg.fromMe, id: msg.messageId },
                message: { [messageField]: rawNode },
              },
            }),
            signal: AbortSignal.timeout(15_000),
          },
        );
        if (res.ok) {
          const json = (await res.json()) as Record<string, unknown>;
          let b64 = typeof json.base64 === "string" ? json.base64 : null;
          if (b64?.startsWith("data:")) b64 = b64.slice(b64.indexOf(",") + 1);
          if (b64) {
            buffer = Buffer.from(b64, "base64");
            console.log("[webhooks/evolution] media Evolution ok", buffer.byteLength, "bytes");
          }
        } else {
          const errBody = await res.text().catch(() => "");
          console.warn("[webhooks/evolution] media Evolution non-ok", res.status, errBody.slice(0, 200));
        }
      } catch (e) {
        console.warn("[webhooks/evolution] media Evolution error", e instanceof Error ? e.message : e);
      }
    } else {
      console.warn("[webhooks/evolution] EVOLUTION_API_BASE_URL ou EVOLUTION_API_KEY não configurados");
    }
  }

  if (!buffer) {
    console.warn("[webhooks/evolution] media download falhou para", msg.messageId);
    return null;
  }

  const key = await uploadMediaToR2(buffer, filename, mimetype);
  if (!key) return null;

  return {
    mediaUrl: `/api/client/media/${filename}`,
    storageKey: key,
    mimeType: mimetype,
    fileName: msg.type === "document" ? fileName : null,
    caption: "caption" in msg && typeof msg.caption === "string" ? msg.caption : null,
    durationSeconds: msg.type === "video" && typeof msg.seconds === "number" ? msg.seconds : null,
  };
}

async function saveMessage(opts: {
  tenantId: string;
  remoteJid: string;
  direction: "inbound" | "outbound";
  kind: "text" | "audio" | "image" | "video" | "document";
  content: string;
  messageId?: string | null;
  agentId?: string | null;
  leadId?: string | null;
  mediaUrl?: string | null;
  mimeType?: string | null;
  storageKey?: string | null;
  fileName?: string | null;
  caption?: string | null;
  mediaDurationSeconds?: number | null;
  transcriptionStatus?: string | null;
  analysisStatus?: string | null;
}): Promise<{ id?: string; created_at?: string } | null> {
  try {
    const sb = createSupabaseServiceClient();
    const { data, error } = await sb
      .from("whatsapp_messages")
      .insert({
        tenant_id: opts.tenantId,
        remote_jid: opts.remoteJid,
        direction: opts.direction,
        kind: opts.kind,
        content: opts.content,
        message_id: opts.messageId ?? null,
        agent_id: opts.agentId ?? null,
        lead_id: opts.leadId ?? null,
        media_url: opts.mediaUrl ?? null,
        mime_type: opts.mimeType ?? null,
        storage_key: opts.storageKey ?? null,
        file_name: opts.fileName ?? null,
        caption: opts.caption ?? null,
        media_duration_seconds: opts.mediaDurationSeconds ?? null,
        transcription_status: opts.transcriptionStatus ?? null,
        analysis_status: opts.analysisStatus ?? null,
      })
      .select("id, created_at")
      .single();
    if (error) console.warn("[webhooks/evolution] saveMessage error", error.code, error.message);
    return (data as { id?: string; created_at?: string } | null) ?? null;
  } catch (e) {
    console.warn("[webhooks/evolution] saveMessage exception", e);
    return null;
  }
}

/**
 * Evolution API v2 → eventos `MESSAGES_UPSERT`, `CONNECTION_UPDATE`.
 * Suporta mensagens de texto, áudio (Whisper) e imagem (GPT-4o vision).
 * URL: `/api/webhooks/evolution?token=EVOLUTION_WEBHOOK_SECRET`
 */
export async function POST(request: Request) {
  if (!verifyWebhookToken(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const payloads: Record<string, unknown>[] = [];
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const r = asRecord(item);
      if (r) payloads.push(r);
    }
  } else {
    const r = asRecord(parsed);
    if (r) payloads.push(r);
  }

  for (const payload of payloads) {
    const instanceName = extractInstanceName(payload);
    if (!instanceName) continue;

    const event = normalizeEvolutionEventName(payload.event);

    if (event === "CONNECTION_UPDATE") {
      const state = extractConnectionState(payload);
      const waJid = extractInstanceJid(payload);
      if (state) {
        try {
          await updateEvolutionInstanceStateByName({
            instanceName,
            connectionState: state,
            waJid: waJid ?? undefined,
          });
        } catch (e) {
          console.warn("[webhooks/evolution] connection update db", e);
        }
      }
      continue;
    }

    if (event !== "MESSAGES_UPSERT") continue;

    // [DEBUG TEMPORÁRIO] Loga payload completo quando contém áudio/imagem para
    // confirmarmos onde a Evolution (webhookBase64: true) coloca o campo base64.
    // REMOVER após investigação concluída.
    {
      const rawJson = JSON.stringify(payload);
      if (rawJson.includes('"audioMessage"') || rawJson.includes('"imageMessage"') || rawJson.includes('"videoMessage"')) {
        console.log("RAW PAYLOAD MEDIA:", JSON.stringify(payload, null, 2));
      }
    }

    let row: Awaited<ReturnType<typeof getEvolutionInstanceByName>> = null;
    try {
      row = await getEvolutionInstanceByName(instanceName);
    } catch (e) {
      console.warn("[webhooks/evolution] db lookup", instanceName, e);
      continue;
    }
    if (!row) {
      console.warn("[webhooks/evolution] instance not registered", instanceName);
      continue;
    }
    const instanceJid = row.wa_jid ?? extractInstanceJid(payload);

    const inbound = extractInboundMessagesFromEvolutionPayload(payload);

    // Bug 3 fix: split the per-message loop into two serial phases so that ALL messages
    // from a batch Evolution payload are persisted to DB before any smart-wait flow starts.
    // Previously, await runInboundSmartWaitFlow() blocked the for-loop, preventing messages
    // 2+ from being saved while message 1's job was being processed (up to 60 s wait).
    // With the two-phase approach, Phase 1 saves every message in parallel, then Phase 2
    // triggers automation flows in parallel — ensuring complete burst accumulation.

    // ── Phase 1: save all messages to DB ────────────────────────────────────
    const savedContexts = await Promise.all(
      inbound.map(async (msg) => {
        try {
          const agentId = await resolveEvolutionAgentId(row.tenant_id, row.default_agent_id);

          let inboundMedia: Awaited<ReturnType<typeof downloadAndStoreMedia>> = null;
          if (msg.type === "audio" || msg.type === "image" || msg.type === "video" || msg.type === "document") {
            inboundMedia = await downloadAndStoreMedia(msg, row.tenant_id, instanceName);
          }

          const contactName = extractContactNameFromPayload(payload, msg);
          const upsertedLead = await upsertLeadFromWhatsAppContact({
            tenantId: row.tenant_id,
            remoteJid: msg.remoteJid,
            senderJid: msg.remoteJid,
            instanceJid,
            contactName,
            direction: "inbound",
            agentId,
            conversationId: msg.remoteJid,
          });
          const leadId = upsertedLead?.lead?.id ?? null;

          const inboundSaved = await saveMessage({
            tenantId: row.tenant_id,
            remoteJid: msg.remoteJid,
            direction: "inbound",
            kind: kindFromMsg(msg),
            content: contentFromMsg(msg),
            messageId: msg.messageId,
            leadId,
            mediaUrl: inboundMedia?.mediaUrl ?? null,
            mimeType: inboundMedia?.mimeType ?? ("mimetype" in msg ? msg.mimetype : null),
            storageKey: inboundMedia?.storageKey ?? null,
            fileName: inboundMedia?.fileName ?? null,
            caption: inboundMedia?.caption ?? null,
            mediaDurationSeconds: inboundMedia?.durationSeconds ?? null,
            transcriptionStatus: msg.type === "audio" ? "pending" : null,
            analysisStatus:
              msg.type === "video" ? "unsupported" : msg.type === "image" ? "pending" : null,
          });

          const sbState = createSupabaseServiceClient();
          const state = await revealConversationOnInbound({
            sb: sbState,
            tenantId: row.tenant_id,
            remoteJid: msg.remoteJid,
            leadId,
            agentId,
            lastMessageAt: inboundSaved?.created_at ?? new Date().toISOString(),
          });

          await applyHumanConversationCommand({
            sb: sbState,
            tenantId: row.tenant_id,
            remoteJid: msg.remoteJid,
            leadId,
            agentId,
            text: contentFromMsg(msg),
            occurredAt: inboundSaved?.created_at ?? new Date().toISOString(),
          });

          try {
            const { data: agentMetaRow } = await sbState
              .from("tenant_agents")
              .select("metadata")
              .eq("tenant_id", row.tenant_id)
              .eq("agent_id", agentId)
              .maybeSingle();
            const agentMetadata =
              agentMetaRow?.metadata && typeof agentMetaRow.metadata === "object"
                ? (agentMetaRow.metadata as Record<string, unknown>)
                : {};
            await scheduleFollowUpAfterInbound({
              sb: sbState,
              tenantId: row.tenant_id,
              agentId,
              remoteJid: msg.remoteJid,
              leadId,
              settings: followUpInteligenteFromMetadata(agentMetadata),
            });
          } catch (followUpErr) {
            console.warn(
              "[webhooks/evolution] follow-up schedule",
              followUpErr instanceof Error ? followUpErr.message : followUpErr,
            );
          }

          const inboundLanguageCode = detectSupportedLanguageCode(inboundLanguageSource(msg));

          return { msg, agentId, inboundMedia, contactName, leadId, inboundSaved, state, inboundLanguageCode };
        } catch (e) {
          console.warn("[webhooks/evolution] Phase 1 save error", e instanceof Error ? e.message : e);
          return null;
        }
      }),
    );

    // ── Phase 2: run automation flows in parallel (all messages already in DB) ──
    await Promise.all(
      savedContexts.map(async (ctx) => {
        if (!ctx) return;
        const { msg, agentId, contactName, leadId, inboundSaved, state, inboundLanguageCode } = ctx;
        try {
          const sbState = createSupabaseServiceClient();

          const automationAllowed = await isAgentAutomationAllowed({
            sb: sbState,
            tenantId: row.tenant_id,
            remoteJid: msg.remoteJid,
            agentId,
          });
          if (!automationAllowed.ok) {
            console.info("[webhooks/evolution] agent skipped", {
              reason: automationAllowed.reason,
              tenant_id: row.tenant_id,
              agent_id: agentId,
              remote_jid_last4: msg.remoteJid.replace(/\D/g, "").slice(-4),
            });
            return;
          }

          const agentConfig = await sbState
            .from("tenant_agents")
            .select("metadata")
            .eq("tenant_id", row.tenant_id)
            .eq("agent_id", agentId)
            .maybeSingle();
          const metadata = agentConfig.data?.metadata && typeof agentConfig.data.metadata === "object"
            ? (agentConfig.data.metadata as Record<string, unknown>)
            : {};
          const smartWait = smartWaitFromMetadata(metadata);
          const useSmartWait = smartWait.enabled && !isSmartWaitGloballyDisabled();
          let runImmediateReply = !useSmartWait;

          if (useSmartWait) {
            const inboundMessageKey = inboundSaved?.id ?? null;
            if (inboundMessageKey) {
              const flowResult = await runInboundSmartWaitFlow({
                sb: sbState,
                tenantId: row.tenant_id,
                remoteJid: msg.remoteJid,
                leadId,
                agentId,
                instanceName,
                inboundMessageKey,
                occurredAt: inboundSaved?.created_at ?? new Date().toISOString(),
                smartWait,
              });
              if (flowResult.mode === "smart_wait") {
                return;
              }
              runImmediateReply = true;
            } else {
              console.info("[agent-response-jobs]", {
                event: "job_create_failed",
                reason: "missing_inbound_message_uuid",
                tenant_id: row.tenant_id,
                remote_jid: msg.remoteJid.replace(/\D/g, "").slice(-4),
              });
              runImmediateReply = true;
            }
          }

          if (!runImmediateReply) return;

          const handoffKeywords = Array.isArray(metadata.handoffKeywords)
            ? metadata.handoffKeywords.filter((item): item is string => typeof item === "string")
            : [];
          const handoffEnabled = metadata.ctaHandoffAtivo === true;
          const handoffMessage =
            handoffEnabled && typeof metadata.handoffMensagem === "string" && metadata.handoffMensagem.trim()
              ? metadata.handoffMensagem.trim()
              : null;
          const handoffCheck = handoffEnabled
            ? shouldTriggerHandoff(inboundLanguageSource(msg), handoffKeywords)
            : { trigger: false, reason: null };

          const result = await generateAgentResponse({
            tenantId: row.tenant_id,
            agentId,
            conversationId: msg.remoteJid,
            customerId: msg.remoteJid,
            feature: "agent_chat",
            messages: [],
            mediaContent:
              msg.type === "audio" || msg.type === "image" || msg.type === "video" ? msg : undefined,
            instanceName: msg.type !== "text" ? instanceName : undefined,
          });

          let replyText: string;
          if (result.ok) {
            replyText = result.text;
          } else if (result.code === "MEDIA_DOWNLOAD_FAILED") {
            const mediaLabel =
              msg.type === "audio" ? "audio" : msg.type === "video" ? "video" : "image";
            replyText = localizedMediaFailureReply(inboundLanguageCode, mediaLabel);
          } else {
            replyText = localizedGenericFailureReply(inboundLanguageCode);
          }

          const number = remoteJidToEvoNumber(msg.remoteJid);
          if (!number) return;

          if (handoffCheck.trigger) {
            if (handoffMessage) replyText = handoffMessage;
            const messages = await getRecentConversationMessages({
              sb: sbState,
              tenantId: row.tenant_id,
              remoteJid: msg.remoteJid,
            });
            const summary = buildDeterministicHandoffSummary({
              lead: leadId ? {
                id: leadId,
                name: contactName,
                phone: msg.remoteJid.split("@")[0]?.replace(/\D/g, "") ?? null,
                source: "whatsapp",
                status: null,
                crmFunnelId: null,
                notes: null,
                agentId,
                aiSummary: null,
                leadTemperature: null,
                suggestedNextAction: null,
                profileMetadata: {},
              } : null,
              messages,
              reason: handoffCheck.reason ?? "handoff",
            });
            await saveConversationSummary({
              sb: sbState,
              tenantId: row.tenant_id,
              remoteJid: msg.remoteJid,
              stateId: state?.id,
              leadId,
              agentId,
              summary,
            });
            await markWaitingForHuman({
              sb: sbState,
              tenantId: row.tenant_id,
              remoteJid: msg.remoteJid,
              leadId,
              agentId,
              reason: handoffCheck.reason ?? "handoff",
              handoffNumero:
                typeof metadata.handoffNumero === "string" ? metadata.handoffNumero : null,
              lastMessage: inboundLanguageSource(msg),
            });
          }

          const outboundMediaParse = await resolveOutboundMediaForAgentResponse({
            sb: sbState,
            tenantId: row.tenant_id,
            agentId,
            responseText: replyText,
            userRequestText: inboundLanguageSource(msg),
          });
          const outboundFilenames = outboundMediaParse.filenames;
          replyText = outboundMediaParse.cleanedText.trim();
          if (!replyText && outboundFilenames.length) {
            replyText = "Segue o envio solicitado.";
          }
          console.info("[webhooks/evolution]", {
            event: "outbound_media_resolved",
            tenant_id: row.tenant_id,
            agent_id: agentId,
            filenames_count: outboundFilenames.length,
            inferred: outboundMediaParse.inferred,
          });

          const sendOutboundMediaSafe = async (): Promise<void> => {
            if (!outboundFilenames.length) return;
            try {
              await sendAgentOutboundMediaViaEvolution({
                tenantId: row.tenant_id,
                agentId,
                instanceName,
                number,
                originalFilenames: outboundFilenames,
              });
            } catch (err) {
              console.warn(
                "[webhooks/evolution] outbound agent media",
                err instanceof Error ? err.message : err,
              );
            }
          };

          // ── Verifica se o agente tem resposta em áudio (ElevenLabs TTS) ──────
          const sb2 = createSupabaseServiceClient();
          const { data: agentRow } = await sb2
            .from("tenant_agents")
            .select("voice_id, response_mode")
            .eq("tenant_id", row.tenant_id)
            .eq("agent_id", agentId)
            .maybeSingle();

          const { responseMode, voiceId } = sanitizeAgentResponseSettings({
            responseMode: agentRow?.response_mode,
            voiceId: agentRow?.voice_id,
          });
          const useAudio = msg.type === "audio" && responseMode === "audio" && Boolean(voiceId);

          if (useAudio) {
            // ── TTS via ElevenLabs → R2 → Evolution WhatsApp Audio ──────────
            try {
              const languageCode = detectSupportedLanguageCode(inboundLanguageSource(msg, replyText));
              const audioBuffer = await textToSpeechElevenLabs(replyText.slice(0, 5000), voiceId!, {
                languageCode,
              });
              const ttsKey = `whatsapp/${row.tenant_id}/tts/${Date.now()}_reply.mp3`;
              const r2Key = await uploadMediaToR2(audioBuffer, ttsKey, "audio/mpeg");
              const mediaUrl = r2Key ? `/api/client/media/${ttsKey}` : null;

              const audioB64 = audioBuffer.toString("base64");
              const send = await evolutionSendAudio({
                instanceName,
                number,
                audio: audioB64,
              });

              if (!send.ok) {
                console.error("[webhooks/evolution] sendAudio (TTS)", send.status, send.error);
              } else {
                await saveMessage({
                  tenantId: row.tenant_id,
                  remoteJid: msg.remoteJid,
                  direction: "outbound",
                  kind: "audio",
                  content: replyText.slice(0, 4000),
                  agentId,
                  mediaUrl,
                });
                await upsertLeadFromWhatsAppContact({
                  tenantId: row.tenant_id,
                  remoteJid: msg.remoteJid,
                  recipientJid: msg.remoteJid,
                  instanceJid,
                  contactName,
                  direction: "outbound",
                  agentId,
                  conversationId: msg.remoteJid,
                });
                await sendOutboundMediaSafe();
              }
            } catch (ttsErr) {
              console.error("[webhooks/evolution] TTS error — fallback to text", ttsErr instanceof Error ? ttsErr.message : ttsErr);
              // Fallback: envia como texto se TTS falhar
              const fallback = await evolutionSendText({ instanceName, number, text: replyText.slice(0, 4000) });
              if (fallback.ok) {
                await saveMessage({
                  tenantId: row.tenant_id,
                  remoteJid: msg.remoteJid,
                  direction: "outbound",
                  kind: "text",
                  content: replyText.slice(0, 4000),
                  agentId,
                });
                await upsertLeadFromWhatsAppContact({
                  tenantId: row.tenant_id,
                  remoteJid: msg.remoteJid,
                  recipientJid: msg.remoteJid,
                  instanceJid,
                  contactName,
                  direction: "outbound",
                  agentId,
                  conversationId: msg.remoteJid,
                });
                await sendOutboundMediaSafe();
              }
            }
          } else {
            // ── Envio de texto padrão ─────────────────────────────────────────
            const send = await evolutionSendText({
              instanceName,
              number,
              text: replyText.slice(0, 4000),
            });

            if (!send.ok) {
              console.error("[webhooks/evolution] sendText", send.status, send.error);
            } else {
              await saveMessage({
                tenantId: row.tenant_id,
                remoteJid: msg.remoteJid,
                direction: "outbound",
                kind: "text",
                content: replyText.slice(0, 4000),
                agentId,
              });
              await upsertLeadFromWhatsAppContact({
                tenantId: row.tenant_id,
                remoteJid: msg.remoteJid,
                recipientJid: msg.remoteJid,
                instanceJid,
                contactName,
                direction: "outbound",
                agentId,
                conversationId: msg.remoteJid,
              });
              await sendOutboundMediaSafe();
            }
          }
        } catch (e) {
          console.warn("[webhooks/evolution] Phase 2 flow error", e instanceof Error ? e.message : e);
        }
      }),
    );
  }

  return NextResponse.json({ ok: true });
}
