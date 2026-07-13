import { NextResponse } from "next/server";
import {
  generateAgentResponse,
  isAgentMissingInstructionsResult,
} from "@/lib/ai/generate-agent-response";
import { detectSupportedLanguageCode, type SupportedLanguageCode } from "@/lib/ai/language-detect";
import {
  canUseTts,
  inboundKindFromEvolutionType,
  resolveAgentResponseSettingsFromStorage,
} from "@/lib/agents";
import {
  extractConnectionState,
  extractConnectionStatusReason,
  extractInboundMessagesFromEvolutionPayload,
  extractInstanceJid,
  extractInstanceName,
  extractMessageDeliveryUpdates,
  normalizeEvolutionEventName,
  isTerminalEvolutionDisconnectReason,
  type EvolutionInboundMessage,
} from "@/lib/integrations/evolution-webhook-parse";
import {
  evolutionFetchInstances,
  evolutionSendText,
  normalizeEvolutionConnectionState,
  pickEvolutionInstanceInfo,
  remoteJidToEvoNumber,
} from "@/lib/integrations/evolution-api";
import { isElevenlabsConfigured } from "@/lib/integrations/elevenlabs";
import { deliverAgentReplyWithOptionalTts } from "@/lib/server/agent-tts-outbound";
import { resolveOutboundMediaForAgentResponse } from "@/lib/server/agent-media-files";
import { sendAgentOutboundMediaViaEvolution } from "@/lib/server/send-agent-outbound-media-evolution";
import { getEvolutionInstanceByName, updateEvolutionInstanceStateByName } from "@/lib/server/tenant-evolution-instance-db";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { uploadMediaToR2 } from "@/lib/integrations/r2-storage";
import {
  buildDeterministicHandoffSummary,
  getConversationState,
  getRecentConversationMessages,
  saveConversationSummary,
  shouldTriggerHandoffAI,
  upsertConversationState,
} from "@/lib/server/conversation-memory";
import { applyHumanConversationCommand } from "@/lib/server/conversation-human-control";
import { revealConversationOnInbound } from "@/lib/server/conversation-visibility";
import { isAgentAutomationAllowed, markWaitingForHuman } from "@/lib/server/conversation-operation";
import { canAgentAutoContactLead } from "@/lib/server/agent-auto-contact-guard";
import { smartWaitFromMetadata } from "@/lib/agents/smart-wait-settings";
import { isSmartWaitGloballyDisabled, runInboundSmartWaitFlow } from "@/lib/server/evolution-webhook-agent-flow";
import { scheduleFollowUpAfterInbound, scheduleRetomadaJob } from "@/lib/server/follow-up-jobs";
import { followUpInteligenteFromMetadata } from "@/lib/server/follow-up-settings";
import {
  notifyTenantIntegrationConnected,
  notifyTenantIntegrationDisconnected,
  shouldNotifyWhatsappConnect,
  shouldNotifyWhatsappDisconnect,
} from "@/lib/server/integration-disconnect-notifications";
import {
  SYSTEM_TENANT_ID,
  getSystemEvolutionInstancePrefix,
  isMetaProviderActive,
  processSystemMessagesUpdate,
} from "@/lib/server/system-agent";
import { getSlotActiveProvider } from "@/lib/server/whatsapp-slot-provider";
import { resolveAgentTimezone } from "@/lib/agents/agent-datetime";
import {
  AGENDA_AUTOMATION_DISABLED_REPLY,
  priorAgendaAssistantTextFromMessages,
  resolveAgendaTurn,
  shouldDeferHandoffForAgendaResult,
} from "@/lib/server/agent-cta-scheduler";
import type { AgentFollowUpInteligente } from "@/lib/types";
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
import {
  commitTenantLeadQuotaReservation,
  releaseTenantLeadQuotaReservation,
  reserveTenantLeadQuota,
} from "@/lib/server/lead-quota";
import { getTenantPlanSnapshot } from "@/lib/server/tenant-plan-snapshot";
import { processCustomerMessageDeliveryUpdate } from "@/lib/server/evolution-customer-delivery";
import { extractEvolutionSendReceipt } from "@/lib/integrations/evolution-message-receipt";


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

