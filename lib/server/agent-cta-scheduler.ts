import "server-only";

import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import {
  localWallClockToUtc,
  parseAppointmentDateTime,
  resolveScheduleDateTimeFromText,
} from "@/lib/server/agenda-datetime-parse";
import { parseTimezone } from "@/lib/agents/agent-datetime";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { broadcastAgendaChange } from "@/lib/server/agenda-realtime";
import {
  cancelGoogleCalendarEvent,
  createGoogleCalendarEvent,
} from "@/lib/server/google-calendar";
import {
  cancelAgendaEvent,
  getAgendaEventById,
  getGoogleCalendarToken,
  insertAgendaEvent,
  updateAgendaEvent,
  type AgendaEventRow,
} from "@/lib/server/google-calendar-db";
import {
  cancelAgendaRemindersForEvent,
  scheduleAgendaRemindersForEvent,
} from "@/lib/server/agenda-reminder-jobs";
import type { AgentAgendaDisponibilidade, AgentAgendaLembretes } from "@/lib/types";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

const SCHEDULE_CTA_VALUE = "Agendar no Google Agenda";
const SCHEDULING_DEDUPE_WINDOW_MS = 30 * 24 * 60 * 60_000;
const CONFIRMATION_RE =
  /\b(sim|t[aá]\s*bom|t[aá]|pode|claro|com\s*certeza|[oó]timo|certo|isso|exato|confirm|confirmo|confirmada|confirmado|fechou|fechado|combinado|perfeito|ok|pode\s*ser)\b/i;
/** Novo pedido de mutação na mesma mensagem — não conta como confirmação isolada. */
const AGENDA_MUTATION_IN_MESSAGE_RE =
  /\b(?:quero|preciso|gostaria|desejo|vou)\s+(?:cancelar|remarcar|reagendar|agendar|marcar|desmarcar)\b|\b(?:remarcar|reagendar|agendar|marcar)\s+(?:para|em|no|na)\b|\b\d{1,2}\s*[/-]\s*\d{1,2}\b|\bdaqui\s+(?:a\s+)?\d+\s+dias?\b|\bsemana\s+que\s+vem\b|\bproxim[ao]\s+\w{3,}/i;
const CANCEL_INTENT_RE =
  /\b(cancelar|cancelamento|desmarcar|desmarcação|desmarcacao)\b/i;
const RESCHEDULE_RE =
  /\b(remarcar|reagendar|trocar\s+(o\s+)?hor[aá]rio|mudar\s+(a\s+)?data|outro\s+hor[aá]rio|alterar\s+agendamento)\b/i;
const SCHEDULING_RE =
  /\b(agendamento|agend|cancelamento|cancelar|remarcar|reagendar|reuni[aã]o|visita|hor[aá]rio|amanh[ãa]|hoje|segunda|ter[cç]a|quarta|quinta|sexta|s[áa]bado|domingo|\d{1,2}[:h]\d{2}|\d{1,2}\/\d{1,2})\b/i;
const AGENDA_DIRECTIVE_RE = /\[\[\s*(AGENDAR|CANCELAR_AGENDA)\s*(?::\s*([^\]]*))?\]\]/gi;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const AGENDA_FAILURE_REPLY =
  "Não consegui confirmar essa alteração na agenda agora. Nossa equipe vai conferir e te retornar em breve.";
export const AGENDA_AUTOMATION_DISABLED_REPLY =
  "Posso consultar seus compromissos existentes, mas não consigo criar, remarcar ou cancelar agendamentos por aqui no momento.";

/**
 * Verifica se uma data/hora está dentro da janela de disponibilidade configurada.
 * @param date   Data do evento (UTC).
 * @param disp   Configuração de disponibilidade do agente.
 * @param tz     Fuso IANA do agente (a data é convertida para local antes de checar).
 */
function isWithinAgendaAvailability(
  date: Date,
  disp: AgentAgendaDisponibilidade,
  tz: string,
): boolean {
  const resolved = parseTimezone(tz);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: resolved,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const dow = weekdayMap[get("weekday")] ?? -1;
  if (!disp.diasSemana.includes(dow)) return false;
  const h = parseInt(get("hour"), 10);
  const m = parseInt(get("minute"), 10);
  const totalMin = h * 60 + m;
  const [startH = 0, startM = 0] = disp.horaInicio.split(":").map(Number);
  const [endH = 23, endM = 59] = disp.horaFim.split(":").map(Number);
  const startMin = startH * 60 + startM;
  const endMin = endH * 60 + endM;
  return totalMin >= startMin && totalMin < endMin;
}

export type AgendaEventSummary = {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  status: string;
  attendee_name: string | null;
  location: string | null;
  description: string | null;
};

