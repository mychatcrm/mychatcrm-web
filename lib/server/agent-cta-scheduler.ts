import "server-only";

import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import {
  localWallClockToUtc,
  parseAppointmentDateTime,
  resolveScheduleDateTimeFromText,
  textHasExplicitDateAnchor,
  textHasExplicitTime,
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
import {
  enqueueAgendaOwnerNotification,
  processAgendaNotificationOutbox,
} from "@/lib/server/agenda-notification-outbox";
import type { AgentAgendaDisponibilidade, AgentAgendaLembretes } from "@/lib/types";
import type { AgentAgendaPlan, AgentAgendaPlanAction } from "@/lib/ai/agent-turn-plan";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

const SCHEDULE_CTA_VALUE = "Agendar no Google Agenda";
const SCHEDULING_DEDUPE_WINDOW_MS = 30 * 24 * 60 * 60_000;
const CONFIRMATION_RE =
  /\b(sim|t[aá]\s*bom|t[aá]|pode|claro|com\s*certeza|[oó]timo|certo|isso|exato|confirm|confirmo|confirmada|confirmado|fechou|fechado|combinado|perfeito|ok|pode\s*ser)\b/i;
/** Novo pedido de mutação na mesma mensagem — não conta como confirmação isolada. */
const AGENDA_MUTATION_IN_MESSAGE_RE =
  /\b(?:quero|preciso|gostaria|desejo|vou)(?:\s+de)?\s+(?:cancelar|remarcar|reagendar|agendar|marcar|desmarcar)\b|\b(?:remarcar|reagendar|agendar|marcar)\s+(?:para|em|no|na)\b|\b\d{1,2}\s*[/-]\s*\d{1,2}\b|\bdaqui\s+(?:a\s+)?\d+\s+dias?\b|\bsemana\s+que\s+vem\b|\bproxim[ao]\s+\w{3,}/i;
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
export const AGENDA_FAILURE_REPLY_NO_HANDOFF =
  "Não consegui confirmar essa alteração na agenda agora. Tente novamente em instantes ou informe outra data e horário.";
export const AGENDA_SUCCESS_REPLY_SCHEDULED = "Agendamento confirmado.";
export const AGENDA_SUCCESS_REPLY_RESCHEDULED = "Remarcação confirmada.";
export const AGENDA_SUCCESS_REPLY_CANCELLED = "Cancelamento confirmado.";
export const AGENDA_AUTOMATION_DISABLED_REPLY =
  "Posso consultar seus compromissos existentes, mas não consigo criar, remarcar ou cancelar agendamentos por aqui no momento.";
export const AGENDA_SLOT_TAKEN_REPLY =
  "Esse horário acabou de ficar indisponível na nossa agenda. Pode me indicar outra data ou horário? Eu verifico a disponibilidade e confirmo na hora.";
export const AGENDA_UNVERIFIED_CLAIM_REPLY =
  "Só um instante — ainda não registrei essa alteração na agenda. Me confirme a data e o horário exatos (por exemplo: 20/07 às 14:00) que eu registro agora mesmo.";

/** Resposta do modelo afirmando que uma alteração de agenda foi concluída. */
const AGENDA_SUCCESS_CLAIM_RE =
  /\b(agendei|remarquei|cancelei|marquei)\b|\b(est[aá]|foi|ficou)\s+(agendad|remarcad|marcad|cancelad)/i;

const AGENDA_DIAS_PT = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export function buildOutsideAvailabilityReply(disp?: AgentAgendaDisponibilidade | null): string {
  const custom = disp?.mensagemForaJanela?.trim();
  if (custom) return custom;
  if (!disp || !Array.isArray(disp.diasSemana) || disp.diasSemana.length === 0) {
    return "Esse horário fica fora da nossa janela de agendamento. Me diga outra data ou horário que eu confirmo para você.";
  }
  const nomes = [...disp.diasSemana].sort((a, b) => a - b).map((d) => AGENDA_DIAS_PT[d] ?? String(d));
  const dias = nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
  return `Esse horário fica fora da nossa janela de agendamento. Atendemos ${dias}, das ${disp.horaInicio} às ${disp.horaFim}. Me diga outra data ou horário dentro desse período que eu confirmo para você.`;
}

export const AGENDA_DATETIME_NEEDED_REPLY =
  "Não consegui identificar a data e o horário exatos. Me diga o dia e a hora que você prefere (por exemplo: 20/07 às 14:00) que eu verifico e confirmo.";

function agendaFailureReplyForError(
  error: unknown,
  disp?: AgentAgendaDisponibilidade | null,
): string | null {
  const reason = error instanceof Error ? error.message : "";
  if (reason === "outside_agenda_availability") return buildOutsideAvailabilityReply(disp);
  if (reason === "agenda_slot_taken") return AGENDA_SLOT_TAKEN_REPLY;
  if (reason === "invalid_or_past_agenda_datetime") return AGENDA_DATETIME_NEEDED_REPLY;
  return null;
}

/**
 * Pergunta de confirmação neutra usada quando a resposta do modelo precisa ser
 * substituída por segurança (claim de sucesso sem mutação). Sem nomenclatura de
 * nicho: a data/hora vem da própria diretiva; o tipo de compromisso fica com o
 * prompt do tenant nas mensagens normais.
 */
function buildAgendaConfirmationQuestion(directive: AgendaDirective | null): string {
  if (directive?.type === "schedule") {
    return `Posso confirmar para ${directive.date} às ${directive.time}? Responda sim para confirmar.`;
  }
  if (directive?.type === "cancel") {
    return "Posso confirmar o cancelamento do seu horário? Responda sim para confirmar.";
  }
  return "Posso confirmar essa alteração na agenda. Responda sim para confirmar.";
}

const HUMAN_DELEGATION_IN_REPLY_RE =
  /\b(atendente\s+humano|humano\s+vai|entrar\s+em\s+contato|nossa\s+equipe|equipe\s+vai|respons[aá]vel\s+vai|transferir|transfer[eê]ncia)\b/i;
const CONFIRM_ASK_RE =
  /\b(posso confirmar|pode confirmar|confirma|confirmar|confirmando|tudo bem|tudo certo|serve|fica bom|pode ser|posso agendar|vou agendar)\b/i;
const DATE_OR_TIME_IN_TEXT_RE = /\d{1,2}\/\d{1,2}|\d{1,2}[:h]\d{2}|\bàs\s+\d{1,2}/i;
const AGENDA_TOPIC_RE =
  /\b(agendamento|agendar|remarc|reagend|hor[aá]rio|compromisso|marcar|cancel)/i;

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
    /\b(quero|preciso|gostaria|desejo|vou)(?:\s+de)?\s+(cancelar|remarcar|reagendar|agendar|marcar|desmarcar)\b/i.test(
      text,
    ) ||
    /\b(cancelar|remarcar|reagendar|desmarcar)\s+(meu|minha|o|a)?\s*agendamento/i.test(text) ||
    /^(cancelar|remarcar|reagendar|desmarcar|agendar|agenda|agende|marcar|marca|marque)\b/i.test(text)
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
    !text.includes("?") &&
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
  if (HUMAN_DELEGATION_IN_REPLY_RE.test(assistantText)) return false;
  return (
    CONFIRM_ASK_RE.test(assistantText) && detectAgendaCancelIntent(assistantText)
  );
}

