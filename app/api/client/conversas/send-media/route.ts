/**
 * POST /api/client/conversas/send-media
 * Recebe multipart/form-data com o ficheiro e os metadados, faz upload
 * para o R2 e envia via Evolution API usando o endpoint correcto por tipo.
 *
 * Form fields:
 *   file      — Blob / File
 *   remoteJid — string  (ex: 5511999999999@s.whatsapp.net)
 *   caption   — string  (opcional, para imagem/vídeo/documento)
 *   contactName — string (opcional)
 */
import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { uploadMediaToR2 } from "@/lib/integrations/r2-storage";
import {
  evolutionSendMedia,
  evolutionSendAudio,
  remoteJidToEvoNumber,
  resolveEvolutionSendNumber,
} from "@/lib/integrations/evolution-api";
import { persistEvolutionSendReceipt } from "@/lib/server/evolution-customer-delivery";
import { getEvolutionInstanceByTenantId } from "@/lib/server/tenant-evolution-instance-db";
import { upsertConversationState } from "@/lib/server/conversation-memory";
import { cancelPendingFollowUpJobs, scheduleRetomadaJob } from "@/lib/server/follow-up-jobs";
import { followUpInteligenteFromMetadata } from "@/lib/server/follow-up-settings";
import {
  canHumanSendMessage,
  deriveConversationMode,
  loadStateOperationRow,
} from "@/lib/server/conversation-operation";

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

function retomadaHumanoMs(value: number, unit: "minutos" | "horas" | "dias"): number {
  if (unit === "minutos") return value * 60_000;
  if (unit === "dias") return value * 86_400_000;
  return value * 3_600_000;
}

