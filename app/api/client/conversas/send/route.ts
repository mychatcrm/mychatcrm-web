/**
 * POST /api/client/conversas/send
 * Envia uma mensagem de texto para um número WhatsApp via Evolution API
 * e persiste o outbound na tabela whatsapp_messages.
 *
 * Body: { remoteJid: string; text: string; contactName?: string }
 */
import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { evolutionSendText, remoteJidToEvoNumber } from "@/lib/integrations/evolution-api";
import { getEvolutionInstanceByTenantId } from "@/lib/server/tenant-evolution-instance-db";
import { upsertLeadFromWhatsAppContact } from "@/lib/server/auto-lead-upsert";
import { upsertConversationState } from "@/lib/server/conversation-memory";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  let body: { remoteJid?: string; text?: string; contactName?: string };
  try {
    body = (await request.json()) as { remoteJid?: string; text?: string; contactName?: string };
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { remoteJid, text, contactName } = body;
  if (!remoteJid?.trim() || !text?.trim()) {
    return NextResponse.json({ error: "remoteJid e text são obrigatórios" }, { status: 400 });
  }

  const trimmedText = text.trim().slice(0, 4000);

  // Busca a instância Evolution do tenant
  const instance = await getEvolutionInstanceByTenantId(session.tenantId);
  if (!instance) {
    return NextResponse.json({ error: "Nenhuma instância WhatsApp configurada para este tenant." }, { status: 422 });
  }

  // Converte JID para número
  const number = remoteJidToEvoNumber(remoteJid);
  if (!number) {
    return NextResponse.json({ error: "remoteJid inválido" }, { status: 400 });
  }

  // Envia via Evolution API
  const send = await evolutionSendText({ instanceName: instance.instance_name, number, text: trimmedText });
  if (!send.ok) {
    console.error("[api/client/conversas/send] evolutionSendText", send.status, send.error);
    return NextResponse.json({ error: "Falha ao enviar mensagem pelo WhatsApp." }, { status: 502 });
  }

  // Persiste outbound no Supabase
  const sb = createSupabaseServiceClient();
  const { data: saved, error: dbErr } = await sb
    .from("whatsapp_messages")
    .insert({
      tenant_id: session.tenantId,
      remote_jid: remoteJid,
      direction: "outbound",
      kind: "text",
      content: trimmedText,
      agent_id: "human",
    })
    .select("id, direction, kind, content, created_at")
    .single();

  if (dbErr) {
    console.warn("[api/client/conversas/send] db insert", dbErr.code, dbErr.message);
    // Não falha — mensagem já foi enviada, só não persiste
  }

  const linkedAgentId = instance.default_agent_id ?? null;
  const leadResult = await upsertLeadFromWhatsAppContact({
    tenantId: session.tenantId,
    remoteJid,
    recipientJid: remoteJid,
    instanceJid: instance.wa_jid,
    contactName,
    direction: "outbound",
    agentId: linkedAgentId ?? "human",
    conversationId: remoteJid,
    occurredAt: typeof saved?.created_at === "string" ? saved.created_at : undefined,
  });
  const occurredAt = typeof saved?.created_at === "string" ? saved.created_at : new Date().toISOString();
  await upsertConversationState({
    sb,
    tenantId: session.tenantId,
    remoteJid,
    leadId: leadResult.lead?.id ?? null,
    agentId: linkedAgentId,
    lastMessageAt: occurredAt,
  });
  return NextResponse.json({ ok: true, message: saved ?? null });
}
