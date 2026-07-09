/**
 * Direcionamento manual de um lead em "Erro" de meta_lead_events — só usado
 * quando o tenant explicitamente escolhe um agente de IA ou um atendente
 * humano na aba "Leads recebidos". Deliberadamente separado de
 * lib/server/meta-lead-ingest.ts (o pipeline automático, que fica intocado):
 * reaproveita as mesmas peças de baixo nível (guarda de contato, jornada,
 * geração de resposta, envio Evolution) na mesma ordem, mas decidindo o
 * agente/atendente manualmente em vez de via regra.
 */
import "server-only";
import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import { generateAgentResponse } from "@/lib/ai/generate-agent-response";
import { evolutionSendText, remoteJidToEvoNumber } from "@/lib/integrations/evolution-api";
import { upsertConversationState } from "@/lib/server/conversation-memory";
import { resolveAgentCrmFieldsForLeadInsert } from "@/lib/server/auto-lead-upsert";
import { buildNewLeadCrmFields, promoteLeadToContatoOnAgentEngagement } from "@/lib/server/crm-lead-lifecycle";
import { canAgentAutoContactLead } from "@/lib/server/agent-auto-contact-guard";
import { getEvolutionInstanceByTenantId } from "@/lib/server/tenant-evolution-instance-db";
import { MetaLeadEventRecorder, type MetaLeadEventRow } from "@/lib/server/meta-lead-events-db";
import {
  buildFallbackInitialMessage,
  buildMetaInitialAgentPrompt,
  sanitizeInitialReply,
} from "@/lib/server/meta-lead-graph";
import { buildWhatsappRemoteJid } from "@/lib/server/meta-lead-processing";
import {
  activateLeadJourney,
  authorizeActiveJourney,
  isJourneyIsolationEnabled,
  touchLeadJourney,
} from "@/lib/server/lead-journeys";
import { readTeamMembersFromDb } from "@/lib/server/team-employees-db";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type ManualAssignmentResult =
  | { ok: true; event: MetaLeadEventRow }
  | { ok: false; error: string; status: number };

