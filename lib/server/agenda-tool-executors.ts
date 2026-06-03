import "server-only";

import { localWallClockToUtc, addDaysInTimezone, parseRelativeDaysOffset } from "@/lib/server/agenda-datetime-parse";
import { parseTimezone } from "@/lib/agents/agent-datetime";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isWithinBusinessHours, nextBusinessHourStart } from "@/lib/server/follow-up-engine";
import {
  clientConfirmedAgendaMutation,
  executeAgendaDirective,
  findNextActiveAgendaEvent,
  type AgendaDirective,
} from "@/lib/server/agent-cta-scheduler";
import {
  applyAgendaPostSuccessEffects,
  buildAgendaPostSuccessParams,
} from "@/lib/server/agenda-post-success";
import {
  getAgendaEventById,
  listAgendaEvents,
} from "@/lib/server/google-calendar-db";
import type { AgentFollowUpInteligente } from "@/lib/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

function extractPhone(remoteJid: string): string | null {
  const digits = remoteJid.split("@")[0]?.replace(/\D/g, "") ?? "";
  return digits.length >= 8 ? digits : null;
}

function isValidDate(value: string): boolean {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return false;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isValidTime(value: string): boolean {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  return Boolean(match && Number(match[1]) <= 23 && Number(match[2]) <= 59);
}

function parseDirectiveDatetime(
  date: string,
  time: string,
  timezone: string,
): Date | null {
  const [day, month, year] = date.split("/").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (!day || !month || !year || hour == null || minute == null) return null;
  const tz = parseTimezone(timezone);
  return localWallClockToUtc({ year, month, day, hour, minute }, tz);
}

/**
 * Verifica se [newStart, newEnd) se sobrepõe a qualquer evento não cancelado do tenant.
 * Grão: tenant-level (todo o tenant, independente de attendee_phone).
 */
async function hasOverlappingEvent(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  newStart: Date;
  newEnd: Date;
  excludeEventId?: string | null;
}): Promise<boolean> {
  let q = params.sb
    .from("agenda_events")
    .select("id")
    .eq("tenant_id", params.tenantId)
    .neq("status", "cancelled")
    .lt("start_at", params.newEnd.toISOString())
    .gt("end_at", params.newStart.toISOString());

  if (params.excludeEventId) {
    q = q.neq("id", params.excludeEventId);
  }

  const { data, error } = await q.limit(1);
  if (error) {
    console.warn("[agenda-tool-executors] overlap_check_failed", { error: error.message });
    return false; // Falhar aberto — melhor criar duplicata que bloquear tudo
  }
  return (data ?? []).length > 0;
}

/**
 * Desbloqueio imediato do follow-up após cancelamento de agenda.
 * @deprecated Prefer applyAgendaPostSuccessEffects from agenda-post-success.
 */
export async function unblockFollowUpForContact(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
}): Promise<void> {
  const { unblockFollowUpForContact: unblock } = await import("@/lib/server/agenda-post-success");
  await unblock(params);
}

async function runPostSuccessForMutation(
  ctx: AgendaToolContext,
  action: "scheduled" | "rescheduled" | "cancelled",
  eventId?: string,
  previousEventId?: string | null,
): Promise<boolean> {
  if (!ctx.agentMetadata) return false;
  const effects = await applyAgendaPostSuccessEffects(
    buildAgendaPostSuccessParams({
      sb: ctx.sb,
      tenantId: ctx.tenantId,
      remoteJid: ctx.remoteJid,
      leadId: ctx.leadId,
      agentId: ctx.agentId,
      timezone: ctx.timezone,
      metadata: ctx.agentMetadata,
      action,
      eventId,
      lastMessage: ctx.lastMessage ?? null,
      handoffAlreadyTriggered: false,
      previousEventId,
    }),
  );
  return effects.scheduleHandoffTriggered;
}

// ── Contexto da conversa (injetado pelo servidor, nunca pelo modelo) ──────────

export type AgendaToolContext = {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  leadId: string | null;
  agentId: string;
  contactName: string | null;
  timezone: string;
  /** Configurações do follow-up do agente — usadas para validar horário comercial. */
  followUpInteligente: AgentFollowUpInteligente | null;
  /** Metadata do agente para handoff/lembretes pós-agenda (injetado pelo servidor). */
  agentMetadata?: Record<string, unknown>;
  lastMessage?: string | null;
  handoffAlreadyTriggered?: boolean;
};