export type CreateAgendaEventResult =
  | { created: true; eventId: string }
  | { created: false; reason: "active_exists"; existing: AgendaEventSummary }
  | { created: false; reason: "unparsed_datetime" };

export type AgendaDirective =
  | { type: "schedule"; date: string; time: string; location: string | null }
  | { type: "cancel"; eventId: string | null };

export type ParsedAgendaDirectives = {
  directives: AgendaDirective[];
  invalid: boolean;
};

export type ProcessAgendaDirectivesResult = {
  text: string;
  action: "none" | "scheduled" | "rescheduled" | "cancelled" | "failed";
  eventId?: string;
};

export type PreparedAgendaDirectiveResult = {
  text: string;
  directive: AgendaDirective | null;
  action: "none" | "pending" | "blocked" | "failed";
};

export function isSchedulingCta(ctaFinal: unknown): boolean {
  return typeof ctaFinal === "string" && ctaFinal.trim() === SCHEDULE_CTA_VALUE;
}

export function textHasSchedulingContext(text: string): boolean {
  return SCHEDULING_RE.test(text.trim().toLowerCase());
}

/** Prioriza o texto atual se já tiver contexto de agenda; senão usa o outbound anterior do agente. */
export function assistantTextForSchedulingConfirmation(
  currentAssistantText: string,
  priorAssistantText?: string | null,
): string {
  const current = currentAssistantText.trim();
  if (current && textHasSchedulingContext(current)) return current;
  const prior = priorAssistantText?.trim();
  if (prior) return prior;
  return current;
}

export function detectSchedulingConfirmation(userText: string, assistantText?: string): boolean {
  const text = userText.trim().toLowerCase();
  if (!text) return false;
  if (!CONFIRMATION_RE.test(text)) return false;
  return textHasSchedulingContext(text) || (!!assistantText && textHasSchedulingContext(assistantText));
}

export function detectRescheduleIntent(userText: string, assistantText?: string): boolean {
  const text = userText.trim().toLowerCase();
  if (!text) return false;
  if (RESCHEDULE_RE.test(text)) return true;
  return (
    CONFIRMATION_RE.test(text) &&
    !!assistantText &&
    /\b(remarcar|reagendar|outro\s+hor[aá]rio)\b/i.test(assistantText)
  );
}

export function detectRescheduleConfirmation(
  userText: string,
  assistantText: string | undefined,
  hasActiveEvent: boolean,
): boolean {
  if (!hasActiveEvent) return false;
  if (detectRescheduleIntent(userText, assistantText)) return true;
  return detectSchedulingConfirmation(userText, assistantText);
}

/** Pedido inicial de criar/remarcar/cancelar — não é confirmação explícita do cliente. */
export function isInitialAgendaMutationRequest(userText: string): boolean {
  const text = userText.trim().toLowerCase();
  if (!text) return false;
  if (
    /^\s*(sim|ok|pode|confirmo|confirmado|claro|perfeito|fechado|combinado|t[aá]\s*bom)\s*[!.?]*\s*$/i.test(
      text,
    )
  ) {
    return false;
  }
  if (/^\s*(sim|ok|pode|confirmo)\b/i.test(text) && CONFIRMATION_RE.test(text)) {
    return false;
  }
  return (
    /\b(quero|preciso|gostaria|desejo|vou)\s+(cancelar|remarcar|reagendar|agendar|marcar|desmarcar)\b/i.test(
      text,
    ) ||
    /\b(cancelar|remarcar|reagendar|desmarcar)\s+(meu|minha|o|a)?\s*agendamento/i.test(text) ||
    /^(cancelar|remarcar|reagendar|desmarcar|agendar)\b/i.test(text)
  );
}

const CONFIRMATION_ONLY_WORDS = new Set([
  "sim",
  "ok",
  "pode",
  "confirmo",
  "confirmar",
  "confirmado",
  "confirmada",
  "claro",
  "perfeito",
  "fechado",
  "combinado",
  "isso",
  "certo",
  "exato",
  "ta",
  "bom",
  "ser",
  "cancelar",
  "desmarcar",
]);

/** Resposta curta só de confirmação (sem novo pedido de agenda na mesma mensagem). */
export function isStandaloneAgendaConfirmation(userText: string): boolean {
  const text = userText.trim();
  if (!text || isInitialAgendaMutationRequest(text)) return false;
  if (!CONFIRMATION_RE.test(text)) return false;
  if (AGENDA_MUTATION_IN_MESSAGE_RE.test(text)) return false;
  const tokens = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0 || tokens.length > 5) return false;
  return tokens.every((token) => CONFIRMATION_ONLY_WORDS.has(token));
}

