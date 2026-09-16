import "server-only";

import { parseTimezone } from "@/lib/agents/agent-datetime";
import { resolveDateAnchorFromText } from "@/lib/server/agenda-datetime-parse";
import { normalizeCanonicalWhatsAppPhone } from "@/lib/integrations/whatsapp-contact-identity";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

const WEEKDAY_NAMES_PT = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"] as const;
const WEEKDAY_NAMES_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/**
 * Dia da semana REAL da data que o cliente acabou de pedir, calculado pelo
 * backend e entregue ao modelo como fato fechado.
 *
 * Existe por causa de um incidente real: o cliente pedia "dia 30", o modelo
 * não tinha esse dia nos CALENDAR FACTS, calculava de cabeça, errava, e
 * recusava a data com "não atendemos aos sábados" — sendo que 30/09/2026 é
 * quarta-feira. O parser determinístico já resolvia a data corretamente; o
 * modelo é que não recebia a resposta. Agora recebe, e não tem o que calcular.
 *
 * Só afirma calendário civil — nunca disponibilidade, política ou decisão de
 * agendar. A janela configurada continua sendo dita pelo bloco da AGENDA.
 */
export function buildRequestedDateFactBlock(params: {
  clientText: string | null | undefined;
  timezone: string;
  now?: Date;
}): string | null {
  const text = typeof params.clientText === "string" ? params.clientText.trim() : "";
  if (!text) return null;
  const timezone = parseTimezone(params.timezone);
  const anchor = resolveDateAnchorFromText(text, timezone, params.now);
  if (!anchor) return null;
  const [day, month, year] = anchor.split("/").map(Number);
  if (!day || !month || !year) return null;
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return `REQUESTED DATE FACT (deterministic, computed by the backend from the customer's latest message — it is not a booking and not an availability statement)
- Date requested: ${anchor} (${timezone}).
- That date falls on weekday ${weekday} (0=Sunday..6=Saturday): ${WEEKDAY_NAMES_EN[weekday]} / ${WEEKDAY_NAMES_PT[weekday]}.
- This is ground truth. Never state, imply or reason from a different weekday for this date, and never compute the weekday yourself.
- If this date cannot be served, justify it with the configured availability window or a real conflict — never with an invented weekday.`;
}

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
