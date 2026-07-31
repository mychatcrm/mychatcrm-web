/**
 * POST /api/client/conversas/send
 * Persiste outbound na memória central e envia via Evolution API.
 *
 * Body: { remoteJid: string; text: string; contactName?: string; clientTempId?: string }
 */
import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { conversationInScope, resolveAccessScope } from "@/lib/server/access-scope";
import { remoteJidToEvoNumber } from "@/lib/integrations/evolution-api";
import { persistEvolutionSendReceipt } from "@/lib/server/evolution-customer-delivery";
import { sendEvolutionTextWithConnectionRecovery } from "@/lib/server/evolution-send-recovery";
import { getEvolutionInstanceByTenantId } from "@/lib/server/tenant-evolution-instance-db";
import { upsertConversationState } from "@/lib/server/conversation-memory";
import { logMessageLatency } from "@/lib/conversas/message-latency-log";
import { cancelPendingFollowUpJobs, scheduleRetomadaJob } from "@/lib/server/follow-up-jobs";
import { followUpInteligenteFromMetadata } from "@/lib/server/follow-up-settings";
import {
  canHumanSendMessage,
  deriveConversationMode,
  loadStateOperationRow,
} from "@/lib/server/conversation-operation";

export const dynamic = "force-dynamic";

const MESSAGE_SELECT =
  "id, direction, kind, content, media_url, agent_id, created_at, client_temp_id, delivery_status";

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

export async function POST(request: Request) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  let body: {
    remoteJid?: string;
    text?: string;
    contactName?: string;
    clientTempId?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { remoteJid, text, clientTempId } = body;
  if (!remoteJid?.trim() || !text?.trim()) {
    return NextResponse.json({ error: "remoteJid e text são obrigatórios" }, { status: 400 });
  }

  const trimmedText = text.trim().slice(0, 4000);
  const tempId = clientTempId?.trim() || null;

  const sb = createSupabaseServiceClient();
  if (!(await conversationInScope(sb, session.tenantId, remoteJid, await resolveAccessScope(sb, session)))) {
    return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
  }

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

  const instance = await getEvolutionInstanceByTenantId(session.tenantId);
  if (!instance) {
    return NextResponse.json({ error: "Nenhuma instância WhatsApp configurada para este tenant." }, { status: 422 });
  }

  const number = remoteJidToEvoNumber(remoteJid);
  if (!number) {
    return NextResponse.json({ error: "remoteJid inválido" }, { status: 400 });
  }

  // A direct conversation belongs in Conversas until an operator explicitly
  // chooses "Salvar no CRM". Sending a human reply must never create a lead
  // nor inherit a slot's default agent as an implicit CRM assignment.
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
      kind: "text",
      content: trimmedText,
      agent_id: "human",
      lead_id: leadId,
      client_temp_id: tempId,
      delivery_status: "pending",
      channel: "evolution",
      connection_id: instance.id,
    })
    .select(MESSAGE_SELECT)
    .single();

  if (dbErr || !saved) {
    console.error("[api/client/conversas/send] db insert", dbErr?.code, dbErr?.message);
    return NextResponse.json({ error: "Erro ao salvar mensagem." }, { status: 503 });
  }

  logMessageLatency({
    phase: "saved",
    source: "manual",
    tenantId: session.tenantId,
    remoteJid,
    messageId: String(saved.id),
  });

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

  const send = await sendEvolutionTextWithConnectionRecovery({
    instanceName: instance.instance_name,
    number,
    text: trimmedText,
    resolveRecipient: true,
  });

  if (!send.ok) {
    console.error("[api/client/conversas/send] evolutionSendText", send.status, send.error);
    await sb
      .from("whatsapp_messages")
      .update({
        delivery_status: "failed",
        failed_reason: send.error ?? "evolution_send_failed",
      })
      .eq("tenant_id", session.tenantId)
      .eq("id", saved.id);

    return NextResponse.json(
      { error: "Falha ao enviar mensagem pelo WhatsApp.", message: { ...saved, delivery_status: "failed" } },
      { status: 502 },
    );
  }

  const receipt = await persistEvolutionSendReceipt({
    sb,
    tenantId: session.tenantId,
    messageRowId: saved.id,
    connectionId: instance.id,
    payload: send.data,
  });
  const { data: updated } = await sb
    .from("whatsapp_messages")
    .select(MESSAGE_SELECT)
    .eq("tenant_id", session.tenantId)
    .eq("id", saved.id)
    .maybeSingle();

  return NextResponse.json({ ok: true, message: updated ?? { ...saved, delivery_status: receipt.deliveryStatus } });
}