async function scheduleRetomadaAfterHumanOutbound(params: {
  sb: ReturnType<typeof createSupabaseServiceClient>;
  tenantId: string;
  remoteJid: string;
  leadId?: string | null;
  agentId?: string | null;
  stateRow: Record<string, unknown> | null;
}): Promise<void> {
  const humanPaused = params.stateRow?.human_paused === true;
  const mode = typeof params.stateRow?.conversation_mode === "string" ? params.stateRow.conversation_mode : null;
  if (!humanPaused && mode !== "waiting_human") return;

  const agentId = params.agentId?.trim();
  if (!agentId) return;

  const { data } = await params.sb
    .from("tenant_agents")
    .select("metadata")
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", agentId)
    .maybeSingle();
  const metadata = data?.metadata && typeof data.metadata === "object"
    ? (data.metadata as Record<string, unknown>)
    : {};
  const settings = followUpInteligenteFromMetadata(metadata);
  if (
    !settings.ativo ||
    !settings.retomadaApenasSeHumanoAbandonou ||
    settings.retomadaHumanoTempoValor == null
  ) {
    return;
  }

  await cancelPendingFollowUpJobs({
    sb: params.sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    reason: "human_outbound_reset_retomada",
  });
  await scheduleRetomadaJob({
    sb: params.sb,
    tenantId: params.tenantId,
    agentId,
    remoteJid: params.remoteJid,
    leadId: params.leadId,
    scheduledAt: new Date(
      Date.now() +
        retomadaHumanoMs(
          settings.retomadaHumanoTempoValor,
          settings.retomadaHumanoTempoUnidade ?? "horas",
        ),
    ),
    maxAttempts: settings.tentativasContato,
  });
}

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
  const clientTempId = ((formData.get("clientTempId") as string | null) ?? "").trim() || null;

  const MESSAGE_SELECT =
    "id, direction, kind, content, media_url, agent_id, created_at, client_temp_id, delivery_status";

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

  const sb = createSupabaseServiceClient();
  const stateRow = await loadStateOperationRow({
    sb,
    tenantId: session.tenantId,
    remoteJid,
  });
  const mode = deriveConversationMode({
    conversationMode: typeof stateRow?.conversation_mode === "string" ? stateRow.conversation_mode : null,
    humanPaused: stateRow?.human_paused === true,
    handoffSuggested: stateRow?.handoff_suggested === true,
    pausedReason: typeof stateRow?.paused_reason === "string" ? stateRow.paused_reason : null,
  });
  if (!canHumanSendMessage(mode)) {
    return NextResponse.json(
      { error: "A automação está ativa nesta conversa. Assuma o atendimento para enviar mensagens." },
      { status: 403 },
    );
  }

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

  const contentLabel =
    kind === "audio" ? "[Áudio]" :
    kind === "image" ? (caption ? `[Imagem] ${caption}` : "[Imagem]") :
    kind === "video" ? (caption ? `[Vídeo] ${caption}` : "[Vídeo]") :
    `[Documento] ${originalName}`;

  // Human messages do not implicitly turn a private contact into a CRM lead.
  // The explicit "Salvar no CRM" action owns that conversion.
  const { data: existingLead } = await sb
    .from("leads")
    .select("id")
    .eq("tenant_id", session.tenantId)
    .eq("phone", number)
    .maybeSingle();
  const leadId = typeof existingLead?.id === "string" ? existingLead.id : null;
  const stateAgentId =
    typeof stateRow?.agent_id === "string" && stateRow.agent_id.trim()
      ? stateRow.agent_id
      : null;

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
      lead_id: leadId,
      client_temp_id: clientTempId,
      delivery_status: "pending",
      channel: "evolution",
      connection_id: instance.id,
    })
    .select(MESSAGE_SELECT)
    .single();

  if (dbErr || !saved) {
    console.error("[send-media] db insert error", dbErr?.code, dbErr?.message);
    return NextResponse.json({ error: "Erro ao salvar mídia." }, { status: 503 });
  }

  const occurredAt =
    typeof saved.created_at === "string" ? saved.created_at : new Date().toISOString();
  await upsertConversationState({
    sb,
    tenantId: session.tenantId,
    remoteJid,
    leadId,
    agentId: stateAgentId,
    lastMessageAt: occurredAt,
  });
  await scheduleRetomadaAfterHumanOutbound({
    sb,
    tenantId: session.tenantId,
    remoteJid,
    leadId,
    agentId: stateAgentId,
    stateRow,
  });

  // ── Send via Evolution API ────────────────────────────────────────────────
  const b64 = buffer.toString("base64");
  const resolvedRecipient = await resolveEvolutionSendNumber({
    instanceName: instance.instance_name,
    number,
  });
  if (resolvedRecipient.status === "not_found") {
    await sb
      .from("whatsapp_messages")
      .update({ delivery_status: "failed", failed_reason: "evolution_recipient_not_found" })
      .eq("tenant_id", session.tenantId)
      .eq("id", saved.id);
    return NextResponse.json(
      { error: "Este número não foi encontrado no WhatsApp.", message: { ...saved, delivery_status: "failed" } },
      { status: 422 },
    );
  }
  const sendNumber = resolvedRecipient.status === "exists" ? resolvedRecipient.sendNumber : number;

  let sendResult: Awaited<ReturnType<typeof evolutionSendMedia>>;

  if (kind === "audio") {
    sendResult = await evolutionSendAudio({
      instanceName: instance.instance_name,
      number: sendNumber,
      audio: b64,
    });
  } else {
    const mediatype =
      kind === "image" ? "image" :
      kind === "video" ? "video" :
      "document";

    sendResult = await evolutionSendMedia({
      instanceName: instance.instance_name,
      number: sendNumber,
      mediatype,
      mimetype: mime,
      media: b64,
      caption: caption || undefined,
      fileName: safeFilename,
    });
  }

  if (!sendResult.ok) {
    console.error("[send-media] Evolution API error", sendResult.status, sendResult.error);
    await sb
      .from("whatsapp_messages")
      .update({
        delivery_status: "failed",
        failed_reason: sendResult.error ?? "evolution_send_failed",
      })
      .eq("tenant_id", session.tenantId)
      .eq("id", saved.id);
    return NextResponse.json(
      { error: "Falha ao enviar mídia pelo WhatsApp: " + sendResult.error, message: { ...saved, delivery_status: "failed" } },
      { status: 502 },
    );
  }

  const receipt = await persistEvolutionSendReceipt({
    sb,
    tenantId: session.tenantId,
    messageRowId: saved.id,
    connectionId: instance.id,
    payload: sendResult.data,
  });
  const { data: updated } = await sb
    .from("whatsapp_messages")
    .select(MESSAGE_SELECT)
    .eq("tenant_id", session.tenantId)
    .eq("id", saved.id)
    .maybeSingle();

  return NextResponse.json({ ok: true, message: updated ?? { ...saved, delivery_status: receipt.deliveryStatus } });
}