async function fetchEvent(
  sb: SupabaseServiceClient,
  tenantId: string,
  eventId: string,
): Promise<MetaLeadEventRow | null> {
  const { data } = await sb
    .from("meta_lead_events")
    .select("*")
    .eq("id", eventId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return (data as MetaLeadEventRow | null) ?? null;
}

async function fetchUpdatedEvent(
  sb: SupabaseServiceClient,
  tenantId: string,
  eventId: string,
): Promise<ManualAssignmentResult> {
  const event = await fetchEvent(sb, tenantId, eventId);
  if (!event) return { ok: false, error: "Evento não encontrado após atualização.", status: 500 };
  return { ok: true, event };
}

async function recordManualSuccessOnAgent(
  sb: SupabaseServiceClient,
  tenantId: string,
  eventId: string,
  agentId: string,
): Promise<ManualAssignmentResult> {
  const recorder = MetaLeadEventRecorder.attachExisting(sb, eventId);
  await recorder.step("manual_assigned_to_agent", { agent_id: agentId });
  await recorder.patch({
    whatsapp_status: "sent",
    crm_sync_status: "synced",
    agent_id: agentId,
    agent_resolution_source: "manual",
    error_message: null,
  });
  return fetchUpdatedEvent(sb, tenantId, eventId);
}

async function recordManualFailureOnAgent(
  sb: SupabaseServiceClient,
  eventId: string,
  agentId: string,
  reason: string,
): Promise<void> {
  const recorder = MetaLeadEventRecorder.attachExisting(sb, eventId);
  await recorder.step("manual_assignment_failed", { agent_id: agentId, reason });
  await recorder.patch({ whatsapp_status: "failed", error_message: reason });
}

/** Garante que o lead exista no CRM com a atribuição informada (upsert por tenant+phone). */
async function upsertLeadWithAttribution(
  sb: SupabaseServiceClient,
  tenantId: string,
  event: MetaLeadEventRow,
  phone: string,
  fullName: string,
  attribution: Record<string, unknown>,
  crmFunnelId?: string,
): Promise<{ leadId: string | null; error?: string }> {
  const { data: existingLead } = await sb
    .from("leads")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("phone", phone)
    .maybeSingle();

  if (existingLead?.id) {
    const { error } = await sb
      .from("leads")
      .update({ ...attribution, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", existingLead.id);
    if (error) return { leadId: null, error: error.message };
    return { leadId: existingLead.id };
  }

  const newLeadCrm = buildNewLeadCrmFields(crmFunnelId);
  const { data: inserted, error } = await sb
    .from("leads")
    .upsert(
      {
        tenant_id: tenantId,
        phone,
        name: fullName,
        email: event.email ?? undefined,
        source: "lead_ads",
        last_seen: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...newLeadCrm,
        ...attribution,
        profile_metadata: event.profile_metadata ?? {},
      },
      { onConflict: "tenant_id,phone", ignoreDuplicates: false },
    )
    .select("id")
    .maybeSingle();
  if (error) return { leadId: null, error: error.message };
  return { leadId: inserted?.id ?? null };
}

export async function assignMetaLeadEventToAgent(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  eventId: string;
  agentId: string;
}): Promise<ManualAssignmentResult> {
  const { sb, tenantId, eventId } = params;
  const agentId = params.agentId.trim();
  if (!agentId) return { ok: false, error: "Selecione um agente.", status: 400 };

  const event = await fetchEvent(sb, tenantId, eventId);
  if (!event) return { ok: false, error: "Lead não encontrado.", status: 404 };
  const phone = event.phone?.trim() ?? "";
  if (!phone) return { ok: false, error: "Este lead não tem telefone — não é possível direcionar.", status: 400 };

  const { data: agentRow } = await sb
    .from("tenant_agents")
    .select("agent_id, active")
    .eq("tenant_id", tenantId)
    .eq("agent_id", agentId)
    .maybeSingle();
  if (!agentRow || agentRow.active !== true) {
    return { ok: false, error: "Agente inválido ou inativo para este tenant.", status: 400 };
  }

  const fullName = event.name?.trim() || phone;

  const crmFunnel = await resolveAgentCrmFieldsForLeadInsert(sb, { tenantId, agentId });
  const { leadId, error: upsertError } = await upsertLeadWithAttribution(
    sb,
    tenantId,
    event,
    phone,
    fullName,
    { agent_id: agentId, campaign_agent_id: agentId, campaign_active: true, agent_assignment_source: "manual" },
    crmFunnel.crm_funnel_id,
  );
  if (upsertError) return { ok: false, error: upsertError, status: 500 };
  if (!leadId) return { ok: false, error: "Não foi possível localizar/criar o lead no CRM.", status: 500 };

  const remoteJid = buildWhatsappRemoteJid(phone);
  const evoNumber = remoteJidToEvoNumber(remoteJid);
  if (!evoNumber) return { ok: false, error: "Telefone inválido para WhatsApp.", status: 400 };

  const guard = await canAgentAutoContactLead({
    sb,
    tenantId,
    agentId,
    leadId,
    phone,
    remoteJid,
    journeyId: null,
    source: "lead_ads",
    formId: event.form_id,
    pageId: event.page_id,
    leadgenId: event.leadgen_id,
    triggerSource: "manual_lead_event_assignment",
  });
  if (!guard.ok) {
    return { ok: false, error: `Este agente não pode atender este lead agora (${guard.reason}).`, status: 409 };
  }

  const journeyIsolationEnabled = isJourneyIsolationEnabled();
  const journey = await activateLeadJourney({
    sb,
    tenantId,
    remoteJid,
    phone,
    leadId,
    agentId,
    ruleId: null,
    connectionId: null,
    source: "manual",
    sourceRef: event.leadgen_id,
    pageId: event.page_id,
    formId: event.form_id,
    metadata: { manual_assignment: true },
  });
  if (journeyIsolationEnabled && (!journey || journey.status !== "active")) {
    return { ok: false, error: "Outro atendimento já está ativo para este contato.", status: 409 };
  }
  const journeyId = journey?.id ?? null;

  const instance = await getEvolutionInstanceByTenantId(tenantId);
  if (!instance?.instance_name) {
    return {
      ok: false,
      error: "Nenhuma instância WhatsApp (QR/Evolution) configurada para este tenant — a atribuição manual por agente de IA ainda só envia por Evolution.",
      status: 409,
    };
  }

  const initialMessageExternalId = `meta:${event.leadgen_id}:initial`;
  const { data: existingInitialMessage } = await sb
    .from("whatsapp_messages")
    .select("id, delivery_status, agent_id")
    .eq("tenant_id", tenantId)
    .eq("message_id", initialMessageExternalId)
    .maybeSingle();

  if (existingInitialMessage?.delivery_status === "pending") {
    return { ok: false, error: "Envio já em andamento para este lead — aguarde e tente novamente.", status: 409 };
  }

  // Lead já foi contactado antes (balde "OK") e o cliente está redirecionando pra
  // um agente diferente do que enviou a primeira mensagem — trata como um
  // handoff real e manda uma mensagem nova (chave própria, não reaproveita
  // "initial") em vez de só trocar a atribuição sem o cliente perceber nada.
  const isHandoffToDifferentAgent =
    existingInitialMessage?.delivery_status === "sent" && existingInitialMessage.agent_id !== agentId;

  if (existingInitialMessage?.delivery_status === "sent" && !isHandoffToDifferentAgent) {
    return recordManualSuccessOnAgent(sb, tenantId, eventId, agentId);
  }

  const messageExternalId = isHandoffToDifferentAgent
    ? `meta:${event.leadgen_id}:manual:${Date.now()}`
    : initialMessageExternalId;
  const existingMessage = isHandoffToDifferentAgent ? null : existingInitialMessage;

  const aiPrompt = buildMetaInitialAgentPrompt({
    leadName: fullName,
    phone,
    email: event.email,
    formName: event.form_name,
    pageName: event.page_name,
    campaignName: event.campaign_name,
    adName: event.ad_name,
    adsetName: event.adset_name,
    formFields: event.form_fields,
    profileMetadata: (event.profile_metadata as Record<string, unknown>) ?? {},
  });

  const aiResult = await generateAgentResponse({
    tenantId,
    agentId,
    conversationId: remoteJid,
    journeyId,
    customerId: remoteJid,
    feature: "agent_chat",
    messages: [{ role: "user", content: aiPrompt }],
  });
  const replyText = sanitizeInitialReply(aiResult.ok ? aiResult.text : "") || buildFallbackInitialMessage(fullName);

  let messageId: string;
  if (existingMessage?.id) {
    const { error: updateMsgErr } = await sb
      .from("whatsapp_messages")
      .update({
        content: replyText.slice(0, 4000),
        agent_id: agentId,
        lead_id: leadId,
        journey_id: journeyId,
        delivery_status: "pending",
      })
      .eq("id", existingMessage.id);
    if (updateMsgErr) return { ok: false, error: updateMsgErr.message, status: 500 };
    messageId = existingMessage.id;
  } else {
    const { data: savedMessage, error: msgErr } = await sb
      .from("whatsapp_messages")
      .insert({
        tenant_id: tenantId,
        remote_jid: remoteJid,
        direction: "outbound",
        kind: "text",
        content: replyText.slice(0, 4000),
        message_id: messageExternalId,
        agent_id: agentId,
        lead_id: leadId,
        journey_id: journeyId,
        delivery_status: "pending",
      })
      .select("id")
      .maybeSingle();
    if (msgErr || !savedMessage?.id) {
      return { ok: false, error: msgErr?.message ?? "Falha ao salvar mensagem.", status: 500 };
    }
    messageId = savedMessage.id;
  }

  if (journeyIsolationEnabled) {
    const current = await authorizeActiveJourney({ sb, tenantId, remoteJid, preferredAgentId: agentId });
    if (!current.ok || current.journey?.id !== journeyId) {
      await sb
        .from("whatsapp_messages")
        .update({ delivery_status: "failed", failed_reason: "journey_superseded_before_send" })
        .eq("id", messageId);
      await recordManualFailureOnAgent(sb, eventId, agentId, "journey_superseded_before_send");
      return { ok: false, error: "Outro atendimento assumiu este contato antes do envio.", status: 409 };
    }
  }

  const send = await evolutionSendText({ instanceName: instance.instance_name, number: evoNumber, text: replyText });
  if (!send.ok) {
    await sb
      .from("whatsapp_messages")
      .update({ delivery_status: "failed", failed_reason: send.error ?? "evolution_send_failed" })
      .eq("id", messageId);
    await recordManualFailureOnAgent(sb, eventId, agentId, send.error ?? "evolution_send_failed");
    return { ok: false, error: `Falha ao enviar WhatsApp: ${send.error ?? "erro desconhecido"}.`, status: 502 };
  }

  const sentAt = new Date().toISOString();
  await Promise.all([
    sb.from("whatsapp_messages").update({ delivery_status: "sent", sent_at: sentAt }).eq("id", messageId),
    sb.from("leads").update({ last_message_at: sentAt, updated_at: sentAt }).eq("tenant_id", tenantId).eq("id", leadId),
    upsertConversationState({
      sb,
      tenantId,
      remoteJid,
      leadId,
      agentId,
      activeJourneyId: journeyId,
      channel: "whatsapp",
      status: "active",
      humanPaused: false,
      lastMessageAt: sentAt,
      isHidden: false,
      archivedAt: null,
      hiddenAt: null,
      hiddenBy: null,
    }),
    promoteLeadToContatoOnAgentEngagement({ sb, tenantId, leadId }),
    journeyId ? touchLeadJourney({ sb, tenantId, journeyId, leadId, occurredAt: sentAt }) : Promise.resolve(),
  ]);

  return recordManualSuccessOnAgent(sb, tenantId, eventId, agentId);
}

export async function assignMetaLeadEventToEmployee(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  eventId: string;
  employeeId: string;
}): Promise<ManualAssignmentResult> {
  const { sb, tenantId, eventId } = params;
  const employeeId = params.employeeId.trim();
  if (!employeeId) return { ok: false, error: "Selecione um atendente.", status: 400 };

  const event = await fetchEvent(sb, tenantId, eventId);
  if (!event) return { ok: false, error: "Lead não encontrado.", status: 404 };
  const phone = event.phone?.trim() ?? "";
  if (!phone) return { ok: false, error: "Este lead não tem telefone — não é possível direcionar.", status: 400 };

  // Mesma validação (ativo + não suspenso) já usada pela ação "assign_attendant" do CRM
  // (lib/server/crm-leads-bulk-actions.ts) — sem restrição de cargo: qualquer funcionário
  // cadastrado (vendedor, gerente ou diretor) pode ser escolhido.
  const employees = await readTeamMembersFromDb(tenantId);
  const employee = employees.find((e) => e.id === employeeId && e.ativo && !e.accountSuspended);
  if (!employee) return { ok: false, error: "Atendente inválido ou inativo para este tenant.", status: 400 };

  const fullName = event.name?.trim() || phone;

  const { leadId, error: upsertError } = await upsertLeadWithAttribution(sb, tenantId, event, phone, fullName, {
    owner_employee_id: employeeId,
    agent_assignment_source: "manual",
  });
  if (upsertError) return { ok: false, error: upsertError, status: 500 };
  if (!leadId) return { ok: false, error: "Não foi possível localizar/criar o lead no CRM.", status: 500 };

  const recorder = MetaLeadEventRecorder.attachExisting(sb, eventId);
  await recorder.step("manual_assigned_to_human", { employee_id: employeeId });
  await recorder.patch({ crm_sync_status: "synced", lead_id: leadId, error_message: null });

  return fetchUpdatedEvent(sb, tenantId, eventId);
}