/**
 * Resultado de saveMessage.
 * `duplicate: true` significa que o message_id já existia na DB (webhook retry da Evolution API).
 * Quando duplicate=true o chamador deve pular todo o fluxo de automação para essa mensagem.
 */
type SaveMessageResult =
  | { duplicate: false; id: string; created_at: string }
  | { duplicate: true }
  | null;

async function saveMessage(opts: {
  tenantId: string;
  remoteJid: string;
  direction: "inbound" | "outbound";
  kind: "text" | "audio" | "image" | "video" | "document";
  content: string;
  messageId?: string | null;
  agentId?: string | null;
  leadId?: string | null;
  journeyId?: string | null;
  mediaUrl?: string | null;
  mimeType?: string | null;
  storageKey?: string | null;
  fileName?: string | null;
  caption?: string | null;
  mediaDurationSeconds?: number | null;
  transcriptionStatus?: string | null;
  analysisStatus?: string | null;
  /** UUID de tenant_evolution_instances — identifica qual das linhas QR do tenant processou isto. */
  connectionId?: string | null;
  providerMessageId?: string | null;
  providerRemoteJid?: string | null;
  providerStatus?: string | null;
  deliveryStatus?: string | null;
}): Promise<SaveMessageResult> {
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
        journey_id: opts.journeyId ?? null,
        media_url: opts.mediaUrl ?? null,
        mime_type: opts.mimeType ?? null,
        storage_key: opts.storageKey ?? null,
        file_name: opts.fileName ?? null,
        caption: opts.caption ?? null,
        media_duration_seconds: opts.mediaDurationSeconds ?? null,
        transcription_status: opts.transcriptionStatus ?? null,
        analysis_status: opts.analysisStatus ?? null,
        // Toda linha gravada por esta função veio do webhook Evolution — usado
        // pelo painel "Conversas ao vivo" para filtrar por canal.
        channel: "evolution",
        // Identifica QUAL linha QR do tenant (pode ter várias) — usado pelo
        // filtro por número em /dashboard/conversas.
        connection_id: opts.connectionId ?? null,
        provider_message_id: opts.providerMessageId ?? null,
        provider_remote_jid: opts.providerRemoteJid ?? null,
        provider_status: opts.providerStatus ?? null,
        ...(opts.deliveryStatus ? { delivery_status: opts.deliveryStatus } : {}),
      })
      // Deduplicação: a constraint UNIQUE (tenant_id, message_id) WHERE message_id IS NOT NULL
      // garante que um retry da Evolution API não crie um segundo job de resposta.
      // Se o message_id já existir, o INSERT é silenciosamente ignorado (RETURNING vazio → null).
      .select("id, created_at")
      .maybeSingle();

    if (error) {
      // Erro real (não conflito) — logar e retornar null
      console.warn("[webhooks/evolution] saveMessage error", error.code, error.message);
      return null;
    }

    if (!data) {
      // RETURNING vazio = conflito de unique → mensagem duplicada (retry da Evolution API)
      console.info("[webhooks/evolution] saveMessage duplicate skipped", {
        message_id: opts.messageId,
        tenant_id: opts.tenantId,
        remote_jid_last4: opts.remoteJid.replace(/\D/g, "").slice(-4),
      });
      return { duplicate: true };
    }

    const row = data as { id: string; created_at: string };
    return { duplicate: false, id: row.id, created_at: row.created_at };
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
      const statusReason = extractConnectionStatusReason(payload);
      const terminalDisconnect =
        normalizeEvolutionConnectionState(state, "close") !== "open" &&
        isTerminalEvolutionDisconnectReason(statusReason);
      const waJid = extractInstanceJid(payload);
      if (state) {
        try {
          const previousRow = await getEvolutionInstanceByName(instanceName);

          // O evento CONNECTION_UPDATE pode reportar um estado não-"open" num blip
          // momentâneo de rede que o Baileys resolve sozinho (reconexão automática),
          // não necessariamente um logout real. Antes de tratar como desconexão de
          // verdade, confirma via fetchInstances (fonte de verdade já usada para
          // validar conexões — ver evolution-api.ts) se ainda há uma sessão viva.
          let confirmedState = state;
          let confirmedWaJid = waJid;
          if (
            !terminalDisconnect &&
            previousRow &&
            normalizeEvolutionConnectionState(previousRow.connection_state, "close") === "open" &&
            normalizeEvolutionConnectionState(state, "close") !== "open"
          ) {
            const fetchResult = await evolutionFetchInstances(instanceName);
            if (fetchResult.ok) {
              const instanceInfo = pickEvolutionInstanceInfo(fetchResult.data, instanceName);
              if (instanceInfo?.ownerJid) {
                confirmedState = "open";
                confirmedWaJid = instanceInfo.ownerJid;
              }
            }
          }

          await updateEvolutionInstanceStateByName({
            instanceName,
            connectionState: confirmedState,
            waJid: terminalDisconnect ? null : confirmedWaJid ?? undefined,
            preserveLifecycle: true,
          });
          if (terminalDisconnect) {
            console.warn("[webhooks/evolution] terminal_disconnect", {
              instance_name: instanceName,
              status_reason: statusReason,
            });
          }
          if (
            previousRow &&
            previousRow.tenant_id !== SYSTEM_TENANT_ID &&
            shouldNotifyWhatsappDisconnect({
              previousState: previousRow.connection_state,
              nextState: confirmedState,
            })
          ) {
            try {
              await notifyTenantIntegrationDisconnected({
                tenantId: previousRow.tenant_id,
                integration: "whatsapp",
                source: "evolution_connection_update",
                sourceKey: previousRow.instance_name,
                instanceName: previousRow.instance_name,
                state: confirmedState,
                previousState: previousRow.connection_state,
                manual: false,
                metadata: {
                  slot_index: previousRow.slot_index,
                  wa_jid: confirmedWaJid ?? previousRow.wa_jid ?? null,
                },
              });
            } catch (notifyError) {
              console.warn("[webhooks/evolution] disconnect notification failed", notifyError);
            }
          }
          // Exige um waJid fresco (do evento, ou confirmado acima via fetchInstances) —
          // não o valor antigo em cache de previousRow.wa_jid. Uma conexão genuína
          // sempre traz o JID junto; sem ele, não há prova de que "open" é uma sessão
          // nova de verdade.
          if (
            previousRow &&
            previousRow.tenant_id !== SYSTEM_TENANT_ID &&
            confirmedWaJid &&
            shouldNotifyWhatsappConnect({
              previousState: previousRow.connection_state,
              nextState: confirmedState,
            })
          ) {
            try {
              await notifyTenantIntegrationConnected({
                tenantId: previousRow.tenant_id,
                integration: "whatsapp",
                source: "evolution_connection_update",
                sourceKey: previousRow.instance_name,
                instanceName: previousRow.instance_name,
                waJid: confirmedWaJid,
                metadata: {
                  slot_index: previousRow.slot_index,
                },
              });
            } catch (notifyError) {
              console.warn("[webhooks/evolution] connect notification failed", notifyError);
            }
          }
        } catch (e) {
          console.warn("[webhooks/evolution] connection update db", e);
        }
      }
      continue;
    }

    if (event === "MESSAGES_UPDATE") {
      try {
        // Reconhece a instância do sistema pelo prefixo determinístico do nome
        // (mc<hash do tenant-system-internal>…) ANTES de depender da linha no
        // banco. A linha em tenant_evolution_instances pode estar ausente
        // (apagada num reset/reconexão) enquanto a instância segue ativa na
        // Evolution — sem este fallback, todo MESSAGES_UPDATE de entrega era
        // descartado e a confirmação "entregue" nunca acontecia.
        const systemPrefix = getSystemEvolutionInstancePrefix();
        const row = await getEvolutionInstanceByName(instanceName);
        const isSystemInstance =
          (row?.tenant_id === SYSTEM_TENANT_ID) ||
          (!!instanceName && instanceName.startsWith(systemPrefix));

        const updates = extractMessageDeliveryUpdates(payload);
        console.info("[webhooks/evolution] messages_update_seen", {
          instanceName,
          isSystemInstance,
          hasDbRow: Boolean(row),
          updateCount: updates.length,
          fromMeCount: updates.filter((u) => u.fromMe).length,
          statuses: updates.map((u) => u.status),
        });

        for (const update of updates) {
          if (!update.fromMe) continue;

          if (isSystemInstance) {
            const result = await processSystemMessagesUpdate({
              instanceName,
              messageId: update.messageId,
              status: update.status,
              fromMe: update.fromMe,
            });
            if (result === "buffered") {
              console.info("[webhooks/evolution] system_delivery_buffered_orphan", {
                messageId: update.messageId,
              });
            }
            continue;
          }

          if (!row?.tenant_id) continue;
          const result = await processCustomerMessageDeliveryUpdate({
            tenantId: row.tenant_id,
            connectionId: row.id,
            providerMessageId: update.messageId,
            status: update.status,
          });
          console.info("[webhooks/evolution] customer_delivery_update", {
            tenant_id: row.tenant_id,
            connection_id: row.id,
            status: update.status,
            result,
          });
        }
      } catch (e) {
        console.warn("[webhooks/evolution] messages update system delivery", e);
      }
      continue;
    }

    if (event !== "MESSAGES_UPSERT") continue;

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

    // The active-provider toggle must be obeyed 100%: while Meta is the chosen
    // channel for the system agent, inbound on its old Evolution number must
    // not be processed or auto-replied to — otherwise both channels could
    // answer the same contact inconsistently.
    if (row.tenant_id === SYSTEM_TENANT_ID && (await isMetaProviderActive())) {
      console.info("[webhooks/evolution] system_inbound_skipped_meta_active", { instanceName });
      continue;
    }

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
          const leadPhone = remoteJidToEvoNumber(msg.remoteJid);
          const sbJourney = createSupabaseServiceClient();
          const journeyAuth = await resolveDirectJourneyAgent({
            sb: sbJourney,
            tenantId: row.tenant_id,
            remoteJid: msg.remoteJid,
            connectionId: row.id,
          });
          const journey = journeyAuth.journey;
          const agentId = journeyAuth.ok ? journeyAuth.agentId : null;

          let inboundMedia: Awaited<ReturnType<typeof downloadAndStoreMedia>> = null;
          if (msg.type === "audio" || msg.type === "image" || msg.type === "video" || msg.type === "document") {
            inboundMedia = await downloadAndStoreMedia(msg, row.tenant_id, instanceName);
          }

          const contactName = extractContactNameFromPayload(payload, msg);
          const { data: existingLead } = leadPhone
            ? await sbJourney
                .from("leads")
                .select("id")
                .eq("tenant_id", row.tenant_id)
                .eq("phone", leadPhone)
                .order("updated_at", { ascending: false })
                .limit(1)
                .maybeSingle()
            : { data: null };
          const leadId =
            (existingLead as { id?: string } | null)?.id ??
            journey?.leadId ??
            null;

          const inboundSaved = await saveMessage({
            tenantId: row.tenant_id,
            remoteJid: msg.remoteJid,
            direction: "inbound",
            kind: kindFromMsg(msg),
            content: contentFromMsg(msg),
            messageId: msg.messageId,
            leadId,
            journeyId: journey?.id ?? null,
            connectionId: row.id,
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

          // Webhook retry da Evolution API — mensagem já processada anteriormente.
          // Retornar null para que Phase 2 ignore esta entrada e não gere resposta duplicada.
          if (inboundSaved?.duplicate === true) {
            console.info("[webhooks/evolution] duplicate message skipped", {
              message_id: msg.messageId,
              tenant_id: row.tenant_id,
              remote_jid_last4: msg.remoteJid.replace(/\D/g, "").slice(-4),
            });
            return null;
          }

          const savedAt =
            inboundSaved && !inboundSaved.duplicate ? inboundSaved.created_at : new Date().toISOString();

          const sbState = createSupabaseServiceClient();
          const state = await revealConversationOnInbound({
            sb: sbState,
            tenantId: row.tenant_id,
            remoteJid: msg.remoteJid,
            leadId,
            agentId,
            lastMessageAt: savedAt,
            activeJourneyId: journey?.id ?? null,
          });

          await applyHumanConversationCommand({
            sb: sbState,
            tenantId: row.tenant_id,
            remoteJid: msg.remoteJid,
            leadId,
            agentId,
            text: contentFromMsg(msg),
            occurredAt: savedAt,
          });

          try {
            if (agentId) {
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
                journeyId: journey?.id ?? null,
                settings: followUpInteligenteFromMetadata(agentMetadata),
              });
            }
          } catch (followUpErr) {
            console.warn(
              "[webhooks/evolution] follow-up schedule",
              followUpErr instanceof Error ? followUpErr.message : followUpErr,
            );
          }

          // Nota: a transcrição de áudio é feita directamente em processAgentResponseJob
          // (evolution-agent-reply.ts) lendo o buffer do R2 via storage_key.
          // O padrão fire-and-forget anterior foi removido porque o Vercel descarta
          // a conexão TCP antes de o endpoint /api/internal/transcribe-audio receber
          // a requisição (zero hits nos logs de produção).

          const inboundLanguageCode = detectSupportedLanguageCode(inboundLanguageSource(msg));

          if (journey) {
            await cancelLeadRedistributionTrigger({
              sb: sbJourney,
              tenantId: row.tenant_id,
              journeyId: journey.id,
              trigger: "customer_silence",
              reason: "customer_replied",
            });
            await touchLeadJourney({
              sb: sbJourney,
              tenantId: row.tenant_id,
              journeyId: journey.id,
              leadId,
              occurredAt: savedAt,
            });
          }

          return {
            msg,
            agentId,
            inboundMedia,
            contactName,
            leadId,
            journey,
            inboundSaved,
            state,
            inboundLanguageCode,
          };
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
        // O agente do sistema é só de notificação — nunca gera resposta
        // automática para quem manda mensagem pra ele, mesmo com Evolution/QR
        // ativo. A mensagem já foi salva na Phase 1 (aparece em "Conversas ao
        // vivo" para monitoramento); só o Phase 2 (IA/auto-reply) é pulado.
        if (row.tenant_id === SYSTEM_TENANT_ID) return;
        // Linha do cliente pode ter QR e Meta conectados ao mesmo tempo
        // (alternador em /dashboard/integracoes) — só o lado marcado como
        // ativo responde, evitando os dois lados responderem ao mesmo
        // contato. Mensagem já foi salva na Phase 1 independente disso.
        if ((await getSlotActiveProvider(row.tenant_id, row.slot_index)) !== "evolution") {
          console.info("[webhooks/evolution] auto_reply_skipped_inactive_provider", {
            tenant_id: row.tenant_id,
            slot_index: row.slot_index,
          });
          return;
        }
        const {
          msg,
          agentId,
          contactName,
          leadId,
          journey,
          inboundSaved,
          state,
          inboundLanguageCode,
        } = ctx;
        try {
          if (!agentId) {
            console.info("[webhooks/evolution] agent skipped", {
              reason: "blocked_no_direct_whatsapp_rule",
              tenant_id: row.tenant_id,
              remote_jid_last4: msg.remoteJid.replace(/\D/g, "").slice(-4),
            });
            return;
          }

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
            .select("metadata, voice_id, response_mode")
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
            const inboundMessageKey =
              inboundSaved && !inboundSaved.duplicate ? inboundSaved.id : null;
            if (inboundMessageKey) {
              const flowResult = await runInboundSmartWaitFlow({
                sb: sbState,
                tenantId: row.tenant_id,
                remoteJid: msg.remoteJid,
                leadId,
                journeyId: journey?.id ?? null,
                agentId,
                instanceName,
                inboundMessageKey,
                occurredAt:
                  inboundSaved && !inboundSaved.duplicate
                    ? inboundSaved.created_at
                    : new Date().toISOString(),
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
          // AI-based detection: universal, nicho-agnóstica, com fallback automático para keywords
          const handoffCheck = handoffEnabled
            ? await shouldTriggerHandoffAI(inboundLanguageSource(msg), handoffKeywords)
            : { trigger: false, reason: null };

          const autoContactGuard = await canAgentAutoContactLead({
            sb: sbState,
            tenantId: row.tenant_id,
            agentId,
            leadId,
            phone: msg.remoteJid,
            remoteJid: msg.remoteJid,
            journeyId: journey?.id ?? null,
            connectionId: row.id,
            triggerSource: "evolution_inbound_auto_reply",
          });
          if (!autoContactGuard.ok) {
            console.warn("[webhooks/evolution] auto contact blocked", {
              tenant_id: row.tenant_id,
              agent_id: agentId,
              lead_id: autoContactGuard.leadId,
              form_id: autoContactGuard.formId,
              reason: autoContactGuard.reason,
              remote_jid_last4: msg.remoteJid.replace(/\D/g, "").slice(-4),
            });
            return;
          }

          // Direct WhatsApp stays out of CRM by default, but the first AI
          // attendance is still a commercial lead. Reserve before generating
          // the reply and commit only after delivery succeeds.
          let directQuotaReservationId: string | null = null;
          if (journey?.source === "whatsapp_direct") {
            const tenantPlan = await getTenantPlanSnapshot(row.tenant_id);
            const admission = await reserveTenantLeadQuota({
              tenantId: row.tenant_id,
              plan: tenantPlan.plan,
              operationalLimits: tenantPlan.operationalLimits,
              contactKey: msg.remoteJid,
              source: "whatsapp_direct",
              idempotencyKey: `direct:${row.id}:${msg.remoteJid.split("@")[0]}`,
              isExistingContact: Boolean(leadId),
              metadata: { connection_id: row.id, journey_id: journey.id, agent_id: agentId },
            });
            if (!admission.admitted) {
              console.info("[webhooks/evolution] auto reply blocked by lead quota", {
                tenant_id: row.tenant_id,
                agent_id: agentId,
                reason: admission.reason,
                used: admission.used,
                cap: admission.cap,
              });
              return;
            }
            directQuotaReservationId = admission.eventId;
          }

          const schedulingTimezone = resolveAgentTimezone({
            timezone: typeof metadata.timezone === "string" ? metadata.timezone : undefined,
            followUpInteligente: metadata.followUpInteligente as AgentFollowUpInteligente | undefined,
          });
          const result = await generateAgentResponse({
            tenantId: row.tenant_id,
            agentId,
            conversationId: msg.remoteJid,
            journeyId: journey?.id ?? null,
            customerId: msg.remoteJid,
            feature: "agent_chat",
            messages: [],
            mediaContent:
              msg.type === "audio" || msg.type === "image" || msg.type === "video" ? msg : undefined,
            instanceName: msg.type !== "text" ? instanceName : undefined,
          });

          if (isAgentMissingInstructionsResult(result)) {
            await releaseTenantLeadQuotaReservation(
              directQuotaReservationId,
              "agent_missing_instructions",
            );
            console.warn("[webhooks/evolution] automatic reply blocked because agent has no instructions", {
              tenant_id: row.tenant_id,
              agent_id: agentId,
              journey_id: journey?.id ?? null,
              connection_id: row.id,
            });
            return;
          }

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

          // Prioridade do backend: a intenção do cliente aciona handoff mesmo se
          // o modelo esquecer [[HANDOFF]] ao combinar transferência + mídia.
          const userRequestedHandoff = handoffCheck.trigger;
          const aiMarkerHandoff = handoffEnabled && replyText.includes("[[HANDOFF]]");
          const modelTextWithoutHandoff = replyText.replace(/\[\[HANDOFF\]\]/gi, "").trim();
          const clientText = inboundLanguageSource(msg);
          const priorAssistantText = priorAgendaAssistantTextFromMessages(
            await getRecentConversationMessages({
              sb: sbState,
              tenantId: row.tenant_id,
              remoteJid: msg.remoteJid,
              limit: 12,
              journeyId: journey?.id ?? null,
            }),
          );
          const agendaTurn = await resolveAgendaTurn({
            sb: sbState,
            tenantId: row.tenant_id,
            remoteJid: msg.remoteJid,
            leadId,
            agentId,
            contactName,
            timezone: schedulingTimezone,
            modelText: modelTextWithoutHandoff,
            clientText,
            priorAssistantText,
            agendaAutomationEnabled: metadata.agendaAutomationEnabled === true,
            ctaHandoffAtivo: metadata.ctaHandoffAtivo === true,
            agendaLembretes:
              typeof metadata.agendaLembretes === "object" && metadata.agendaLembretes !== null
                ? (metadata.agendaLembretes as import("@/lib/types").AgentAgendaLembretes)
                : null,
            agendaDisponibilidade:
              typeof metadata.agendaDisponibilidade === "object" &&
              metadata.agendaDisponibilidade !== null
                ? (metadata.agendaDisponibilidade as import("@/lib/types").AgentAgendaDisponibilidade)
                : null,
            slotIndex:
              typeof metadata.whatsappSlotIndex === "number" ? metadata.whatsappSlotIndex : 0,
          });
          if (agendaTurn.action === "blocked" || agendaTurn.action === "failed") {
            console.info("[agent-agenda-turn]", {
              tenant_id: row.tenant_id,
              agent_id: agentId,
              action: agendaTurn.action,
            });
          }
          const preparedAgendaResponseText =
            agendaTurn.action === "blocked" ? AGENDA_AUTOMATION_DISABLED_REPLY : agendaTurn.text;
          let finalHandoffCheck = userRequestedHandoff || aiMarkerHandoff;
          if (shouldDeferHandoffForAgendaResult(agendaTurn)) {
            finalHandoffCheck = false;
          }
          const finalHandoffReason = handoffCheck.trigger
            ? (handoffCheck.reason ?? "handoff")
            : "ai_handoff";

          if (finalHandoffCheck) {

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
              reason: finalHandoffReason,
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
              reason: finalHandoffReason,
              handoffNumero:
                typeof metadata.handoffNumero === "string" ? metadata.handoffNumero : null,
              lastMessage: inboundLanguageSource(msg),
            });

            // Se o agente tem "Retomar só se humano abandonou" configurado, agenda um job
            // futuro para o momento do timeout — safety net para quando não há mensagens
            // inbound após o handoff (espelho do bloco em evolution-agent-reply.ts).
            const fuMeta = metadata?.followUpInteligente;
            if (fuMeta && typeof fuMeta === "object") {
              const fu = fuMeta as Record<string, unknown>;
              if (
                fu.ativo === true &&
                fu.retomadaApenasSeHumanoAbandonou === true &&
                typeof fu.retomadaHumanoTempoValor === "number"
              ) {
                const rawValor = fu.retomadaHumanoTempoValor as number;
                const rawUnidade = fu.retomadaHumanoTempoUnidade;
                const unidade =
                  rawUnidade === "minutos" || rawUnidade === "dias" ? rawUnidade : "horas";
                const ms =
                  unidade === "minutos"
                    ? rawValor * 60_000
                    : unidade === "dias"
                      ? rawValor * 86_400_000
                      : rawValor * 3_600_000;
                await scheduleRetomadaJob({
                  sb: sbState,
                  tenantId: row.tenant_id,
                  agentId,
                  remoteJid: msg.remoteJid,
                  leadId,
                  scheduledAt: new Date(Date.now() + ms),
                });
              }
            }
          }

          const outboundMediaParse = await resolveOutboundMediaForAgentResponse({
            sb: sbState,
            tenantId: row.tenant_id,
            agentId,
            responseText: preparedAgendaResponseText,
            userRequestText: inboundLanguageSource(msg),
          });
          const outboundFilenames = outboundMediaParse.filenames;
          replyText = outboundMediaParse.cleanedText.trim();
          if (finalHandoffCheck && handoffMessage) {
            replyText = handoffMessage;
          }
          if (agendaTurn.action === "blocked") {
            replyText = AGENDA_AUTOMATION_DISABLED_REPLY;
          } else if (agendaTurn.action === "failed") {
            replyText = agendaTurn.text;
          }
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

          // ── Modo de resposta: áudio só se inbound for áudio e agente em modo áudio ──
          const { responseMode, voiceId } = resolveAgentResponseSettingsFromStorage({
            response_mode: agentConfig.data?.response_mode,
            voice_id: agentConfig.data?.voice_id,
            metadata,
          });
          const inboundKind = inboundKindFromEvolutionType(msg.type);
          const useTts = canUseTts({
            agentResponseMode: responseMode,
            inboundKind,
            voiceId,
            elevenLabsAvailable: isElevenlabsConfigured(),
            handoffTriggered: finalHandoffCheck,
          });

          console.info("[webhooks/evolution]", {
            event: "response_mode_decision",
            tenant_id: row.tenant_id,
            agent_id: agentId,
            response_mode: responseMode,
            inbound_type: msg.type,
            inbound_kind: inboundKind,
            use_tts: useTts,
          });

          const languageCode = detectSupportedLanguageCode(inboundLanguageSource(msg, replyText));
          if (isJourneyIsolationEnabled()) {
            const currentJourney = await authorizeActiveJourney({
              sb: sbState,
              tenantId: row.tenant_id,
              remoteJid: msg.remoteJid,
              preferredAgentId: agentId,
              connectionId: row.id,
            });
            if (!currentJourney.ok || currentJourney.journey?.id !== journey?.id) {
              console.info("[webhooks/evolution] response cancelled before send", {
                tenant_id: row.tenant_id,
                reason: currentJourney.ok ? "journey_superseded_before_send" : currentJourney.reason,
              });
              await releaseTenantLeadQuotaReservation(directQuotaReservationId, "journey_superseded_before_send");
              return;
            }
          }
          const delivery = await deliverAgentReplyWithOptionalTts({
            instanceName,
            number,
            text: replyText,
            voiceId: voiceId ?? "",
            languageCode,
            tenantId: row.tenant_id,
            useTts: useTts && Boolean(voiceId),
            logScope: "webhooks/evolution",
            logContext: {
              tenant_id: row.tenant_id,
              agent_id: agentId,
              inbound_kind: inboundKind,
            },
            sendText: () =>
              evolutionSendText({
                instanceName,
                number,
                text: replyText.slice(0, 4000),
                resolveRecipient: true,
              }),
          });

          if (delivery.sent) {
            const receipt = extractEvolutionSendReceipt(delivery.providerPayload);
            await saveMessage({
              tenantId: row.tenant_id,
              remoteJid: msg.remoteJid,
              direction: "outbound",
              kind: delivery.channel === "audio" ? "audio" : "text",
              content: replyText.slice(0, 4000),
              agentId,
              leadId,
              journeyId: journey?.id ?? null,
              mediaUrl: delivery.mediaUrl,
              connectionId: row.id,
              providerMessageId: receipt.messageId,
              providerRemoteJid: receipt.remoteJid,
              providerStatus: receipt.providerStatus,
              deliveryStatus: receipt.deliveryStatus,
            });
            if (leadId) {
              await sbState
                .from("leads")
                .update({
                  last_message_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                })
                .eq("tenant_id", row.tenant_id)
                .eq("id", leadId);
            }
            if (journey) {
              await touchLeadJourney({
                sb: sbState,
                tenantId: row.tenant_id,
                journeyId: journey.id,
                leadId,
              });
              await scheduleLeadRedistribution({
                sb: sbState,
                tenantId: row.tenant_id,
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
            await sendOutboundMediaSafe();
          } else {
            console.error("[webhooks/evolution] outbound send failed after TTS gate");
            await releaseTenantLeadQuotaReservation(directQuotaReservationId, "initial_direct_delivery_failed");
          }
        } catch (e) {
          console.warn("[webhooks/evolution] Phase 2 flow error", e instanceof Error ? e.message : e);
        }
      }),
    );
  }

  return NextResponse.json({ ok: true });
}
