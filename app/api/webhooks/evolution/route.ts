import { NextResponse } from "next/server";
import { generateAgentResponse } from "@/lib/ai/generate-agent-response";
import {
  extractConnectionState,
  extractInboundMessagesFromEvolutionPayload,
  extractInstanceName,
  normalizeEvolutionEventName,
  type EvolutionInboundMessage,
} from "@/lib/integrations/evolution-webhook-parse";
import { evolutionSendText, remoteJidToEvoNumber } from "@/lib/integrations/evolution-api";
import { resolveEvolutionAgentId } from "@/lib/server/evolution-agent-resolve";
import { getEvolutionInstanceByName, updateEvolutionInstanceStateByName } from "@/lib/server/tenant-evolution-instance-db";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { uploadMediaToR2 } from "@/lib/integrations/r2-storage";

export const dynamic = "force-dynamic";

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

function kindFromMsg(msg: EvolutionInboundMessage): "text" | "audio" | "image" | "document" {
  if (msg.type === "audio") return "audio";
  if (msg.type === "image") return "image";
  return "text";
}

function contentFromMsg(msg: EvolutionInboundMessage): string {
  if (msg.type === "text") return msg.text;
  if (msg.type === "audio") return "[Áudio]";
  if (msg.type === "image") return msg.caption ? `[Imagem] ${msg.caption}` : "[Imagem]";
  return "";
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
): Promise<string | null> {
  if (msg.type !== "audio" && msg.type !== "image") return null;

  const { url, mimetype, rawNode } = msg;
  const ext = mimeToExt(mimetype);
  const safeId = (msg.messageId || String(Date.now())).replace(/[^a-zA-Z0-9_-]/g, "");
  const filename = `whatsapp/${tenantId}/${safeId}.${ext}`;

  let buffer: Buffer | null = null;

  // 1. Fetch directo na URL CDN da Meta
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
      buffer = Buffer.from(await res.arrayBuffer());
      console.log("[webhooks/evolution] media CDN ok", buffer.byteLength, "bytes");
    } else {
      console.warn("[webhooks/evolution] media CDN non-ok", res.status);
    }
  } catch (e) {
    console.warn("[webhooks/evolution] media CDN error", e instanceof Error ? e.message : e);
  }

  // 2. Fallback: Evolution API /chat/getBase64FromMediaMessage
  if (!buffer) {
    const evoBase = process.env.EVOLUTION_API_BASE_URL?.replace(/\/+$/, "") ?? "";
    const evoKey =
      process.env.EVOLUTION_API_KEY?.trim() ||
      process.env.AUTHENTICATION_API_KEY?.trim() ||
      "";
    if (evoBase && evoKey) {
      const messageField = msg.type === "audio" ? "audioMessage" : "imageMessage";
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
          console.warn("[webhooks/evolution] media Evolution non-ok", res.status);
        }
      } catch (e) {
        console.warn("[webhooks/evolution] media Evolution error", e instanceof Error ? e.message : e);
      }
    }
  }

  if (!buffer) {
    console.warn("[webhooks/evolution] media download falhou para", msg.messageId);
    return null;
  }

  const key = await uploadMediaToR2(buffer, filename, mimetype);
  if (!key) return null;

  return `/api/client/media/${filename}`;
}

async function saveMessage(opts: {
  tenantId: string;
  remoteJid: string;
  direction: "inbound" | "outbound";
  kind: "text" | "audio" | "image" | "document";
  content: string;
  messageId?: string | null;
  agentId?: string | null;
  mediaUrl?: string | null;
}): Promise<void> {
  try {
    const sb = createSupabaseServiceClient();
    const { error } = await sb.from("whatsapp_messages").insert({
      tenant_id: opts.tenantId,
      remote_jid: opts.remoteJid,
      direction: opts.direction,
      kind: opts.kind,
      content: opts.content,
      message_id: opts.messageId ?? null,
      agent_id: opts.agentId ?? null,
      media_url: opts.mediaUrl ?? null,
    });
    if (error) console.warn("[webhooks/evolution] saveMessage error", error.code, error.message);
  } catch (e) {
    console.warn("[webhooks/evolution] saveMessage exception", e);
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
      if (state) {
        try {
          await updateEvolutionInstanceStateByName({
            instanceName,
            connectionState: state,
          });
        } catch (e) {
          console.warn("[webhooks/evolution] connection update db", e);
        }
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

    const inbound = extractInboundMessagesFromEvolutionPayload(payload);

    for (const msg of inbound) {
      const agentId = await resolveEvolutionAgentId(row.tenant_id, row.default_agent_id);

      // Para áudio/imagem: baixa mídia e faz upload para R2 para exibição no chat
      let inboundMediaUrl: string | null = null;
      if (msg.type === "audio" || msg.type === "image") {
        inboundMediaUrl = await downloadAndStoreMedia(msg, row.tenant_id, instanceName);
      }

      // Salva mensagem inbound no Supabase (fire-and-forget)
      saveMessage({
        tenantId: row.tenant_id,
        remoteJid: msg.remoteJid,
        direction: "inbound",
        kind: kindFromMsg(msg),
        content: contentFromMsg(msg),
        messageId: msg.messageId,
        mediaUrl: inboundMediaUrl,
      });

      const result = await generateAgentResponse({
        tenantId: row.tenant_id,
        agentId,
        conversationId: msg.remoteJid,
        customerId: msg.remoteJid,
        feature: "agent_chat",
        messages: msg.type === "text" ? [{ role: "user", content: msg.text }] : [],
        mediaContent: msg.type !== "text" ? msg : undefined,
        instanceName: msg.type !== "text" ? instanceName : undefined,
      });

      let replyText: string;
      if (result.ok) {
        replyText = result.text;
      } else if (result.code === "MEDIA_DOWNLOAD_FAILED") {
        const mediaLabel = msg.type === "audio" ? "áudio" : "imagem";
        replyText = `Recebi seu ${mediaLabel} mas não consegui processar. Pode enviar em texto?`;
      } else {
        replyText = "Não consegui gerar uma resposta agora. Por favor tente de novo em instantes.";
      }

      const number = remoteJidToEvoNumber(msg.remoteJid);
      if (!number) continue;

      const send = await evolutionSendText({
        instanceName,
        number,
        text: replyText.slice(0, 4000),
      });

      if (!send.ok) {
        console.error("[webhooks/evolution] sendText", send.status, send.error);
      } else {
        // Salva resposta da IA no Supabase (fire-and-forget)
        saveMessage({
          tenantId: row.tenant_id,
          remoteJid: msg.remoteJid,
          direction: "outbound",
          kind: "text",
          content: replyText.slice(0, 4000),
          agentId,
        });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