/** Confirmação válida no inbound do lead (backend — não confiar só no prompt). */
export function clientConfirmedAgendaMutation(
  userText: string | null | undefined,
  assistantText?: string,
): boolean {
  if (!userText?.trim()) return false;
  if (isInitialAgendaMutationRequest(userText)) return false;
  if (isStandaloneAgendaConfirmation(userText)) return true;
  const text = userText.trim();
  if (
    assistantText?.trim() &&
    text.length <= 48 &&
    !AGENDA_MUTATION_IN_MESSAGE_RE.test(text) &&
    detectSchedulingConfirmation(userText, assistantText)
  ) {
    return true;
  }
  return false;
}

export function detectAgendaCancelIntent(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return CANCEL_INTENT_RE.test(trimmed);
}

function assistantProposedCancelConfirmation(assistantText: string): boolean {
  return (
    /\b(posso confirmar|confirma)\b/i.test(assistantText) &&
    detectAgendaCancelIntent(assistantText)
  );
}

function assistantProposedScheduleConfirmation(assistantText: string): boolean {
  return (
    /\b(posso confirmar|confirma)\b/i.test(assistantText) &&
    (RESCHEDULE_RE.test(assistantText) ||
      /\b(remarca[cç][aã]o|agendamento|agendar|marcar|hor[aá]rio)\b/i.test(assistantText))
  );
}

/** Última proposta de agenda do assistente no histórico (não o burst atual). */
export function priorAgendaAssistantTextFromMessages(
  messages: Array<{ role: string; content: string }>,
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== "assistant") continue;
    const text = stripAgendaDirectives(message.content.trim());
    if (!text) continue;
    if (assistantProposedScheduleConfirmation(text) || assistantProposedCancelConfirmation(text)) {
      return text;
    }
  }
  return null;
}

function extractPhone(remoteJid: string): string | null {
  const digits = remoteJid.split("@")[0]?.replace(/\D/g, "") ?? "";
  return digits.length >= 8 ? digits : null;
}

export function extractLocationFromText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const quoted = trimmed.match(/["“]([^"”]{3,120})["”]/);
  if (quoted?.[1]) return quoted[1].trim();

  const afterPrep = trimmed.match(
    /\b(?:no|na|em|local(?:ização)?|endereço|stand|escritório|sala)\s+([^.!?\n]{3,120})/i,
  );
  if (afterPrep?.[1]) {
    const loc = afterPrep[1].trim().replace(/\s+(?:para|às|as|no dia).*$/i, "").trim();
    if (loc.length >= 3) return loc.slice(0, 200);
  }

  const keyword = trimmed.match(
    /\b((?:stand|escritório|sala|showroom|loja)\s+[^.!?\n]{2,80})/i,
  );
  if (keyword?.[1]) return keyword[1].trim().slice(0, 200);

  return null;
}

function formatEventDateTimePtBr(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: timezone,
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function formatExistingAppointmentSchedulingBlock(
  event: AgendaEventSummary,
  timezone: string,
): string {
  const when = formatEventDateTimePtBr(event.start_at, timezone);
  const place = event.location?.trim() ? ` Local: ${event.location.trim()}.` : "";
  const name = event.attendee_name?.trim() ? ` Nome no agendamento: ${event.attendee_name.trim()}.` : "";
  return `[CONTEXTO DE AGENDAMENTO: Este lead já possui um agendamento ativo em ${when}.${place}${name} Informe o lead de forma natural que já existe esse compromisso e pergunte se deseja remarcar. Não confirme um novo agendamento até o lead confirmar explicitamente a remarcação com data e horário.]`;
}

export async function findActiveAgendaEventForScheduling(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  attendeePhone?: string | null;
  remoteJid?: string;
}): Promise<AgendaEventSummary | null> {
  const attendeePhone =
    params.attendeePhone ?? (params.remoteJid ? extractPhone(params.remoteJid) : null);
  if (!attendeePhone) return null;
  const sinceIso = new Date(Date.now() - SCHEDULING_DEDUPE_WINDOW_MS).toISOString();
  const res = (await params.sb
    .from("agenda_events")
    .select("id, title, start_at, end_at, status, attendee_name, location, description")
    .eq("tenant_id", params.tenantId)
    .eq("created_by", "agent")
    .eq("attendee_phone", attendeePhone)
    .neq("status", "cancelled")
    .gte("created_at", sinceIso)
    .ilike("title", "Agendamento via WhatsApp%")
    .order("start_at", { ascending: false })
    .limit(1)
    .maybeSingle()) as PostgrestSingleResponse<AgendaEventSummary>;
  if (res.error) return null;
  return res.data ?? null;
}

