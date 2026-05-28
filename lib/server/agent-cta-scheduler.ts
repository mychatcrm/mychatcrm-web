import "server-only";

import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { insertAgendaEvent } from "@/lib/server/google-calendar-db";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

const SCHEDULE_CTA_VALUE = "Agendar no Google Agenda";
const CONFIRMATION_RE =
  /\b(sim|t[aá]\s*bom|t[aá]|pode|claro|com\s*certeza|[oó]timo|certo|isso|exato|confirm|confirmo|confirmada|confirmado|fechou|fechado|combinado|perfeito|ok|pode\s*ser|marcar|marcado)\b/i;
const SCHEDULING_RE = /\b(agend|reuni[aã]o|visita|hor[aá]rio|amanh[ãa]|hoje|segunda|ter[cç]a|quarta|quinta|sexta|s[áa]bado|domingo|\d{1,2}[:h]\d{2}|\d{1,2}\/\d{1,2})\b/i;

export function isSchedulingCta(ctaFinal: unknown): boolean {
  return typeof ctaFinal === "string" && ctaFinal.trim() === SCHEDULE_CTA_VALUE;
}

export function detectSchedulingConfirmation(userText: string, assistantText?: string): boolean {
  const text = userText.trim().toLowerCase();
  if (!text) return false;
  if (!CONFIRMATION_RE.test(text)) return false;
  // Scheduling context can come from the lead's message OR from the agent's previous message
  // (the agent typically summarises date/time/location in the confirmation prompt).
  return SCHEDULING_RE.test(text) || (!!assistantText && SCHEDULING_RE.test(assistantText.toLowerCase()));
}

function extractPhone(remoteJid: string): string | null {
  const digits = remoteJid.split("@")[0]?.replace(/\D/g, "") ?? "";
  return digits.length >= 8 ? digits : null;
}

function parseDateTimeFromText(text: string, now = new Date()): Date | null {
  const normalized = text.toLowerCase();
  const fullDate = normalized.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s*(?:às|as|a)?\s*(\d{1,2})[:h](\d{2}))?/i);
  if (fullDate) {
    const day = Number(fullDate[1]);
    const month = Number(fullDate[2]) - 1;
    const year = fullDate[3] ? Number(fullDate[3].length === 2 ? `20${fullDate[3]}` : fullDate[3]) : now.getFullYear();
    const hour = fullDate[4] ? Number(fullDate[4]) : 9;
    const minute = fullDate[5] ? Number(fullDate[5]) : 0;
    const dt = new Date(year, month, day, hour, minute, 0, 0);
    if (!Number.isNaN(dt.getTime())) return dt;
  }

  const hourOnly = normalized.match(/\b(\d{1,2})[:h](\d{2})\b/);
  if (hourOnly) {
    const base = new Date(now);
    if (/\bamanh[ãa]\b/.test(normalized)) base.setDate(base.getDate() + 1);
    const dt = new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate(),
      Number(hourOnly[1]),
      Number(hourOnly[2]),
      0,
      0,
    );
    if (!Number.isNaN(dt.getTime())) return dt;
  }

  return null;
}

async function findRecentExistingAgendaEvent(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  attendeePhone: string | null;
}): Promise<string | null> {
  if (!params.attendeePhone) return null;
  const sinceIso = new Date(Date.now() - 10 * 60_000).toISOString();
  const res = (await params.sb
    .from("agenda_events")
    .select("id")
    .eq("tenant_id", params.tenantId)
    .eq("created_by", "agent")
    .eq("attendee_phone", params.attendeePhone)
    .gte("created_at", sinceIso)
    .ilike("title", "Agendamento via WhatsApp%")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()) as PostgrestSingleResponse<{ id: string }>;
  if (res.error) return null;
  return res.data?.id ?? null;
}

export async function createAgendaEventForSchedulingCta(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  contactName: string | null;
  userMessage: string;
  assistantMessage: string;
}): Promise<{ created: boolean; eventId: string | null }> {
  const attendeePhone = extractPhone(params.remoteJid);
  const existingId = await findRecentExistingAgendaEvent({
    sb: params.sb,
    tenantId: params.tenantId,
    attendeePhone,
  });
  if (existingId) return { created: false, eventId: existingId };

  const startDate = parseDateTimeFromText(params.userMessage) ?? new Date(Date.now() + 60 * 60_000);
  const endDate = new Date(startDate.getTime() + 60 * 60_000);
  const name = params.contactName?.trim() || attendeePhone || "Lead";
  const title = `Agendamento via WhatsApp - ${name}`;
  const description = [
    "Compromisso criado automaticamente pelo CTA de agendamento do agente.",
    "",
    `Mensagem do lead: ${params.userMessage.trim() || "-"}`,
    `Resposta do agente: ${params.assistantMessage.trim() || "-"}`,
  ].join("\n");

  const inserted = await insertAgendaEvent({
    tenant_id: params.tenantId,
    google_event_id: null,
    title,
    description,
    location: null,
    color: "#f24400",
    start_at: startDate.toISOString(),
    end_at: endDate.toISOString(),
    all_day: false,
    attendee_name: params.contactName?.trim() || null,
    attendee_phone: attendeePhone,
    attendee_email: null,
    status: "pending",
    created_by: "agent",
  });

  return { created: true, eventId: inserted.id };
}