// ── Tipo de retorno das tools ─────────────────────────────────────────────────

export type AgendaToolResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; reason: string; sugestao?: string };

const CONFIRMACAO_SUGESTAO_PADRAO =
  "Pergunte ao cliente com data/hora/local e aguarde 'sim', 'ok' ou 'confirmo' antes de executar.";

function requireAgendaClientConfirmation(
  confirmacaoDoCliente: string,
  ctx: AgendaToolContext,
): AgendaToolResult | null {
  if (confirmacaoDoCliente !== "true") {
    return { ok: false, reason: "confirmacao_obrigatoria", sugestao: CONFIRMACAO_SUGESTAO_PADRAO };
  }
  if (!clientConfirmedAgendaMutation(ctx.lastMessage)) {
    return {
      ok: false,
      reason: "confirmacao_obrigatoria",
      sugestao:
        "O cliente ainda não confirmou explicitamente. Use uma pergunta do tipo «Posso confirmar…?» e só execute após 'sim'.",
    };
  }
  return null;
}

// ── 1. consultar_agendamentos ─────────────────────────────────────────────────

export async function executarConsultarAgendamentos(
  ctx: AgendaToolContext,
): Promise<AgendaToolResult> {
  try {
    const sb = ctx.sb ?? createSupabaseServiceClient();
    const attendeePhone = extractPhone(ctx.remoteJid);
    if (!attendeePhone) {
      return { ok: false, reason: "remote_jid_invalido" };
    }

    const nowIso = new Date().toISOString();
    const { data, error } = await sb
      .from("agenda_events")
      .select("id, title, start_at, end_at, status, location, attendee_name")
      .eq("tenant_id", ctx.tenantId)
      .eq("attendee_phone", attendeePhone)
      .neq("status", "cancelled")
      .gte("start_at", nowIso)
      .order("start_at", { ascending: true })
      .limit(25);

    if (error) {
      return { ok: false, reason: "erro_ao_consultar_agenda" };
    }

    const events = (data ?? []) as Array<{
      id: string;
      title: string;
      start_at: string;
      end_at: string;
      status: string;
      location: string | null;
      attendee_name: string | null;
    }>;

    return {
      ok: true,
      data: {
        total: events.length,
        agendamentos: events.map((e) => ({
          event_id: e.id,
          titulo: e.title,
          inicio: e.start_at,
          fim: e.end_at,
          status: e.status,
          local: e.location ?? null,
          nome: e.attendee_name ?? null,
        })),
      },
    };
  } catch (err) {
    console.warn("[agenda-tool-executors] consultar_agendamentos_error", {
      tenant_id: ctx.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: "erro_interno" };
  }
}

// ── 2. verificar_disponibilidade ─────────────────────────────────────────────

export async function executarVerificarDisponibilidade(
  ctx: AgendaToolContext,
  params: { data: string; hora: string; duracao_min?: string },
): Promise<AgendaToolResult> {
  if (!isValidDate(params.data) || !isValidTime(params.hora)) {
    return { ok: false, reason: "data_ou_hora_invalida", sugestao: "Use DD/MM/AAAA para data e HH:MM para hora." };
  }

  const duracaoMin = Math.max(15, Math.min(480, Number(params.duracao_min ?? "60") || 60));
  const startAt = parseDirectiveDatetime(params.data, params.hora, ctx.timezone);
  if (!startAt || Number.isNaN(startAt.getTime())) {
    return { ok: false, reason: "erro_ao_converter_data_hora" };
  }
  if (startAt.getTime() <= Date.now()) {
    return { ok: false, reason: "horario_no_passado", sugestao: "Informe uma data e hora futuras." };
  }
  const endAt = new Date(startAt.getTime() + duracaoMin * 60_000);

  // Validar horário comercial
  const fu = ctx.followUpInteligente;
  if (fu?.usarHorarioComercial) {
    const dentroDoHorario = isWithinBusinessHours(startAt, fu);
    if (!dentroDoHorario) {
      const proxSlot = nextBusinessHourStart(startAt, fu);
      return {
        ok: false,
        reason: "fora_horario_comercial",
        sugestao: `O horário solicitado está fora do horário comercial. Próximo horário disponível: ${proxSlot.toISOString()}.`,
      };
    }
  }

  // Verificar conflito (tenant-level)
  const sb = ctx.sb ?? createSupabaseServiceClient();
  const temConflito = await hasOverlappingEvent({
    sb,
    tenantId: ctx.tenantId,
    newStart: startAt,
    newEnd: endAt,
  });

  if (temConflito) {
    return {
      ok: false,
      reason: "conflito_de_horario",
      sugestao: "Já existe um agendamento neste horário. Sugira outro horário ao cliente.",
    };
  }

  return {
    ok: true,
    data: {
      disponivel: true,
      inicio: startAt.toISOString(),
      fim: endAt.toISOString(),
    },
  };
}

// ── 3. criar_agendamento ─────────────────────────────────────────────────────

export async function executarCriarAgendamento(
  ctx: AgendaToolContext,
  params: {
    data: string;
    hora: string;
    duracao_min?: string;
    titulo?: string;
    local?: string;
    confirmacao_do_cliente: string;
  },
): Promise<AgendaToolResult> {
  const blocked = requireAgendaClientConfirmation(params.confirmacao_do_cliente, ctx);
  if (blocked) return blocked;

  if (!isValidDate(params.data) || !isValidTime(params.hora)) {
    return { ok: false, reason: "data_ou_hora_invalida", sugestao: "Use DD/MM/AAAA e HH:MM." };
  }

  const duracaoMin = Math.max(15, Math.min(480, Number(params.duracao_min ?? "60") || 60));
  const startAt = parseDirectiveDatetime(params.data, params.hora, ctx.timezone);
  if (!startAt || Number.isNaN(startAt.getTime())) {
    return { ok: false, reason: "erro_ao_converter_data_hora" };
  }
  if (startAt.getTime() <= Date.now()) {
    return { ok: false, reason: "horario_no_passado", sugestao: "Informe uma data e hora futuras." };
  }
  const endAt = new Date(startAt.getTime() + duracaoMin * 60_000);

  // Validar horário comercial
  const fu = ctx.followUpInteligente;
  if (fu?.usarHorarioComercial) {
    const dentroDoHorario = isWithinBusinessHours(startAt, fu);
    if (!dentroDoHorario) {
      const proxSlot = nextBusinessHourStart(startAt, fu);
      return {
        ok: false,
        reason: "fora_horario_comercial",
        sugestao: `Fora do horário comercial. Próximo disponível: ${proxSlot.toISOString()}.`,
      };
    }
  }

  const sb = ctx.sb ?? createSupabaseServiceClient();

  // Verificar conflito (tenant-level)
  const temConflito = await hasOverlappingEvent({ sb, tenantId: ctx.tenantId, newStart: startAt, newEnd: endAt });
  if (temConflito) {
    return {
      ok: false,
      reason: "conflito_de_horario",
      sugestao: "Horário ocupado. Ofereça um horário alternativo ao cliente.",
    };
  }

  // Criar via executeAgendaDirective (reutiliza dedup + Google sync)
  const directive: AgendaDirective = {
    type: "schedule",
    date: params.data,
    time: params.hora,
    location: params.local?.trim() || null,
  };

  try {
    const result = await executeAgendaDirective({
      sb,
      tenantId: ctx.tenantId,
      remoteJid: ctx.remoteJid,
      leadId: ctx.leadId,
      agentId: ctx.agentId,
      contactName: ctx.contactName,
      timezone: ctx.timezone,
      directive,
    });
    let scheduleHandoffTriggered = false;
    if (result.action === "scheduled" || result.action === "rescheduled") {
      scheduleHandoffTriggered = await runPostSuccessForMutation(
        ctx,
        result.action,
        result.eventId,
        result.previousEventId,
      );
    }
    const data: Record<string, unknown> = {
      acao: result.action,
      event_id: result.eventId,
      inicio: startAt.toISOString(),
      fim: endAt.toISOString(),
      schedule_handoff_triggered: scheduleHandoffTriggered,
    };
    if (result.action === "rescheduled" && result.previousEventId) {
      data.event_id_anterior = result.previousEventId;
    }
    return {
      ok: true,
      data,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[agenda-tool-executors] criar_agendamento_error", { tenant_id: ctx.tenantId, error: msg });
    return { ok: false, reason: msg === "invalid_or_past_agenda_datetime" ? "horario_no_passado" : "erro_ao_criar_agendamento" };
  }
}

// ── 4. remarcar_agendamento ──────────────────────────────────────────────────

export async function executarRemarcarAgendamento(
  ctx: AgendaToolContext,
  params: {
    event_id: string;
    nova_data: string;
    nova_hora: string;
    duracao_min?: string;
    confirmacao_do_cliente: string;
  },
): Promise<AgendaToolResult> {
  const blocked = requireAgendaClientConfirmation(params.confirmacao_do_cliente, ctx);
  if (blocked) return blocked;

  if (!isValidDate(params.nova_data) || !isValidTime(params.nova_hora)) {
    return { ok: false, reason: "data_ou_hora_invalida", sugestao: "Use DD/MM/AAAA e HH:MM." };
  }

  const sb = ctx.sb ?? createSupabaseServiceClient();
  const attendeePhone = extractPhone(ctx.remoteJid);

  // Validar posse: evento pertence ao tenant E ao attendee_phone do contato atual
  const event = await getAgendaEventById(ctx.tenantId, params.event_id);
  if (!event) {
    return { ok: false, reason: "agendamento_nao_encontrado" };
  }
  if (event.status === "cancelled") {
    return { ok: false, reason: "agendamento_ja_cancelado" };
  }
  if (attendeePhone && event.attendee_phone !== attendeePhone) {
    return {
      ok: false,
      reason: "agendamento_nao_pertence_ao_contato",
      sugestao: "Este agendamento não pertence ao contato desta conversa.",
    };
  }

  const duracaoMin = Math.max(15, Math.min(480, Number(params.duracao_min ?? "60") || 60));
  let novaData = params.nova_data;
  const relativeDays = ctx.lastMessage ? parseRelativeDaysOffset(ctx.lastMessage) : null;
  if (relativeDays != null) {
    novaData = addDaysInTimezone(ctx.timezone, relativeDays);
  }
  const novoStart = parseDirectiveDatetime(novaData, params.nova_hora, ctx.timezone);
  if (!novoStart || Number.isNaN(novoStart.getTime())) {
    return { ok: false, reason: "erro_ao_converter_data_hora" };
  }
  if (novoStart.getTime() <= Date.now()) {
    return { ok: false, reason: "horario_no_passado", sugestao: "Informe uma data e hora futuras." };
  }
  const novoEnd = new Date(novoStart.getTime() + duracaoMin * 60_000);

  // Validar horário comercial
  const fu = ctx.followUpInteligente;
  if (fu?.usarHorarioComercial) {
    const dentroDoHorario = isWithinBusinessHours(novoStart, fu);
    if (!dentroDoHorario) {
      const proxSlot = nextBusinessHourStart(novoStart, fu);
      return {
        ok: false,
        reason: "fora_horario_comercial",
        sugestao: `Fora do horário comercial. Próximo disponível: ${proxSlot.toISOString()}.`,
      };
    }
  }

  // Verificar conflito excluindo o próprio evento que será remarcado
  const temConflito = await hasOverlappingEvent({
    sb,
    tenantId: ctx.tenantId,
    newStart: novoStart,
    newEnd: novoEnd,
    excludeEventId: params.event_id,
  });
  if (temConflito) {
    return {
      ok: false,
      reason: "conflito_de_horario",
      sugestao: "Horário ocupado. Ofereça outro horário ao cliente.",
    };
  }

  // Usar executeAgendaDirective: insere novo e cancela o existente automaticamente
  const directive: AgendaDirective = {
    type: "schedule",
    date: novaData,
    time: params.nova_hora,
    location: event.location ?? null,
  };

  try {
    const result = await executeAgendaDirective({
      sb,
      tenantId: ctx.tenantId,
      remoteJid: ctx.remoteJid,
      leadId: ctx.leadId ?? event.lead_id,
      agentId: ctx.agentId,
      contactName: ctx.contactName,
      timezone: ctx.timezone,
      directive,
      replaceEventId: params.event_id,
    });
    let scheduleHandoffTriggered = false;
    if (result.action === "rescheduled" || result.action === "scheduled") {
      scheduleHandoffTriggered = await runPostSuccessForMutation(
        ctx,
        result.action,
        result.eventId,
        result.previousEventId ?? params.event_id,
      );
    }
    return {
      ok: true,
      data: {
        acao: result.action,
        event_id: result.eventId,
        event_id_anterior: params.event_id,
        inicio: novoStart.toISOString(),
        fim: novoEnd.toISOString(),
        schedule_handoff_triggered: scheduleHandoffTriggered,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[agenda-tool-executors] remarcar_agendamento_error", { tenant_id: ctx.tenantId, error: msg });
    return { ok: false, reason: "erro_ao_remarcar_agendamento" };
  }
}

// ── 5. cancelar_agendamento ──────────────────────────────────────────────────

export async function executarCancelarAgendamento(
  ctx: AgendaToolContext,
  params: { event_id: string; confirmacao_do_cliente: string },
): Promise<AgendaToolResult> {
  const blocked = requireAgendaClientConfirmation(params.confirmacao_do_cliente, ctx);
  if (blocked) return blocked;

  const sb = ctx.sb ?? createSupabaseServiceClient();
  const attendeePhone = extractPhone(ctx.remoteJid);

  // Validar posse: evento pertence ao tenant E ao attendee_phone do contato atual
  const event = await getAgendaEventById(ctx.tenantId, params.event_id);
  if (!event) {
    return { ok: false, reason: "agendamento_nao_encontrado" };
  }
  if (event.status === "cancelled") {
    return { ok: false, reason: "agendamento_ja_cancelado" };
  }
  if (attendeePhone && event.attendee_phone !== attendeePhone) {
    return {
      ok: false,
      reason: "agendamento_nao_pertence_ao_contato",
      sugestao: "Este agendamento não pertence ao contato desta conversa.",
    };
  }

  // Cancelar via executeAgendaDirective (cancela no banco + Google Calendar)
  const directive: AgendaDirective = { type: "cancel", eventId: params.event_id };

  try {
    const result = await executeAgendaDirective({
      sb,
      tenantId: ctx.tenantId,
      remoteJid: ctx.remoteJid,
      leadId: ctx.leadId ?? event.lead_id,
      agentId: ctx.agentId,
      contactName: ctx.contactName,
      timezone: ctx.timezone,
      directive,
    });

    let scheduleHandoffTriggered = false;
    if (result.action === "cancelled") {
      scheduleHandoffTriggered = await runPostSuccessForMutation(ctx, "cancelled", params.event_id);
    }

    return {
      ok: true,
      data: {
        acao: result.action,
        event_id: result.eventId,
        titulo: event.title,
        inicio: event.start_at,
        schedule_handoff_triggered: scheduleHandoffTriggered,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[agenda-tool-executors] cancelar_agendamento_error", { tenant_id: ctx.tenantId, error: msg });
    return { ok: false, reason: msg === "agenda_event_contact_mismatch" ? "agendamento_nao_pertence_ao_contato" : "erro_ao_cancelar_agendamento" };
  }
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

/**
 * Executa uma tool de agenda pelo nome, parseando os argumentos JSON.
 * Nunca lança: retorna AgendaToolResult com ok=false em qualquer exceção.
 */
export async function dispatchAgendaTool(
  toolName: string,
  argumentsRaw: string,
  ctx: AgendaToolContext,
): Promise<AgendaToolResult> {
  let args: Record<string, string> = {};
  try {
    const parsed = JSON.parse(argumentsRaw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      args = parsed as Record<string, string>;
    }
  } catch {
    return { ok: false, reason: "argumentos_invalidos" };
  }

  switch (toolName) {
    case "consultar_agendamentos":
      return executarConsultarAgendamentos(ctx);

    case "verificar_disponibilidade":
      return executarVerificarDisponibilidade(ctx, {
        data: String(args.data ?? ""),
        hora: String(args.hora ?? ""),
        duracao_min: args.duracao_min,
      });

    case "criar_agendamento":
      return executarCriarAgendamento(ctx, {
        data: String(args.data ?? ""),
        hora: String(args.hora ?? ""),
        duracao_min: args.duracao_min,
        titulo: args.titulo,
        local: args.local,
        confirmacao_do_cliente: String(args.confirmacao_do_cliente ?? "false"),
      });

    case "remarcar_agendamento":
      return executarRemarcarAgendamento(ctx, {
        event_id: String(args.event_id ?? ""),
        nova_data: String(args.nova_data ?? ""),
        nova_hora: String(args.nova_hora ?? ""),
        duracao_min: args.duracao_min,
        confirmacao_do_cliente: String(args.confirmacao_do_cliente ?? "false"),
      });

    case "cancelar_agendamento":
      return executarCancelarAgendamento(ctx, {
        event_id: String(args.event_id ?? ""),
        confirmacao_do_cliente: String(args.confirmacao_do_cliente ?? "false"),
      });

    default:
      return { ok: false, reason: `tool_desconhecida:${toolName}` };
  }
}