async function resolveAttendeeName(params: {
  sb: SupabaseServiceClient;
  contactName: string | null;
  leadId?: string | null;
}): Promise<string | null> {
  const fromContact = params.contactName?.trim();
  if (fromContact) return fromContact;
  if (!params.leadId) return null;
  const res = await params.sb.from("leads").select("name").eq("id", params.leadId).maybeSingle();
  const name = (res.data as { name?: string } | null)?.name?.trim();
  return name || null;
}

function formatAgendaDescription(params: {
  displayName: string;
  phone: string | null;
  startAt: Date;
  timezone: string;
  location: string | null;
  userMessage: string;
  assistantMessage: string;
}): string {
  const when = formatEventDateTimePtBr(params.startAt.toISOString(), params.timezone);
  return [
    "Agendamento via WhatsApp (agente)",
    "",
    `Nome: ${params.displayName}`,
    `Telefone: ${params.phone ?? "-"}`,
    `Data/hora: ${when} (${params.timezone})`,
    `Local: ${params.location ?? "não informado"}`,
    "",
    `Motivo/contexto: ${params.userMessage.trim() || "-"}`,
    `Confirmação do agente: ${params.assistantMessage.trim() || "-"}`,
  ].join("\n");
}

export async function createAgendaEventForSchedulingCta(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  contactName: string | null;
  userMessage: string;
  assistantMessage: string;
  timezone: string;
  leadId?: string | null;
  agentId?: string | null;
  rescheduleOfEventId?: string | null;
}): Promise<CreateAgendaEventResult> {
  const attendeePhone = extractPhone(params.remoteJid);

  if (params.rescheduleOfEventId) {
    await updateAgendaEvent(params.tenantId, params.rescheduleOfEventId, { status: "cancelled" });
  } else {
    const existing = await findActiveAgendaEventForScheduling({
      sb: params.sb,
      tenantId: params.tenantId,
      attendeePhone: attendeePhone,
    });
    if (existing) return { created: false, reason: "active_exists", existing };
  }

  const startDate = parseAppointmentDateTime({
    userMessage: params.userMessage,
    assistantMessage: params.assistantMessage,
    timezone: params.timezone,
  });
  if (!startDate) return { created: false, reason: "unparsed_datetime" };

  const endDate = new Date(startDate.getTime() + 60 * 60_000);
  const attendeeName = await resolveAttendeeName({
    sb: params.sb,
    contactName: params.contactName,
    leadId: params.leadId,
  });
  const displayName = attendeeName?.trim() || attendeePhone || "Lead";
  const location =
    extractLocationFromText(params.assistantMessage) ??
    extractLocationFromText(params.userMessage);
  const title = `Agendamento via WhatsApp - ${displayName}`;
  const description = formatAgendaDescription({
    displayName,
    phone: attendeePhone,
    startAt: startDate,
    timezone: params.timezone,
    location,
    userMessage: params.userMessage,
    assistantMessage: params.assistantMessage,
  });

  const inserted = await insertAgendaEvent({
    tenant_id: params.tenantId,
    google_event_id: null,
    title,
    description,
    location,
    color: "#f24400",
    start_at: startDate.toISOString(),
    end_at: endDate.toISOString(),
    all_day: false,
    attendee_name: attendeeName,
    attendee_phone: attendeePhone,
    attendee_email: null,
    status: "pending",
    created_by: "agent",
    lead_id: params.leadId ?? null,
    agent_id: params.agentId ?? null,
  });

  return { created: true, eventId: inserted.id };
}

function parseDirectiveParams(raw: string): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (const chunk of raw.split(",")) {
    const match = chunk.trim().match(/^([a-z_]+)\s*=\s*(.+)$/i);
    if (!match) return null;
    const key = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    if (!value || params[key]) return null;
    params[key] = value;
  }
  return params;
}

