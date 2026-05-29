import "server-only";

import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { parseAppointmentDateTime } from "@/lib/server/agenda-datetime-parse";
import { insertAgendaEvent, updateAgendaEvent } from "@/lib/server/google-calendar-db";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

const SCHEDULE_CTA_VALUE = "Agendar no Google Agenda";
const SCHEDULING_DEDUPE_WINDOW_MS = 30 * 24 * 60 * 60_000;
const CONFIRMATION_RE =
  /\b(sim|t[aá]\s*bom|t[aá]|pode|claro|com\s*certeza|[oó]timo|certo|isso|exato|confirm|confirmo|confirmada|confirmado|fechou|fechado|combinado|perfeito|ok|pode\s*ser|marcar|marcado)\b/i;
const RESCHEDULE_RE =
  /\b(remarcar|reagendar|trocar\s+(o\s+)?hor[aá]rio|mudar\s+(a\s+)?data|outro\s+hor[aá]rio|alterar\s+agendamento)\b/i;
const SCHEDULING_RE = /\b(agend|reuni[aã]o|visita|hor[aá]rio|amanh[ãa]|hoje|segunda|ter[cç]a|quarta|quinta|sexta|s[áa]bado|domingo|\d{1,2}[:h]\d{2}|\d{1,2}\/\d{1,2})\b/i;

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
