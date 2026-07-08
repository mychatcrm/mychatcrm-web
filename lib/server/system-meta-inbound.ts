/**
 * Pipeline de inbound da API Oficial Meta para o agente do sistema.
 *
 * O agente do sistema é só de notificação — não atende clientes. Quando o
 * número Meta configurado no /admin/system-agent recebe uma mensagem, ela é:
 *  1. salva (texto/áudio/imagem) em whatsapp_messages sob o tenant do sistema
 *     (aparece em "Conversas ao vivo" para monitoramento);
 *  2. interpretada (Whisper/GPT-4o vision) só para exibir um resumo legível
 *     no monitor — nunca gera nem envia resposta automática. Quem manda
 *     mensagem pra esse número é ignorado; o único envio deste agente é via
 *     sendSystemNotification (handoff, desconexão, teste, etc.).
 */
import { describeImageFromBuffer, transcribeAudioFromBuffer } from "@/lib/ai/media-processor";
import {
  fetchWhatsAppCloudMedia,
  type WhatsAppInboundMessage,
} from "@/lib/integrations/whatsapp-cloud";
import { uploadMediaToR2 } from "@/lib/integrations/r2-storage";
import { upsertLeadFromWhatsAppContact } from "@/lib/server/auto-lead-upsert";
import { getSystemAgentMetaConfig, SYSTEM_AGENT_ID, SYSTEM_TENANT_ID } from "@/lib/server/system-agent";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

function mimeToExt(mime: string): string {
  const base = mime.split(";")[0]?.trim() ?? mime;
  const sub = base.split("/")[1]?.trim() ?? "bin";
  if (sub === "mpeg") return "mp3";
  if (sub === "ogg") return "ogg";
  if (sub === "jpeg") return "jpg";
  return sub;
}

function toRemoteJid(waId: string): string {
  const digits = waId.replace(/\D/g, "");
  return `${digits}@s.whatsapp.net`;
}

type SaveArgs = {
  remoteJid: string;
  direction: "inbound" | "outbound";
  kind: "text" | "audio" | "image" | "video" | "document";
  content: string;
  messageId: string | null;
  leadId: string | null;
  mediaUrl?: string | null;
  mimeType?: string | null;
  storageKey?: string | null;
  caption?: string | null;
  deliveryStatus?: string | null;
};

async function saveSystemMessage(args: SaveArgs): Promise<string | null> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("whatsapp_messages")
    .insert({
      tenant_id: SYSTEM_TENANT_ID,
      remote_jid: args.remoteJid,
      direction: args.direction,
      kind: args.kind,
      content: args.content,
      message_id: args.messageId,
      agent_id: SYSTEM_AGENT_ID,
      lead_id: args.leadId,
      media_url: args.mediaUrl ?? null,
      mime_type: args.mimeType ?? null,
      storage_key: args.storageKey ?? null,
      caption: args.caption ?? null,
      delivery_status: args.deliveryStatus ?? null,
      // Toda linha gravada por esta função veio da API Oficial Meta — usado
      // pelo painel "Conversas ao vivo" para filtrar por canal.
      channel: "meta_cloud",
    })
    .select("id")
    .maybeSingle();

  if (error) {
    console.warn("[system-meta-inbound] save_message_error", error.code, error.message);
    return null;
  }
  return data ? String((data as { id: string }).id) : null;
}

/**
 * Processa um inbound da Cloud API destinado ao número do sistema.
 * Retorna true se tratou a mensagem (chamador deve parar o fluxo padrão).
 */
export async function handleSystemMetaInbound(inbound: WhatsAppInboundMessage): Promise<boolean> {
  const config = await getSystemAgentMetaConfig();
  // config.active reflects the QR/Meta toggle (meta_provider_active) — the
  // Meta channel must not process/reply while the admin has QR Code chosen,
  // even if credentials are still saved.
  if (!config || !config.active) return false;
  // Só trata se o inbound é para o número Meta do sistema.
  if (inbound.phoneNumberId !== config.phoneNumberId) return false;

  const remoteJid = toRemoteJid(inbound.fromWaId);

  // Upsert do lead (mantém CRM consistente; reusa o mesmo helper do fluxo Evolution).
  const leadUpsert = await upsertLeadFromWhatsAppContact({
    tenantId: SYSTEM_TENANT_ID,
    phone: inbound.fromWaId,
    senderJid: remoteJid,
    instancePhone: inbound.displayPhoneNumber,
    contactName: inbound.contactName,
    direction: "inbound",
    agentId: SYSTEM_AGENT_ID,
    conversationId: remoteJid,
  }).catch(() => null);
  const leadId = leadUpsert?.lead?.id ?? null;

  // Baixar e interpretar mídia (se houver) para obter o texto que a IA vai responder.
  let promptText = inbound.text;
  let mediaUrl: string | null = null;
  let storageKey: string | null = null;

  if (inbound.kind !== "text" && inbound.mediaId) {
    const media = await fetchWhatsAppCloudMedia(inbound.mediaId, config.accessToken);
    if (media) {
      const ext = mimeToExt(media.mimeType);
      const safeId = (inbound.messageId || String(Date.now())).replace(/[^a-zA-Z0-9_-]/g, "");
      const filename = `whatsapp/${SYSTEM_TENANT_ID}/${safeId}.${ext}`;
      storageKey = await uploadMediaToR2(media.buffer, filename, media.mimeType);
      if (storageKey) mediaUrl = `/api/client/media/${filename}`;

      if (inbound.kind === "audio") {
        const transcript = await transcribeAudioFromBuffer(media.buffer, media.mimeType).catch(() => null);
        if (transcript) promptText = transcript;
      } else if (inbound.kind === "image") {
        const description = await describeImageFromBuffer(media.buffer, media.mimeType).catch(() => null);
        promptText = [inbound.caption, description ? `[Imagem] ${description}` : null]
          .filter(Boolean)
          .join("\n")
          .trim();
      }
    }
  }

  // Conteúdo guardado no histórico (o que o monitor vê no chat).
  const inboundContent =
    inbound.kind === "audio"
      ? promptText || "[Áudio]"
      : inbound.kind === "image"
        ? inbound.caption || "[Imagem]"
        : inbound.kind === "text"
          ? inbound.text
          : inbound.caption || `[${inbound.kind}]`;

  await saveSystemMessage({
    remoteJid,
    direction: "inbound",
    kind: inbound.kind,
    content: inboundContent,
    messageId: inbound.messageId || null,
    leadId,
    mediaUrl,
    mimeType: inbound.mimeType,
    storageKey,
    caption: inbound.caption,
  });

  // Nunca responde — só monitora. A mensagem já foi salva acima.
  return true;
}