function isValidDate(value: string): boolean {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return false;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isValidTime(value: string): boolean {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  return Boolean(match && Number(match[1]) <= 23 && Number(match[2]) <= 59);
}

export function parseAgendaDirectives(text: string): ParsedAgendaDirectives {
  const directives: AgendaDirective[] = [];
  let invalid = false;
  let match: RegExpExecArray | null;
  AGENDA_DIRECTIVE_RE.lastIndex = 0;
  while ((match = AGENDA_DIRECTIVE_RE.exec(text)) !== null) {
    const name = match[1]!.toUpperCase();
    const rawParams = (match[2] ?? "").trim();

    if (name === "AGENDAR") {
      const values = parseDirectiveParams(rawParams);
      if (!values) { invalid = true; continue; }
      const keys = Object.keys(values);
      const allowed = keys.every((key) => key === "data" || key === "hora" || key === "local");
      const location = values.local?.trim() || null;
      if (
        !allowed ||
        !values.data ||
        !values.hora ||
        !isValidDate(values.data) ||
        !isValidTime(values.hora) ||
        (location != null && location.length > 200)
      ) {
        invalid = true;
        continue;
      }
      directives.push({ type: "schedule", date: values.data, time: values.hora, location });
      continue;
    }

    // CANCELAR_AGENDA — aceita sem params (auto-detecta evento ativo) ou com id=UUID
    if (!rawParams) {
      directives.push({ type: "cancel", eventId: null });
      continue;
    }
    const cancelValues = parseDirectiveParams(rawParams);
    if (!cancelValues || Object.keys(cancelValues).length !== 1 || !cancelValues.id || !UUID_RE.test(cancelValues.id)) {
      invalid = true;
      continue;
    }
    directives.push({ type: "cancel", eventId: cancelValues.id });
  }
  const markerCount = text.match(/\[\[\s*(?:AGENDAR|CANCELAR_AGENDA)\b/gi)?.length ?? 0;
  if (markerCount !== directives.length) invalid = true;
  if (directives.length > 1) invalid = true;
  return { directives, invalid };
}

export function stripAgendaDirectives(text: string): string {
  return text
    .replace(/\[\[\s*(?:AGENDAR|CANCELAR_AGENDA)\b[^\]]*\]\]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function directiveStartAt(directive: Extract<AgendaDirective, { type: "schedule" }>, timezone: string): Date {
  const [day, month, year] = directive.date.split("/").map(Number);
  const [hour, minute] = directive.time.split(":").map(Number);
  return localWallClockToUtc({ year: year!, month: month!, day: day!, hour: hour!, minute: minute! }, parseTimezone(timezone));
}

export async function findNextActiveAgendaEvent(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  now?: Date;
}): Promise<AgendaEventRow | null> {
  const attendeePhone = extractPhone(params.remoteJid);
  if (!attendeePhone) return null;
  const { data, error } = await params.sb
    .from("agenda_events")
    .select("*")
    .eq("tenant_id", params.tenantId)
    .eq("attendee_phone", attendeePhone)
    .neq("status", "cancelled")
    .gte("start_at", (params.now ?? new Date()).toISOString())
    .order("start_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as AgendaEventRow | null) ?? null;
}

async function cancelStructuredAgendaEvent(params: {
  tenantId: string;
  remoteJid: string;
  event: AgendaEventRow;
}): Promise<void> {
  const attendeePhone = extractPhone(params.remoteJid);
  if (!attendeePhone || params.event.attendee_phone !== attendeePhone) {
    throw new Error("agenda_event_contact_mismatch");
  }
  if (params.event.google_event_id) {
    await cancelGoogleCalendarEvent(params.tenantId, params.event.google_event_id);
  }
  await cancelAgendaEvent(params.tenantId, params.event.id);
  await broadcastAgendaChange(params.tenantId, "delete");
  // Cancelar lembretes pendentes ligados a este evento (fire-and-forget)
  cancelAgendaRemindersForEvent({ agendaEventId: params.event.id }).catch(() => undefined);
}

async function insertStructuredAgendaEvent(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  leadId?: string | null;
  agentId?: string | null;
  contactName?: string | null;
  timezone: string;
  directive: Extract<AgendaDirective, { type: "schedule" }>;
  agendaLembretes?: AgentAgendaLembretes | null;
  agendaDisponibilidade?: AgentAgendaDisponibilidade | null;
  slotIndex?: number;
}): Promise<AgendaEventRow> {
  const attendeePhone = extractPhone(params.remoteJid);
  if (!attendeePhone) throw new Error("invalid_remote_jid");
  const startAt = directiveStartAt(params.directive, params.timezone);
  if (Number.isNaN(startAt.getTime()) || startAt.getTime() <= Date.now()) {
    throw new Error("invalid_or_past_agenda_datetime");
  }
  // Validar janela de disponibilidade
  if (params.agendaDisponibilidade?.ativo) {
    if (!isWithinAgendaAvailability(startAt, params.agendaDisponibilidade, params.timezone)) {
      throw new Error("outside_agenda_availability");
    }
  }
  const endAt = new Date(startAt.getTime() + 60 * 60_000);
  const attendeeName = await resolveAttendeeName({
    sb: params.sb,
    contactName: params.contactName ?? null,
    leadId: params.leadId,
  });
  const displayName = attendeeName?.trim() || attendeePhone;
  const title = `Agendamento via WhatsApp - ${displayName}`;
  const description = formatAgendaDescription({
    displayName,
    phone: attendeePhone,
    startAt,
    timezone: params.timezone,
    location: params.directive.location,
    userMessage: "Agendamento confirmado via diretiva estruturada.",
    assistantMessage: `Data ${params.directive.date} às ${params.directive.time}.`,
  });
  const googleToken = await getGoogleCalendarToken(params.tenantId);
  let googleEventId: string | null = null;
  if (googleToken) {
    const googleEvent = await createGoogleCalendarEvent(params.tenantId, {
      title,
      description,
      location: params.directive.location,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      attendeeEmail: null,
    });
    googleEventId = googleEvent.id;
  }
  try {
    const inserted = await insertAgendaEvent({
      tenant_id: params.tenantId,
      google_event_id: googleEventId,
      title,
      description,
      location: params.directive.location,
      color: "#f24400",
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      all_day: false,
      attendee_name: attendeeName,
      attendee_phone: attendeePhone,
      attendee_email: null,
      status: "pending",
      created_by: "agent",
      lead_id: params.leadId ?? null,
      agent_id: params.agentId ?? null,
    });
    await broadcastAgendaChange(params.tenantId, "insert");
    // Agendar lembretes se configurados
    if (params.agendaLembretes?.ativo && params.agendaLembretes.regras.length > 0) {
      scheduleAgendaRemindersForEvent({
        sb: params.sb,
        tenantId: params.tenantId,
        agentId: params.agentId ?? null,
        slotIndex: params.slotIndex ?? 0,
        remoteJid: params.remoteJid,
        agendaEventId: inserted.id,
        eventStartAt: startAt,
        attendeeName: attendeeName ?? null,
        location: params.directive.location ?? null,
        eventTitle: title,
        agendaLembretes: params.agendaLembretes,
        timezone: params.timezone,
      }).catch((err) =>
        console.warn("[agent-cta-scheduler] reminder_schedule_failed", {
          event_id: inserted.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    return inserted;
  } catch (error) {
    if (googleEventId) await cancelGoogleCalendarEvent(params.tenantId, googleEventId).catch(() => undefined);
    throw error;
  }
}

export async function executeAgendaDirective(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  leadId?: string | null;
  agentId?: string | null;
  contactName?: string | null;
  timezone: string;
  directive: AgendaDirective;
  agendaLembretes?: AgentAgendaLembretes | null;
  agendaDisponibilidade?: AgentAgendaDisponibilidade | null;
  slotIndex?: number;
}): Promise<{ action: "scheduled" | "rescheduled" | "cancelled"; eventId: string }> {
  const sb = params.sb ?? createSupabaseServiceClient();
  if (params.directive.type === "cancel") {
    let event: AgendaEventRow | null = null;
    if (params.directive.eventId) {
      // Cancelamento por ID específico (formato legado [[CANCELAR_AGENDA: id=UUID]])
      event = await getAgendaEventById(params.tenantId, params.directive.eventId);
      if (!event) throw new Error("agenda_event_not_found");
    } else {
      // Cancelamento automático: próximo evento ativo do contato
      event = await findNextActiveAgendaEvent({ sb, tenantId: params.tenantId, remoteJid: params.remoteJid });
      if (!event) throw new Error("agenda_event_not_found");
    }
    await cancelStructuredAgendaEvent({ tenantId: params.tenantId, remoteJid: params.remoteJid, event });
    return { action: "cancelled", eventId: event.id };
  }

  const directive = params.directive;
  const existing = await findNextActiveAgendaEvent({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
  });
  const requestedStartAt = directiveStartAt(directive, params.timezone);
  const existingStartMs = existing ? new Date(existing.start_at).getTime() : NaN;
  if (!Number.isNaN(existingStartMs) && existingStartMs === requestedStartAt.getTime()) {
    return { action: "scheduled", eventId: existing!.id };
  }
  const inserted = await insertStructuredAgendaEvent({ ...params, sb, directive });
  if (!existing) return { action: "scheduled", eventId: inserted.id };
  try {
    await cancelStructuredAgendaEvent({ tenantId: params.tenantId, remoteJid: params.remoteJid, event: existing });
  } catch (error) {
    await cancelStructuredAgendaEvent({ tenantId: params.tenantId, remoteJid: params.remoteJid, event: inserted }).catch(() => undefined);
    throw error;
  }
  return { action: "rescheduled", eventId: inserted.id };
}

export async function processAgendaDirectivesInReply(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  leadId?: string | null;
  agentId?: string | null;
  contactName?: string | null;
  timezone: string;
  text: string;
  agendaLembretes?: AgentAgendaLembretes | null;
  agendaDisponibilidade?: AgentAgendaDisponibilidade | null;
  slotIndex?: number;
}): Promise<ProcessAgendaDirectivesResult> {
  const prepared = prepareAgendaDirectiveInReply({ text: params.text, enabled: true });
  if (prepared.action === "none") return { text: prepared.text, action: "none" };
  if (!prepared.directive) return { text: prepared.text, action: "failed" };
  return executePreparedAgendaDirective({ ...params, prepared });
}

export function prepareAgendaDirectiveInReply(params: {
  text: string;
  enabled: boolean;
}): PreparedAgendaDirectiveResult {
  const parsed = parseAgendaDirectives(params.text);
  const text = stripAgendaDirectives(params.text);
  if (!parsed.invalid && parsed.directives.length === 0) {
    return { text, directive: null, action: "none" };
  }
  if (parsed.invalid || parsed.directives.length !== 1) {
    return { text: AGENDA_FAILURE_REPLY, directive: null, action: "failed" };
  }
  if (!params.enabled) {
    return { text, directive: null, action: "blocked" };
  }
  return { text, directive: parsed.directives[0]!, action: "pending" };
}

export async function executePreparedAgendaDirective(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  leadId?: string | null;
  agentId?: string | null;
  contactName?: string | null;
  timezone: string;
  prepared: PreparedAgendaDirectiveResult;
  agendaLembretes?: AgentAgendaLembretes | null;
  agendaDisponibilidade?: AgentAgendaDisponibilidade | null;
  slotIndex?: number;
}): Promise<ProcessAgendaDirectivesResult> {
  if (!params.prepared.directive) {
    return { text: params.prepared.text, action: params.prepared.action === "failed" ? "failed" : "none" };
  }
  try {
    const result = await executeAgendaDirective({ ...params, directive: params.prepared.directive });
    console.info("[agent-agenda-directive]", { tenant_id: params.tenantId, agent_id: params.agentId, action: result.action, event_id: result.eventId });
    return { text: params.prepared.text, ...result };
  } catch (error) {
    console.warn("[agent-agenda-directive]", {
      tenant_id: params.tenantId,
      agent_id: params.agentId,
      action: "failed",
      reason: error instanceof Error ? error.message : String(error),
    });
    return { text: AGENDA_FAILURE_REPLY, action: "failed" };
  }
}

export type ResolveAgendaTurnResult = {
  text: string;
  action:
    | "none"
    | "needs_confirmation"
    | "scheduled"
    | "rescheduled"
    | "cancelled"
    | "failed"
    | "blocked";
  eventId?: string;
  /** Quando true, handoff deve ser adiado (agenda falhou ou pendente). */
  deferHandoff?: boolean;
};

export function shouldDeferHandoffForAgendaResult(result: ResolveAgendaTurnResult): boolean {
  return (
    result.deferHandoff === true ||
    result.action === "failed" ||
    result.action === "needs_confirmation" ||
    result.action === "blocked"
  );
}

function resolveScheduleDirective(
  directive: Extract<AgendaDirective, { type: "schedule" }>,
  params: { clientText: string; assistantText: string; timezone: string },
): Extract<AgendaDirective, { type: "schedule" }> {
  const resolved = resolveScheduleDateTimeFromText({
    clientText: params.clientText,
    assistantText: params.assistantText,
    timezone: params.timezone,
    fallbackDate: directive.date,
    fallbackTime: directive.time,
  });
  if (!resolved) return directive;
  return { ...directive, date: resolved.date, time: resolved.time };
}

/** Orquestra confirmação, fallback e execução de agenda antes do envio ao lead. */
export async function resolveAgendaTurn(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  leadId?: string | null;
  agentId?: string | null;
  contactName?: string | null;
  timezone: string;
  modelText: string;
  clientText: string;
  agendaAutomationEnabled: boolean;
  priorAssistantText?: string | null;
  agendaLembretes?: AgentAgendaLembretes | null;
  agendaDisponibilidade?: AgentAgendaDisponibilidade | null;
  slotIndex?: number;
}): Promise<ResolveAgendaTurnResult> {
  const cleanText = stripAgendaDirectives(params.modelText);

  if (!params.agendaAutomationEnabled) {
    const parsed = parseAgendaDirectives(params.modelText);
    if (parsed.directives.length > 0 || parsed.invalid) {
      return { text: AGENDA_AUTOMATION_DISABLED_REPLY, action: "blocked", deferHandoff: true };
    }
    return { text: cleanText, action: "none" };
  }

  const parsed = parseAgendaDirectives(params.modelText);
  if (parsed.invalid || parsed.directives.length > 1) {
    return { text: AGENDA_FAILURE_REPLY, action: "failed", deferHandoff: true };
  }

  const directive = parsed.directives.length === 1 ? parsed.directives[0]! : null;
  const proposalText = params.priorAssistantText?.trim() ?? "";
  const assistantForConfirm = assistantTextForSchedulingConfirmation(
    cleanText,
    params.priorAssistantText,
  );
  const confirmed = clientConfirmedAgendaMutation(params.clientText, assistantForConfirm);

  const cancelFromDirective = directive?.type === "cancel";
  const scheduleFromDirective = directive?.type === "schedule";
  const cancelFromContext =
    detectAgendaCancelIntent(params.clientText) ||
    assistantProposedCancelConfirmation(assistantForConfirm) ||
    assistantProposedCancelConfirmation(proposalText);
  const scheduleFromContext =
    isInitialAgendaMutationRequest(params.clientText) ||
    RESCHEDULE_RE.test(params.clientText) ||
    assistantProposedScheduleConfirmation(assistantForConfirm) ||
    assistantProposedScheduleConfirmation(proposalText);
  const confirmedFromPriorProposal =
    confirmed &&
    !directive &&
    (assistantProposedScheduleConfirmation(proposalText) ||
      assistantProposedCancelConfirmation(proposalText));

  const hasMutationIntent =
    cancelFromDirective ||
    scheduleFromDirective ||
    cancelFromContext ||
    scheduleFromContext ||
    confirmedFromPriorProposal;

  if (!hasMutationIntent) {
    return { text: cleanText, action: "none" };
  }

  if (!confirmed) {
    if (scheduleFromDirective || cancelFromDirective) {
      return {
        text: cleanText,
        action: "needs_confirmation",
        deferHandoff: true,
      };
    }
    // Cliente engajou a agenda NESTE turno (sem confirmação nem diretiva ainda):
    // adia o handoff para não interromper a mutação antes da confirmação.
    // Não considera só o contexto da proposta anterior, para não prender quem
    // realmente pivota para "falar com humano" sem intenção de agenda.
    const clientEngagedAgendaThisTurn =
      isInitialAgendaMutationRequest(params.clientText) ||
      RESCHEDULE_RE.test(params.clientText) ||
      detectAgendaCancelIntent(params.clientText);
    return {
      text: cleanText,
      action: "none",
      deferHandoff: clientEngagedAgendaThisTurn || undefined,
    };
  }

  let finalDirective: AgendaDirective;

  if (cancelFromDirective || (cancelFromContext && !scheduleFromDirective) || (confirmedFromPriorProposal && assistantProposedCancelConfirmation(proposalText))) {
    finalDirective =
      cancelFromDirective && directive?.type === "cancel"
        ? directive
        : { type: "cancel", eventId: null };
  } else if (scheduleFromDirective) {
    finalDirective = resolveScheduleDirective(directive as Extract<AgendaDirective, { type: "schedule" }>, {
      clientText: params.clientText,
      assistantText: assistantForConfirm,
      timezone: params.timezone,
    });
  } else {
    const resolved = resolveScheduleDateTimeFromText({
      clientText: params.clientText,
      assistantText: proposalText || assistantForConfirm,
      timezone: params.timezone,
    });
    if (!resolved) {
      return {
        text: AGENDA_FAILURE_REPLY,
        action: "failed",
        deferHandoff: true,
      };
    }
    const location =
      extractLocationFromText(assistantForConfirm) ?? extractLocationFromText(params.clientText);
    finalDirective = {
      type: "schedule",
      date: resolved.date,
      time: resolved.time,
      location,
    };
  }

  try {
    const sb = params.sb ?? createSupabaseServiceClient();
    const result = await executeAgendaDirective({
      sb,
      tenantId: params.tenantId,
      remoteJid: params.remoteJid,
      leadId: params.leadId,
      agentId: params.agentId,
      contactName: params.contactName,
      timezone: params.timezone,
      directive: finalDirective,
      agendaLembretes: params.agendaLembretes,
      agendaDisponibilidade: params.agendaDisponibilidade,
      slotIndex: params.slotIndex,
    });
    console.info("[agent-agenda-turn]", {
      tenant_id: params.tenantId,
      agent_id: params.agentId,
      action: result.action,
      event_id: result.eventId,
      fallback: !directive,
    });
    return { text: cleanText, action: result.action, eventId: result.eventId };
  } catch (error) {
    console.warn("[agent-agenda-turn]", {
      tenant_id: params.tenantId,
      agent_id: params.agentId,
      action: "failed",
      reason: error instanceof Error ? error.message : String(error),
    });
    return { text: AGENDA_FAILURE_REPLY, action: "failed", deferHandoff: true };
  }
}
