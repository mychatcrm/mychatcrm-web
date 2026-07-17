import "server-only";

import { parseTimezone } from "@/lib/agents/agent-datetime";
import { normalizeCanonicalWhatsAppPhone } from "@/lib/integrations/whatsapp-contact-identity";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

const EVENT_SELECT = "id, title, start_at, end_at, status, location";
const DEFAULT_EVENT_LIMIT = 3;

export type AgentAgendaContextEvent = {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  status: string;
  location: string | null;
};

export function normalizeAgendaAttendeePhone(value: string | null | undefined): string | null {
  return normalizeCanonicalWhatsAppPhone(value);
}

function formatEvent(event: AgentAgendaContextEvent, timezone: string): string {
  const when = new Intl.DateTimeFormat("pt-BR", {
    timeZone: parseTimezone(timezone),
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(event.start_at));
  const location = event.location?.trim() ? ` | local: ${event.location.trim()}` : "";
  return `- event_id: ${event.id} | ${when} | ${event.title} | status: ${event.status}${location}`;
}

export function formatAgentAgendaContextBlock(params: {
  futureEvents: AgentAgendaContextEvent[];
  pastEvents: AgentAgendaContextEvent[];
  timezone: string;
}): string | null {
  if (!params.futureEvents.length && !params.pastEvents.length) return null;

  const parts = [
    "[CONTEXTO DE AGENDA DO CONTATO]",
    "Use estes dados para responder com continuidade. Não invente compromissos ou detalhes ausentes.",
  ];
  if (params.futureEvents.length) {
    parts.push("Próximos agendamentos ativos:", ...params.futureEvents.map((event) => formatEvent(event, params.timezone)));
  } else {
    parts.push("Próximos agendamentos ativos: nenhum.");
  }
  if (params.pastEvents.length) {
    parts.push("Agendamentos anteriores:", ...params.pastEvents.map((event) => formatEvent(event, params.timezone)));
  }
  parts.push("[/CONTEXTO DE AGENDA DO CONTATO]");
  return parts.join("\n");
}

export async function buildAgentAgendaContextBlock(params: {
  tenantId: string;
  remoteJid?: string | null;
  attendeePhone?: string | null;
  timezone: string;
  now?: Date;
  sb?: SupabaseServiceClient;
}): Promise<string | null> {
  const attendeePhone = normalizeAgendaAttendeePhone(params.attendeePhone ?? params.remoteJid);
  if (!attendeePhone) return null;

  const sb = params.sb ?? createSupabaseServiceClient();
  const nowIso = (params.now ?? new Date()).toISOString();
  const baseQuery = () =>
    sb
      .from("agenda_events")
      .select(EVENT_SELECT)
      .eq("tenant_id", params.tenantId)
      .eq("attendee_phone", attendeePhone)
      .neq("status", "cancelled");

  const [futureResult, pastResult] = await Promise.all([
    baseQuery().gte("start_at", nowIso).order("start_at", { ascending: true }).limit(DEFAULT_EVENT_LIMIT),
    baseQuery().lt("start_at", nowIso).order("start_at", { ascending: false }).limit(DEFAULT_EVENT_LIMIT),
  ]);

  if (futureResult.error || pastResult.error) {
    console.warn("[agent-agenda-context] lookup_failed", {
      tenant_id: params.tenantId,
      phone_last4: attendeePhone.slice(-4),
      future_error: futureResult.error?.message ?? null,
      past_error: pastResult.error?.message ?? null,
    });
  }

  return formatAgentAgendaContextBlock({
    futureEvents: (futureResult.data ?? []) as AgentAgendaContextEvent[],
    pastEvents: (pastResult.data ?? []) as AgentAgendaContextEvent[],
    timezone: params.timezone,
  });
}
