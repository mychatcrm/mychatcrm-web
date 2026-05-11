/**
 * POST /api/client/conversas/send-media
 * Recebe multipart/form-data com o ficheiro e os metadados, faz upload
 * para o R2 e envia via Evolution API usando o endpoint correcto por tipo.
 *
 * Form fields:
 *   file      — Blob / File
 *   remoteJid — string  (ex: 5511999999999@s.whatsapp.net)
 *   caption   — string  (opcional, para imagem/vídeo/documento)
 */
import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { uploadMediaToR2 } from "@/lib/integrations/r2-storage";
import {
  evolutionSendMedia,
  evolutionSendAudio,
  remoteJidToEvoNumber,
} from "@/lib/integrations/evolution-api";
import { getEvolutionInstanceByTenantId } from "@/lib/server/tenant-evolution-instance-db";

export const dynamic = "force-dynamic";

// ── MIME → kind / mediatype mapping ──────────────────────────────────────────

type MediaKind = "image" | "audio" | "document" | "video";

function mimeToKind(mime: string): MediaKind {
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("audio/") || m === "audio/ogg; codecs=opus") return "audio";
  if (m.startsWith("video/")) return "video";
  return "document";
}

const ALLOWED_MIME = new Set([
  // images
  "image/jpeg", "image/png", "image/gif", "image/webp",
  // audio
  "audio/mpeg", "audio/ogg", "audio/mp4", "audio/x-m4a",
  "audio/opus", "audio/webm",
  // video
  "video/mp4",
  // documents
  "application/pdf",
]);

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  // ── Parse multipart ───────────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Multipart inválido" }, { status: 400 });
  }

  const fileBlob = formData.get("file");
  const remoteJid = (formData.get("remoteJid") as string | null)?.trim();
  const caption = ((formData.get("caption") as string | null) ?? "").trim();

  if (!(fileBlob instanceof Blob)) {
    return NextResponse.json({ error: "Campo 'file' ausente" }, { status: 400 });
  }
  if (!remoteJid) {
    return NextResponse.json({ error: "Campo 'remoteJid' ausente" }, { status: 400 });
  }

  const mime = fileBlob.type || "application/octet-stream";
  const originalName =
    fileBlob instanceof File ? fileBlob.name : `file.${mime.split("/")[1] ?? "bin"}`;

  // ── Validate MIME ─────────────────────────────────────────────────────────
  const baseMime = mime.split(";")[0]!.trim().toLowerCase();
  if (!ALLOWED_MIME.has(baseMime)) {
    return NextResponse.json({ error: `Tipo de ficheiro não permitido: ${mime}` }, { status: 415 });
  }

  const kind = mimeToKind(baseMime);

  // ── Read buffer ───────────────────────────────────────────────────────────
  const arrayBuf = await fileBlob.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);

  if (buffer.byteLength > 64 * 1024 * 1024) {
    return NextResponse.json({ error: "Ficheiro demasiado grande (máx 64 MB)" }, { status: 413 });
  }

  // ── Upload to R2 ──────────────────────────────────────────────────────────
  const safeFilename = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const r2Key = `whatsapp/${session.tenantId}/outbound/${Date.now()}_${safeFilename}`;
  const r2Path = await uploadMediaToR2(buffer, r2Key, mime);
  // r2Path may be null if R2 is not configured — we still try to send
  const mediaUrl = r2Path ? `/api/client/media/${r2Key}` : null;

  // ── Get Evolution instance ────────────────────────────────────────────────
  const instance = await getEvolutionInstanceByTenantId(session.tenantId);
  if (!instance) {
    return NextResponse.json(
      { error: "Nenhuma instância WhatsApp configurada para este tenant." },
      { status: 422 },
    );
  }

  const number = remoteJidToEvoNumber(remoteJid);
  if (!number) {
    return NextResponse.json({ error: "remoteJid inválido" }, { status: 400 });
  }

  // ── Send via Evolution API ────────────────────────────────────────────────
  const b64 = buffer.toString("base64");

  let sendResult: Awaited<ReturnType<typeof evolutionSendMedia>>;

  if (kind === "audio") {
    sendResult = await evolutionSendAudio({
      instanceName: instance.instance_name,
      number,
      audio: b64,
    });
  } else {
    const mediatype =
      kind === "image" ? "image" :
      kind === "video" ? "video" :
      "document";

    sendResult = await evolutionSendMedia({
      instanceName: instance.instance_name,
      number,
      mediatype,
      mimetype: mime,
      media: b64,
      caption: caption || undefined,
      fileName: safeFilename,
    });
  }

  if (!sendResult.ok) {
    console.error("[send-media] Evolution API error", sendResult.status, sendResult.error);
    return NextResponse.json(
      { error: "Falha ao enviar mídia pelo WhatsApp: " + sendResult.error },
      { status: 502 },
    );
  }

  // ── Persist to whatsapp_messages ──────────────────────────────────────────
  const contentLabel =
    kind === "audio" ? "[Áudio]" :
    kind === "image" ? (caption ? `[Imagem] ${caption}` : "[Imagem]") :
    kind === "video" ? (caption ? `[Vídeo] ${caption}` : "[Vídeo]") :
    `[Documento] ${originalName}`;

  const sb = createSupabaseServiceClient();
  const { data: saved, error: dbErr } = await sb
    .from("whatsapp_messages")
    .insert({
      tenant_id: session.tenantId,
      remote_jid: remoteJid,
      direction: "outbound",
      kind,
      content: contentLabel,
      media_url: mediaUrl,
      agent_id: "human",
    })
    .select("id, direction, kind, content, media_url, agent_id, created_at")
    .single();

  if (dbErr) {
    console.warn("[send-media] db insert error", dbErr.code, dbErr.message);
  }

  return NextResponse.json({ ok: true, message: saved ?? null });
}