function assistantProposedScheduleConfirmation(
  assistantText: string,
  timezone = "UTC",
): boolean {
  if (HUMAN_DELEGATION_IN_REPLY_RE.test(assistantText)) return false;
  // Agnóstico de nicho: uma proposta concreta com data + hora + pedido de
  // confirmação é agenda, mesmo que o tenant diga "visita", "sessão",
  // "avaliação" ou qualquer nomenclatura que não exista nos regexes antigos.
  if (
    CONFIRM_ASK_RE.test(assistantText) &&
    textHasExplicitDateAnchor(assistantText, timezone) &&
    textHasExplicitTime(assistantText)
  ) {
    return true;
  }
  if (
    CONFIRM_ASK_RE.test(assistantText) &&
    (RESCHEDULE_RE.test(assistantText) ||
      /\b(remarca[cç][aã]o|agendamento|agendar|marcar|hor[aá]rio)\b/i.test(assistantText))
  ) {
    return true;
  }
  return (
    CONFIRM_ASK_RE.test(assistantText) &&
    DATE_OR_TIME_IN_TEXT_RE.test(assistantText) &&
    AGENDA_TOPIC_RE.test(assistantText)
  );
}

function assistantProposedAgendaMutationConfirmation(
  assistantText: string,
  timezone = "UTC",
): boolean {
  return (
    assistantProposedScheduleConfirmation(assistantText, timezone) ||
    assistantProposedCancelConfirmation(assistantText)
  );
}

/** Remove menções a humano/equipe/transferência quando handoff está desativado. */
export function sanitizeAgendaReplyForNoHandoff(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || !HUMAN_DELEGATION_IN_REPLY_RE.test(trimmed)) return trimmed;
  const sentences = trimmed.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((sentence) => !HUMAN_DELEGATION_IN_REPLY_RE.test(sentence));
  const result = kept.join(" ").trim();
  if (result) return result;
  return "Posso confirmar essa alteração na agenda. Responda sim para confirmar.";
}

function finalizeResolveAgendaTurnResult(
  result: ResolveAgendaTurnResult,
  ctaHandoffAtivo?: boolean,
): ResolveAgendaTurnResult {
  if (ctaHandoffAtivo !== false) return result;
  if (result.action === "scheduled") {
    return { ...result, text: AGENDA_SUCCESS_REPLY_SCHEDULED };
  }
  if (result.action === "rescheduled") {
    return { ...result, text: AGENDA_SUCCESS_REPLY_RESCHEDULED };
  }
  if (result.action === "cancelled") {
    return { ...result, text: AGENDA_SUCCESS_REPLY_CANCELLED };
  }
  if (result.action === "failed") {
    // Só o texto genérico (que cita "nossa equipe") é trocado; mensagens específicas
    // por motivo (fora da janela, horário ocupado) já são neutras e ficam intactas.
    if (result.text === AGENDA_FAILURE_REPLY) {
      return { ...result, text: AGENDA_FAILURE_REPLY_NO_HANDOFF };
    }
    return result;
  }
  return { ...result, text: sanitizeAgendaReplyForNoHandoff(result.text) };
}

/** Última proposta de agenda do assistente no histórico (não o burst atual). */
export function priorAgendaAssistantTextFromMessages(
  messages: Array<{ role: string; content: string }>,
  timezone = "UTC",
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== "assistant") continue;
    const text = stripAgendaDirectives(message.content.trim());
    if (!text) continue;
    if (assistantProposedAgendaMutationConfirmation(text, timezone)) {
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
    /\b(?:no|na|em|local(?:ização)?|endereço|unidade|sede|filial|sala)\s+([^.!?\n]{3,120})/i,
  );
  if (afterPrep?.[1]) {
    const loc = afterPrep[1].trim().replace(/\s+(?:para|às|as|no dia).*$/i, "").trim();
    if (loc.length >= 3) return loc.slice(0, 200);
  }

  const keyword = trimmed.match(
    /\b((?:unidade|sede|filial|escritório|sala|local)\s+[^.!?\n]{2,80})/i,
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
  /** Evento a ignorar na checagem de conflito (o evento antigo do próprio contato numa remarcação). */
  excludeEventId?: string | null;
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
  // Bloqueio de agendamento duplo: qualquer evento ativo do tenant sobrepondo [startAt, endAt)
  // conta como conflito (inclui eventos manuais da UI e sincronizados do Google).
  if (params.agendaDisponibilidade?.permitirAgendamentosSimultaneos === false) {
    let conflictQuery = params.sb
      .from("agenda_events")
      .select("id")
      .eq("tenant_id", params.tenantId)
      .neq("status", "cancelled")
      .lt("start_at", endAt.toISOString())
      .gt("end_at", startAt.toISOString());
    if (params.excludeEventId) {
      conflictQuery = conflictQuery.neq("id", params.excludeEventId);
    }
    const { data: conflict, error: conflictError } = await conflictQuery.limit(1).maybeSingle();
    if (conflictError) throw conflictError;
    if (conflict) throw new Error("agenda_slot_taken");
  }
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

export type AtomicAgendaMutationResult = {
  action: "scheduled" | "rescheduled" | "cancelled";
  event: AgendaEventRow;
  previous_event: AgendaEventRow | null;
  changed: boolean;
  deduplicated: boolean;
  operation_status: "local_committed" | "sync_pending" | "completed";
};

const AGENDA_RPC_REASONS = [
  "agenda_event_not_found",
  "agenda_event_contact_mismatch",
  "agenda_slot_taken",
  "invalid_or_past_agenda_datetime",
  "invalid_remote_jid",
  "generation_stale",
  "invalid_job_params",
] as const;

/** Erro atômico de staleness da RPC: a geração deste job foi superada. */
export const AGENDA_GENERATION_STALE = "generation_stale";

function normalizeAgendaRpcError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String((error as { message?: unknown } | null)?.message ?? error);
  const known = AGENDA_RPC_REASONS.find((reason) => message.includes(reason));
  return new Error(known ?? message);
}

async function updateAgendaMutationOperation(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  operationKey: string;
  status: "sync_pending" | "completed";
  result: AtomicAgendaMutationResult;
  error?: unknown;
}): Promise<void> {
  const { error } = await params.sb
    .from("agenda_mutation_operations")
    .update({
      status: params.status,
      result: { ...params.result, operation_status: params.status },
      last_error:
        params.error == null
          ? null
          : params.error instanceof Error
            ? params.error.message
            : String(params.error),
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", params.tenantId)
    .eq("operation_key", params.operationKey);
  if (error) throw error;
}

export async function syncAtomicAgendaMutation(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  operationKey: string;
  result: AtomicAgendaMutationResult;
}): Promise<AtomicAgendaMutationResult> {
  let currentEvent =
    (await getAgendaEventById(params.tenantId, params.result.event.id)) ?? params.result.event;
  const previousEvent = params.result.previous_event?.id
    ? ((await getAgendaEventById(params.tenantId, params.result.previous_event.id)) ??
      params.result.previous_event)
    : null;
  let nextResult: AtomicAgendaMutationResult = {
    ...params.result,
    event: currentEvent,
    previous_event: previousEvent,
  };

  try {
    if (params.result.action === "scheduled" || params.result.action === "rescheduled") {
      if (!currentEvent.google_event_id) {
        const googleToken = await getGoogleCalendarToken(params.tenantId);
        if (googleToken) {
          const googleEvent = await createGoogleCalendarEvent(params.tenantId, {
            title: currentEvent.title,
            description: currentEvent.description,
            location: currentEvent.location,
            startAt: currentEvent.start_at,
            endAt: currentEvent.end_at,
            attendeeEmail: currentEvent.attendee_email,
          });
          await updateAgendaEvent(params.tenantId, currentEvent.id, {
            google_event_id: googleEvent.id,
          });
          currentEvent = { ...currentEvent, google_event_id: googleEvent.id };
          nextResult = { ...nextResult, event: currentEvent };
        }
      }
      if (params.result.action === "rescheduled" && previousEvent?.google_event_id) {
        await cancelGoogleCalendarEvent(params.tenantId, previousEvent.google_event_id);
      }
    } else if (currentEvent.google_event_id) {
      await cancelGoogleCalendarEvent(params.tenantId, currentEvent.google_event_id);
    }

    nextResult = { ...nextResult, operation_status: "completed" };
    await updateAgendaMutationOperation({
      sb: params.sb,
      tenantId: params.tenantId,
      operationKey: params.operationKey,
      status: "completed",
      result: nextResult,
    });
    await params.sb
      .from("agenda_sync_outbox")
      .update({
        status: "completed",
        claim_token: null,
        claim_expires_at: null,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", params.tenantId)
      .eq("operation_key", params.operationKey);
    return nextResult;
  } catch (error) {
    nextResult = { ...nextResult, operation_status: "sync_pending" };
    await updateAgendaMutationOperation({
      sb: params.sb,
      tenantId: params.tenantId,
      operationKey: params.operationKey,
      status: "sync_pending",
      result: nextResult,
      error,
    }).catch(() => undefined);
    await params.sb
      .from("agenda_sync_outbox")
      .update({
        status: "pending",
        claim_token: null,
        claim_expires_at: null,
        next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
        last_error: error instanceof Error ? error.message : String(error),
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", params.tenantId)
      .eq("operation_key", params.operationKey)
      .neq("status", "completed");
    console.warn("[agent-agenda-google-sync]", {
      tenant_id: params.tenantId,
      operation_key: params.operationKey,
      action: params.result.action,
      event_id: params.result.event.id,
      reason: error instanceof Error ? error.message : String(error),
    });
    return nextResult;
  }
}

export async function processAgendaSyncOutbox(params?: {
  sb?: SupabaseServiceClient;
  limit?: number;
}): Promise<{ processed: number; completed: number; pending: number; failed: number }> {
  const maxAttempts = 8;
  const sb = params?.sb ?? createSupabaseServiceClient();
  const counts = { processed: 0, completed: 0, pending: 0, failed: 0 };
  const now = new Date().toISOString();
  await sb
    .from("agenda_sync_outbox")
    .update({ status: "pending", claim_token: null, claim_expires_at: null, updated_at: now })
    .eq("status", "processing")
    .lt("claim_expires_at", now);
  const { data } = await sb
    .from("agenda_sync_outbox")
    .select("id,tenant_id,operation_key,payload,attempts")
    .eq("status", "pending")
    .lte("next_attempt_at", now)
    .order("created_at", { ascending: true })
    .limit(Math.max(1, Math.min(params?.limit ?? 25, 100)));
  for (const candidate of data ?? []) {
    const claimToken = crypto.randomUUID();
    const attempts = Number((candidate as { attempts?: number }).attempts ?? 0) + 1;
    const { data: claimed } = await sb
      .from("agenda_sync_outbox")
      .update({
        status: "processing",
        attempts,
        claim_token: claimToken,
        claim_expires_at: new Date(Date.now() + 180_000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", candidate.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;
    counts.processed += 1;
    const payload = candidate.payload as { result?: AtomicAgendaMutationResult } | null;
    if (!payload?.result?.event?.id) {
      await sb
        .from("agenda_sync_outbox")
        .update({
          status: "failed",
          claim_token: null,
          claim_expires_at: null,
          last_error: "invalid_sync_payload",
          updated_at: new Date().toISOString(),
        })
        .eq("id", candidate.id)
        .eq("claim_token", claimToken);
      counts.failed += 1;
      continue;
    }
    const result = await syncAtomicAgendaMutation({
      sb,
      tenantId: String(candidate.tenant_id),
      operationKey: String(candidate.operation_key),
      result: payload.result,
    });
    if (result.operation_status === "completed") {
      counts.completed += 1;
    } else if (attempts >= maxAttempts) {
      await sb
        .from("agenda_sync_outbox")
        .update({
          status: "failed",
          claim_token: null,
          claim_expires_at: null,
          last_error: "agenda_sync_attempts_exhausted",
          updated_at: new Date().toISOString(),
        })
        .eq("id", candidate.id)
        .eq("status", "pending");
      counts.failed += 1;
      console.error("[agent-agenda-google-sync]", {
        event: "retry_exhausted",
        tenant_id: candidate.tenant_id,
        operation_key: candidate.operation_key,
        attempts,
      });
    } else {
      await sb
        .from("agenda_sync_outbox")
        .update({
          next_attempt_at: new Date(
            Date.now() + agendaSyncRetryMinutes(attempts) * 60_000,
          ).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", candidate.id)
        .eq("status", "pending");
      counts.pending += 1;
    }
  }
  return counts;
}

export function agendaSyncRetryMinutes(attempts: number): number {
  return Math.min(2 ** Math.max(0, Math.floor(attempts) - 1), 60);
}

/**
 * Notificação ao dono APÓS mutação confirmada: enfileira de forma durável
 * (idempotente por tenant+operation_key+action) e envia inline, tudo awaited —
 * sem fire-and-forget. Falha de envio NÃO falha a mutação (retry via cron).
 */
async function enqueueAndSendOwnerNotification(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  action: "scheduled" | "rescheduled" | "cancelled";
  event: Pick<AgendaEventRow, "id" | "attendee_name" | "attendee_phone" | "start_at" | "location">;
  operationKey: string;
  timezone: string;
  agentId?: string | null;
}): Promise<void> {
  const entry = await enqueueAgendaOwnerNotification({
    sb: params.sb,
    tenantId: params.tenantId,
    agendaEventId: params.event.id,
    action: params.action,
    operationKey: params.operationKey,
    attendeeName: params.event.attendee_name,
    attendeePhone: params.event.attendee_phone,
    startAtIso: params.event.start_at,
    location: params.event.location ?? null,
    timezone: params.timezone,
    agentId: params.agentId ?? null,
  });
  // A obrigação pode ter sido inserida atomicamente pelo trigger da mutação.
  // Mesmo deduplicada, tente reivindicar seu id; linhas já processadas não são
  // reivindicadas novamente.
  if (entry.outboxId) {
    await processAgendaNotificationOutbox({ sb: params.sb, outboxId: entry.outboxId });
  }
}

async function executeAgendaDirectiveAtomically(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  leadId?: string | null;
  agentId?: string | null;
  contactName?: string | null;
  timezone: string;
  directive: AgendaDirective;
  operationKey: string;
  agendaLembretes?: AgentAgendaLembretes | null;
  agendaDisponibilidade?: AgentAgendaDisponibilidade | null;
  slotIndex?: number;
  /** Job e geração para validação atômica de staleness na RPC (caminho de job). */
  jobId?: string | null;
  claimedGeneration?: number | null;
  journeyId?: string | null;
}): Promise<{ action: "scheduled" | "rescheduled" | "cancelled"; eventId: string }> {
  const attendeePhone = extractPhone(params.remoteJid);
  if (!attendeePhone) throw new Error("invalid_remote_jid");

  let startAt: Date | null = null;
  let endAt: Date | null = null;
  let title: string | null = null;
  let description: string | null = null;
  let attendeeName: string | null = null;

  if (params.directive.type === "schedule") {
    startAt = directiveStartAt(params.directive, params.timezone);
    if (Number.isNaN(startAt.getTime()) || startAt.getTime() <= Date.now()) {
      throw new Error("invalid_or_past_agenda_datetime");
    }
    if (
      params.agendaDisponibilidade?.ativo &&
      !isWithinAgendaAvailability(startAt, params.agendaDisponibilidade, params.timezone)
    ) {
      throw new Error("outside_agenda_availability");
    }
    endAt = new Date(startAt.getTime() + 60 * 60_000);
    attendeeName = await resolveAttendeeName({
      sb: params.sb,
      contactName: params.contactName ?? null,
      leadId: params.leadId,
    });
    const displayName = attendeeName?.trim() || attendeePhone;
    title = `Agendamento via WhatsApp - ${displayName}`;
    description = formatAgendaDescription({
      displayName,
      phone: attendeePhone,
      startAt,
      timezone: params.timezone,
      location: params.directive.location,
      userMessage: "Agendamento confirmado via diretiva estruturada.",
      assistantMessage: `Data ${params.directive.date} às ${params.directive.time}.`,
    });
  }

  const { data, error } = await params.sb.rpc("apply_agent_agenda_mutation", {
    p_tenant_id: params.tenantId,
    p_operation_key: params.operationKey,
    p_action: params.directive.type,
    p_attendee_phone: attendeePhone,
    p_event_id: params.directive.type === "cancel" ? params.directive.eventId : null,
    p_title: title,
    p_description: description,
    p_location: params.directive.type === "schedule" ? params.directive.location : null,
    p_start_at: startAt?.toISOString() ?? null,
    p_end_at: endAt?.toISOString() ?? null,
    p_attendee_name: attendeeName,
    p_lead_id: params.leadId ?? null,
    p_agent_id: params.agentId ?? null,
    p_allow_simultaneous:
      params.agendaDisponibilidade?.permitirAgendamentosSimultaneos !== false,
    p_job_id: params.jobId ?? null,
    p_claimed_generation: params.claimedGeneration ?? null,
    p_journey_id: params.journeyId ?? null,
  });
  if (error) throw normalizeAgendaRpcError(error);

  const atomicResult = data as AtomicAgendaMutationResult | null;
  if (!atomicResult?.event?.id || !atomicResult.action) {
    throw new Error("invalid_agenda_mutation_result");
  }
  const syncedResult = await syncAtomicAgendaMutation({
    sb: params.sb,
    tenantId: params.tenantId,
    operationKey: params.operationKey,
    result: atomicResult,
  });

  if (atomicResult.changed && !atomicResult.deduplicated) {
    await broadcastAgendaChange(
      params.tenantId,
      syncedResult.action === "cancelled" ? "delete" : "insert",
    );
    if (syncedResult.action === "cancelled") {
      cancelAgendaRemindersForEvent({
        sb: params.sb,
        agendaEventId: syncedResult.event.id,
      }).catch(() => undefined);
    } else {
      if (syncedResult.previous_event?.id) {
        cancelAgendaRemindersForEvent({
          sb: params.sb,
          agendaEventId: syncedResult.previous_event.id,
        }).catch(() => undefined);
      }
      if (params.agendaLembretes?.ativo && params.agendaLembretes.regras.length > 0) {
        scheduleAgendaRemindersForEvent({
          sb: params.sb,
          tenantId: params.tenantId,
          agentId: params.agentId ?? null,
          slotIndex: params.slotIndex ?? 0,
          remoteJid: params.remoteJid,
          agendaEventId: syncedResult.event.id,
          eventStartAt: new Date(syncedResult.event.start_at),
          attendeeName: syncedResult.event.attendee_name,
          location: syncedResult.event.location,
          eventTitle: syncedResult.event.title,
          agendaLembretes: params.agendaLembretes,
          timezone: params.timezone,
        }).catch((reminderError) =>
          console.warn("[agent-cta-scheduler] reminder_schedule_failed", {
            event_id: syncedResult.event.id,
            error:
              reminderError instanceof Error ? reminderError.message : String(reminderError),
          }),
        );
      }
    }
    await enqueueAndSendOwnerNotification({
      sb: params.sb,
      tenantId: params.tenantId,
      action: syncedResult.action,
      event: syncedResult.event,
      operationKey: params.operationKey,
      timezone: params.timezone,
      agentId: params.agentId ?? null,
    });
  }

  return { action: syncedResult.action, eventId: syncedResult.event.id };
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
  /** Stable per inbound turn/job; enables durable idempotency and tenant locking. */
  operationKey?: string | null;
  /** Job e geração para validação atômica de staleness na RPC (caminho de job). */
  jobId?: string | null;
  claimedGeneration?: number | null;
  journeyId?: string | null;
}): Promise<{ action: "scheduled" | "rescheduled" | "cancelled"; eventId: string }> {
  const sb = params.sb ?? createSupabaseServiceClient();
  if (params.operationKey?.trim()) {
    return executeAgendaDirectiveAtomically({
      ...params,
      sb,
      operationKey: params.operationKey.trim(),
    });
  }
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
    await enqueueAndSendOwnerNotification({
      sb,
      tenantId: params.tenantId,
      action: "cancelled",
      event,
      operationKey: `legacy:cancelled:${event.id}`,
      timezone: params.timezone,
      agentId: params.agentId ?? null,
    });
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
  const inserted = await insertStructuredAgendaEvent({ ...params, sb, directive, excludeEventId: existing?.id ?? null });
  if (!existing) {
    await enqueueAndSendOwnerNotification({
      sb,
      tenantId: params.tenantId,
      action: "scheduled",
      event: inserted,
      operationKey: `legacy:scheduled:${inserted.id}`,
      timezone: params.timezone,
      agentId: params.agentId ?? null,
    });
    return { action: "scheduled", eventId: inserted.id };
  }
  try {
    await cancelStructuredAgendaEvent({ tenantId: params.tenantId, remoteJid: params.remoteJid, event: existing });
  } catch (error) {
    await cancelStructuredAgendaEvent({ tenantId: params.tenantId, remoteJid: params.remoteJid, event: inserted }).catch(() => undefined);
    throw error;
  }
  await enqueueAndSendOwnerNotification({
    sb,
    tenantId: params.tenantId,
    action: "rescheduled",
    event: inserted,
    operationKey: `legacy:rescheduled:${inserted.id}`,
    timezone: params.timezone,
    agentId: params.agentId ?? null,
  });
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
    const specific = agendaFailureReplyForError(error, params.agendaDisponibilidade);
    return { text: specific ?? AGENDA_FAILURE_REPLY, action: "failed" };
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
    | "blocked"
    /** Geração superada por mensagem mais nova (recusa atômica da RPC). O worker
     *  não deve enviar nada — o job re-agendado processa o contexto atual. */
    | "stale";
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
  params: { clientText: string; assistantText: string; timezone: string; recentClientMessages?: string[] },
): Extract<AgendaDirective, { type: "schedule" }> {
  // Só o texto DO CLIENTE pode corrigir a diretiva emitida pelo modelo. A prosa do
  // assistente cita nomes de dias fora do pedido (janela de atendimento, desculpas),
  // e usá-la aqui sobrescrevia diretivas corretas com datas erradas.
  const resolved = resolveScheduleDateTimeFromText({
    clientText: params.clientText,
    assistantText: "",
    timezone: params.timezone,
    fallbackDate: directive.date,
    fallbackTime: directive.time,
    recentClientMessages: params.recentClientMessages,
  });
  if (!resolved) return directive;
  return { ...directive, date: resolved.date, time: resolved.time };
}

type PendingAgendaActionRow = {
  id: string;
  action: "create" | "reschedule" | "cancel";
  event_id: string | null;
  proposed_date: string | null;
  proposed_time: string | null;
  proposed_location: string | null;
  expires_at: string;
};

function executableAction(action: AgentAgendaPlanAction): PendingAgendaActionRow["action"] | null {
  if (action === "create" || action === "propose_create") return "create";
  if (action === "reschedule" || action === "propose_reschedule") return "reschedule";
  if (action === "cancel" || action === "propose_cancel") return "cancel";
  return null;
}

function isProposalAction(action: AgentAgendaPlanAction): boolean {
  return action === "propose_create" || action === "propose_reschedule" || action === "propose_cancel";
}

async function loadPendingAgendaAction(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  agentId: string;
}): Promise<PendingAgendaActionRow | null> {
  const { data } = await params.sb
    .from("agent_agenda_pending_actions")
    .select("id,action,event_id,proposed_date,proposed_time,proposed_location,expires_at")
    .eq("tenant_id", params.tenantId)
    .eq("remote_jid", params.remoteJid)
    .eq("agent_id", params.agentId)
    .eq("state", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as PendingAgendaActionRow;
  if (Date.parse(row.expires_at) > Date.now()) return row;
  await params.sb
    .from("agent_agenda_pending_actions")
    .update({ state: "expired", updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("state", "pending");
  return null;
}

async function savePendingAgendaAction(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  journeyId?: string | null;
  agentId: string;
  action: PendingAgendaActionRow["action"];
  plan: AgentAgendaPlan;
  jobId?: string | null;
  generation?: number | null;
  timezone: string;
}): Promise<void> {
  const existing = await loadPendingAgendaAction(params);
  const patch = {
    journey_id: params.journeyId ?? null,
    action: params.action,
    event_id: params.plan.eventId && UUID_RE.test(params.plan.eventId) ? params.plan.eventId : null,
    proposed_date: params.plan.date,
    proposed_time: params.plan.time,
    proposed_location: params.plan.location,
    timezone: params.timezone,
    source_job_id: params.jobId ?? null,
    source_generation: params.generation ?? null,
    state: "pending",
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (existing) {
    await params.sb.from("agent_agenda_pending_actions").update(patch).eq("id", existing.id);
    return;
  }
  const { error } = await params.sb.from("agent_agenda_pending_actions").insert({
    tenant_id: params.tenantId,
    remote_jid: params.remoteJid,
    agent_id: params.agentId,
    ...patch,
  });
  if (error?.code === "23505") {
    const current = await loadPendingAgendaAction(params);
    if (current) await params.sb.from("agent_agenda_pending_actions").update(patch).eq("id", current.id);
  } else if (error) {
    throw new Error(error.message);
  }
}

function structuredAgendaSuccessText(
  action: "scheduled" | "rescheduled" | "cancelled",
  directive: AgendaDirective,
): string {
  if (action === "cancelled") return AGENDA_SUCCESS_REPLY_CANCELLED;
  if (directive.type !== "schedule") {
    return action === "rescheduled" ? AGENDA_SUCCESS_REPLY_RESCHEDULED : AGENDA_SUCCESS_REPLY_SCHEDULED;
  }
  const location = directive.location?.trim() ? `, em ${directive.location.trim()}` : "";
  return action === "rescheduled"
    ? `Remarcação confirmada para ${directive.date} às ${directive.time}${location}.`
    : `Agendamento confirmado para ${directive.date} às ${directive.time}${location}.`;
}

async function resolveStructuredAgendaPlan(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  leadId?: string | null;
  agentId: string;
  contactName?: string | null;
  timezone: string;
  clientText: string;
  modelText: string;
  plan: AgentAgendaPlan;
  agendaLembretes?: AgentAgendaLembretes | null;
  agendaDisponibilidade?: AgentAgendaDisponibilidade | null;
  slotIndex?: number;
  operationKey?: string | null;
  jobId?: string | null;
  claimedGeneration?: number | null;
  journeyId?: string | null;
}): Promise<ResolveAgendaTurnResult | null> {
  const pending = await loadPendingAgendaAction({
    sb: params.sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    agentId: params.agentId,
  });
  const standaloneConfirmation = Boolean(pending && isStandaloneAgendaConfirmation(params.clientText));
  const plannedAction = executableAction(params.plan.action);
  const action = standaloneConfirmation ? pending!.action : plannedAction;
  if (!action) return null;

  const effectivePlan: AgentAgendaPlan = standaloneConfirmation
    ? {
        action: pending!.action,
        date: pending!.proposed_date,
        time: pending!.proposed_time,
        location: pending!.proposed_location,
        eventId: pending!.event_id,
      }
    : params.plan;
  const proposal = isProposalAction(params.plan.action) && !standaloneConfirmation;
  const scheduleComplete = action === "cancel" || Boolean(effectivePlan.date && effectivePlan.time);

  const directAuthorized =
    action === "cancel"
      ? detectAgendaCancelIntent(params.clientText)
      : action === "reschedule"
        ? RESCHEDULE_RE.test(params.clientText) && scheduleComplete
        : isInitialAgendaMutationRequest(params.clientText) && scheduleComplete;
  const pendingAuthorized = Boolean(
    pending &&
    pending.action === action &&
    (standaloneConfirmation || clientConfirmedAgendaMutation(params.clientText, params.modelText)),
  );

  if (proposal || !scheduleComplete || (!directAuthorized && !pendingAuthorized)) {
    if (scheduleComplete) {
      await savePendingAgendaAction({
        sb: params.sb,
        tenantId: params.tenantId,
        remoteJid: params.remoteJid,
        journeyId: params.journeyId,
        agentId: params.agentId,
        action,
        plan: effectivePlan,
        jobId: params.jobId,
        generation: params.claimedGeneration,
        timezone: params.timezone,
      });
    }
    const directive: AgendaDirective | null = action === "cancel"
      ? { type: "cancel", eventId: effectivePlan.eventId && UUID_RE.test(effectivePlan.eventId) ? effectivePlan.eventId : null }
      : effectivePlan.date && effectivePlan.time
        ? { type: "schedule", date: effectivePlan.date, time: effectivePlan.time, location: effectivePlan.location }
        : null;
    return {
      text: scheduleComplete ? buildAgendaConfirmationQuestion(directive) : params.modelText,
      action: scheduleComplete ? "needs_confirmation" : "none",
      deferHandoff: true,
    };
  }

  const directive: AgendaDirective = action === "cancel"
    ? {
        type: "cancel",
        eventId: effectivePlan.eventId && UUID_RE.test(effectivePlan.eventId)
          ? effectivePlan.eventId
          : pending?.event_id ?? null,
      }
    : {
        type: "schedule",
        date: effectivePlan.date!,
        time: effectivePlan.time!,
        location: effectivePlan.location,
      };
  try {
    const result = await executeAgendaDirective({
      sb: params.sb,
      tenantId: params.tenantId,
      remoteJid: params.remoteJid,
      leadId: params.leadId,
      agentId: params.agentId,
      contactName: params.contactName,
      timezone: params.timezone,
      directive,
      agendaLembretes: params.agendaLembretes,
      agendaDisponibilidade: params.agendaDisponibilidade,
      slotIndex: params.slotIndex,
      operationKey: params.operationKey,
      jobId: params.jobId,
      claimedGeneration: params.claimedGeneration,
      journeyId: params.journeyId,
    });
    if (pending) {
      await params.sb
        .from("agent_agenda_pending_actions")
        .update({ state: "executed", updated_at: new Date().toISOString() })
        .eq("id", pending.id)
        .eq("state", "pending");
    }
    return {
      text: structuredAgendaSuccessText(result.action, directive),
      action: result.action,
      eventId: result.eventId,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (reason === AGENDA_GENERATION_STALE || reason === "invalid_job_params") {
      return { text: params.modelText, action: "stale" };
    }
    return {
      text: agendaFailureReplyForError(error, params.agendaDisponibilidade) ?? AGENDA_FAILURE_REPLY,
      action: "failed",
      deferHandoff: true,
    };
  }
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
  /** Plano validado por JSON Schema; tem precedência sobre marcadores legados. */
  agendaPlan?: AgentAgendaPlan | null;
  clientText: string;
  agendaAutomationEnabled: boolean;
  /** Quando false, respostas de sucesso/falha da agenda não mencionam humano/equipe. */
  ctaHandoffAtivo?: boolean;
  priorAssistantText?: string | null;
  agendaLembretes?: AgentAgendaLembretes | null;
  agendaDisponibilidade?: AgentAgendaDisponibilidade | null;
  slotIndex?: number;
  /** Stable per inbound message/job; makes the agenda mutation retry-safe. */
  operationKey?: string | null;
  /** Job e geração para validação atômica de staleness na RPC (caminho de job). */
  jobId?: string | null;
  claimedGeneration?: number | null;
  journeyId?: string | null;
  /** Mensagens inbound recentes do lead (ordem temporal), para resolver
   *  complementos que chegaram em jobs anteriores (ex.: data num turno, hora no
   *  seguinte). Já filtradas por tenant+journey e janela segura pelo chamador. */
  recentClientMessages?: string[] | null;
}): Promise<ResolveAgendaTurnResult> {
  const cleanText = stripAgendaDirectives(params.modelText);
  const finalize = (result: ResolveAgendaTurnResult) =>
    finalizeResolveAgendaTurnResult(result, params.ctaHandoffAtivo);

  if (!params.agendaAutomationEnabled) {
    const parsed = parseAgendaDirectives(params.modelText);
    const clientRequestedMutation =
      isInitialAgendaMutationRequest(params.clientText) ||
      RESCHEDULE_RE.test(params.clientText) ||
      detectAgendaCancelIntent(params.clientText);
    const modelClaimedMutation = AGENDA_SUCCESS_CLAIM_RE.test(cleanText);
    if (
      parsed.directives.length > 0 ||
      parsed.invalid ||
      (params.agendaPlan?.action ?? "none") !== "none" ||
      clientRequestedMutation ||
      modelClaimedMutation
    ) {
      console.info("[agent-agenda-turn]", {
        tenant_id: params.tenantId,
        agent_id: params.agentId,
        action: "blocked",
        reason: "automation_disabled",
      });
      return finalize({ text: AGENDA_AUTOMATION_DISABLED_REPLY, action: "blocked", deferHandoff: true });
    }
    return finalize({ text: cleanText, action: "none" });
  }

  if (params.agendaPlan && params.agentId) {
    const structured = await resolveStructuredAgendaPlan({
      sb: params.sb ?? createSupabaseServiceClient(),
      tenantId: params.tenantId,
      remoteJid: params.remoteJid,
      leadId: params.leadId,
      agentId: params.agentId,
      contactName: params.contactName,
      timezone: params.timezone,
      clientText: params.clientText,
      modelText: cleanText,
      plan: params.agendaPlan,
      agendaLembretes: params.agendaLembretes,
      agendaDisponibilidade: params.agendaDisponibilidade,
      slotIndex: params.slotIndex,
      operationKey: params.operationKey,
      jobId: params.jobId,
      claimedGeneration: params.claimedGeneration,
      journeyId: params.journeyId,
    });
    if (structured) return finalize(structured);
  }

  const parsed = parseAgendaDirectives(params.modelText);
  if (parsed.invalid || parsed.directives.length > 1) {
    return finalize({ text: AGENDA_FAILURE_REPLY, action: "failed", deferHandoff: true });
  }

  const directive = parsed.directives.length === 1 ? parsed.directives[0]! : null;
  const proposalText = params.priorAssistantText?.trim() ?? "";
  const recentClientMessages = (params.recentClientMessages ?? [])
    .map((text) => text.trim())
    .filter(Boolean);
  const assistantForConfirm = assistantTextForSchedulingConfirmation(
    cleanText,
    params.priorAssistantText,
  );
  const confirmed = clientConfirmedAgendaMutation(params.clientText, assistantForConfirm);

  // Continuação cross-job: o pedido inicial pode ter vindo vários segundos
  // antes da data, da hora ou do "confirmado". Só reativa esse contexto quando
  // o turno atual traz um sinal concreto de continuação, evitando contaminar
  // conversa comum com um assunto antigo de agenda.
  const currentContinuesAgenda =
    confirmed ||
    textHasExplicitDateAnchor(params.clientText, params.timezone) ||
    textHasExplicitTime(params.clientText) ||
    RESCHEDULE_RE.test(params.clientText) ||
    detectAgendaCancelIntent(params.clientText);
  let recentScheduleRequest = false;
  let recentCancelRequest = false;
  if (currentContinuesAgenda) {
    for (let i = recentClientMessages.length - 1; i >= 0; i--) {
      const text = recentClientMessages[i]!;
      if (detectAgendaCancelIntent(text)) {
        recentCancelRequest = true;
        break;
      }
      if (RESCHEDULE_RE.test(text) || isInitialAgendaMutationRequest(text)) {
        recentScheduleRequest = true;
        break;
      }
    }
  }

  const cancelFromDirective = directive?.type === "cancel";
  const scheduleFromDirective = directive?.type === "schedule";
  const cancelFromContext =
    detectAgendaCancelIntent(params.clientText) ||
    assistantProposedCancelConfirmation(assistantForConfirm) ||
    assistantProposedCancelConfirmation(proposalText) ||
    recentCancelRequest;
  const scheduleFromContext =
    isInitialAgendaMutationRequest(params.clientText) ||
    RESCHEDULE_RE.test(params.clientText) ||
    assistantProposedScheduleConfirmation(assistantForConfirm, params.timezone) ||
    assistantProposedScheduleConfirmation(proposalText, params.timezone) ||
    recentScheduleRequest;
  const confirmedFromPriorProposal =
    confirmed &&
    !directive &&
    assistantProposedAgendaMutationConfirmation(proposalText, params.timezone);
  const confirmedFromRecentContext =
    confirmed && !directive && (recentScheduleRequest || recentCancelRequest);

  const hasMutationIntent =
    cancelFromDirective ||
    scheduleFromDirective ||
    cancelFromContext ||
    scheduleFromContext ||
    confirmedFromPriorProposal ||
    confirmedFromRecentContext;

  if (!hasMutationIntent) {
    // Anti-alucinação: o modelo afirma que agendou/remarcou/cancelou, mas nenhuma
    // diretiva foi executada neste turno. Se o contato não tem NENHUM evento ativo
    // que justifique a afirmação, trocamos a resposta por um pedido honesto de
    // data/horário em vez de entregar uma confirmação falsa ao lead.
    if (AGENDA_SUCCESS_CLAIM_RE.test(cleanText)) {
      try {
        const sb = params.sb ?? createSupabaseServiceClient();
        const active = await findNextActiveAgendaEvent({
          sb,
          tenantId: params.tenantId,
          remoteJid: params.remoteJid,
        });
        if (!active) {
          console.warn("[agent-agenda-turn]", {
            tenant_id: params.tenantId,
            agent_id: params.agentId,
            action: "unverified_claim_blocked",
          });
          return finalize({ text: AGENDA_UNVERIFIED_CLAIM_REPLY, action: "none", deferHandoff: true });
        }
      } catch {
        // Fail-closed: se não conseguimos verificar o banco, NUNCA preservamos
        // uma afirmação de sucesso não verificada.
        console.warn("[agent-agenda-turn]", {
          tenant_id: params.tenantId,
          agent_id: params.agentId,
          action: "unverified_claim_blocked",
          reason: "verification_unavailable",
        });
        return finalize({ text: AGENDA_UNVERIFIED_CLAIM_REPLY, action: "none", deferHandoff: true });
      }
    }
    return finalize({ text: cleanText, action: "none" });
  }

  if (!confirmed) {
    if (scheduleFromDirective || cancelFromDirective) {
      // Truth-gate: sem confirmação não há mutação; a resposta enviada precisa
      // ser uma PERGUNTA. Se o modelo já afirmou sucesso ("está agendado"),
      // substituímos pela pergunta de confirmação com os dados reais da diretiva.
      const safeText = AGENDA_SUCCESS_CLAIM_RE.test(cleanText)
        ? buildAgendaConfirmationQuestion(directive)
        : cleanText;
      if (safeText !== cleanText) {
        console.warn("[agent-agenda-turn]", {
          tenant_id: params.tenantId,
          agent_id: params.agentId,
          action: "claim_replaced_needs_confirmation",
        });
      }
      return finalize({
        text: safeText,
        action: "needs_confirmation",
        deferHandoff: true,
      });
    }
    const clientEngagedAgendaThisTurn =
      isInitialAgendaMutationRequest(params.clientText) ||
      RESCHEDULE_RE.test(params.clientText) ||
      detectAgendaCancelIntent(params.clientText) ||
      currentContinuesAgenda;

    // O lead forneceu/alterou data ou hora dentro de uma conversa de agenda.
    // Materialize uma proposta concreta e estável no outbound; o próximo
    // "sim" não dependerá de o modelo repetir um marcador interno.
    if (scheduleFromContext && !cancelFromContext) {
      const hasDate = textHasExplicitDateAnchor(params.clientText, params.timezone);
      const hasTime = textHasExplicitTime(params.clientText);
      if (hasDate && !hasTime) {
        return finalize({
          text: AGENDA_DATETIME_NEEDED_REPLY,
          action: "failed",
          deferHandoff: true,
        });
      }
      if (hasTime) {
        const resolved = resolveScheduleDateTimeFromText({
          clientText: params.clientText,
          assistantText: proposalText || assistantForConfirm,
          timezone: params.timezone,
          recentClientMessages,
        });
        if (resolved) {
          const contextualDirective: AgendaDirective = {
            type: "schedule",
            date: resolved.date,
            time: resolved.time,
            location:
              extractLocationFromText(cleanText) ??
              extractLocationFromText(proposalText) ??
              extractLocationFromText(params.clientText),
          };
          const modelAlreadyAskedConcreteConfirmation =
            !AGENDA_SUCCESS_CLAIM_RE.test(cleanText) &&
            assistantProposedScheduleConfirmation(cleanText, params.timezone);
          return finalize({
            text: modelAlreadyAskedConcreteConfirmation
              ? cleanText
              : buildAgendaConfirmationQuestion(contextualDirective),
            action: "needs_confirmation",
            deferHandoff: true,
          });
        }
      }
    }
    const safeText = AGENDA_SUCCESS_CLAIM_RE.test(cleanText)
      ? buildAgendaConfirmationQuestion(null)
      : cleanText;
    if (safeText !== cleanText) {
      console.warn("[agent-agenda-turn]", {
        tenant_id: params.tenantId,
        agent_id: params.agentId,
        action: "claim_replaced_unconfirmed_context",
      });
    }
    return finalize({
      text: safeText,
      action: safeText === cleanText ? "none" : "needs_confirmation",
      deferHandoff: clientEngagedAgendaThisTurn || safeText !== cleanText || undefined,
    });
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
      recentClientMessages,
    });
  } else {
    const resolved = resolveScheduleDateTimeFromText({
      clientText: params.clientText,
      assistantText: proposalText || assistantForConfirm,
      timezone: params.timezone,
      recentClientMessages,
    });
    if (!resolved) {
      // Data/hora incompletas (ex.: "pode ser hoje as") — pedir o que falta em
      // vez de falhar genericamente ou inventar um horário.
      return finalize({
        text: AGENDA_DATETIME_NEEDED_REPLY,
        action: "failed",
        deferHandoff: true,
      });
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
      operationKey: params.operationKey,
      jobId: params.jobId ?? null,
      claimedGeneration: params.claimedGeneration ?? null,
      journeyId: params.journeyId ?? null,
    });
    console.info("[agent-agenda-turn]", {
      tenant_id: params.tenantId,
      agent_id: params.agentId,
      action: result.action,
      event_id: result.eventId,
      fallback: !directive,
    });
    return finalize({ text: cleanText, action: result.action, eventId: result.eventId });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // Recusa atômica de staleness: a geração foi superada por mensagem mais nova.
    // Zero mutação aconteceu; o worker não deve enviar nada — o job re-agendado
    // (geração nova) processa o contexto atual. NÃO é uma falha de agenda.
    if (reason === AGENDA_GENERATION_STALE || reason === "invalid_job_params") {
      console.info("[agent-agenda-turn]", {
        tenant_id: params.tenantId,
        agent_id: params.agentId,
        action: "stale",
        reason,
      });
      return { text: cleanText, action: "stale" };
    }
    console.warn("[agent-agenda-turn]", {
      tenant_id: params.tenantId,
      agent_id: params.agentId,
      action: "failed",
      reason,
      directive_type: finalDirective.type,
      directive_date: finalDirective.type === "schedule" ? finalDirective.date : null,
      directive_time: finalDirective.type === "schedule" ? finalDirective.time : null,
    });
    const specific = agendaFailureReplyForError(error, params.agendaDisponibilidade);
    return finalize({ text: specific ?? AGENDA_FAILURE_REPLY, action: "failed", deferHandoff: true });
  }
}
