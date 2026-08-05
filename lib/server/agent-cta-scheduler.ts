import "server-only";

import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import { detectSupportedLanguageCode, type SupportedLanguageCode } from "@/lib/ai/language-detect";
import {
  formatScheduleFieldsFromDate,
  localWallClockToUtc,
  parseAppointmentDateTime,
  resolveDateAnchorFromText,
  resolveScheduleDateTimeFromText,
  resolveTimeSignalFromText,
  textHasExplicitDateAnchor,
  textHasExplicitTime,
  textHasImmediateNowExpression,
  textHasInvalidExplicitTime,
} from "@/lib/server/agenda-datetime-parse";
import { parseTimezone } from "@/lib/agents/agent-datetime";
import { normalizeCanonicalWhatsAppPhone } from "@/lib/integrations/whatsapp-contact-identity";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { applyAgendaCrmMove } from "@/lib/server/agenda-crm-move";
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
import {
  normalizeAgentAgendaDate,
  normalizeAgentAgendaTime,
  type AgentAgendaPlan,
  type AgentAgendaPlanAction,
} from "@/lib/ai/agent-turn-plan";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

const SCHEDULE_CTA_VALUE = "Agendar no Google Agenda";
const SCHEDULING_DEDUPE_WINDOW_MS = 30 * 24 * 60 * 60_000;
const CONFIRMATION_RE =
  /\b(sim|t[aá]\s*bom|t[aá]|pode|claro|com\s*certeza|[oó]timo|certo|isso|exato|confirm|confirmo|confirmada|confirmado|fechou|fechado|combinado|perfeito|ok|pode\s*ser|fica(?:\s+(?:sim|bom))?)\b/i;
/** Novo pedido de mutação na mesma mensagem — não conta como confirmação isolada. */
const AGENDA_MUTATION_IN_MESSAGE_RE =
  /\b(?:quero|preciso|gostaria|desejo|vou)(?:\s+de)?\s+(?:cancelar|remarcar|reagendar|agendar|marcar|desmarcar)\b|\b(?:remarcar|reagendar|agendar|marcar)\s+(?:para|em|no|na)\b|\b\d{1,2}\s*[/-]\s*\d{1,2}\b|\bdaqui\s+(?:a\s+)?\d+\s+dias?\b|\bsemana\s+que\s+vem\b|\bproxim[ao]\s+\w{3,}/i;
const CANCEL_INTENT_RE =
  /\b(cancelar|cancelamento|desmarcar|desmarcação|desmarcacao)\b/i;
const AGENDA_REJECTION_RE =
  /^\s*(?:n[aã]o|nao|melhor\s+n[aã]o|deixa|deixe|desist[io]|quero\s+manter|pode\s+manter|mant[eé]m)(?:\b|[.!?])/i;
const RESCHEDULE_RE =
  /\b(remarcar|reagendar|trocar\s+(o\s+)?hor[aá]rio|mudar\s+(a\s+)?data|outro\s+hor[aá]rio|alterar\s+agendamento)\b/i;
const SCHEDULING_RE =
  /\b(agendamento|agend|cancelamento|cancelar|remarcar|reagendar|reuni[aã]o|visita|hor[aá]rio|amanh[ãa]|hoje|segunda|ter[cç]a|quarta|quinta|sexta|s[áa]bado|domingo|\d{1,2}[:h]\d{2}|\d{1,2}\/\d{1,2})\b/i;
const AGENDA_READ_INTENT_RE =
  /\b(?:meus?|minhas?|meu|minha)\s+(?:pr[oó]ximos?\s+)?(?:agendamentos?|compromissos?|hor[aá]rios?|reuni[oõ]es?|visitas?|citas?|appointments?|meetings?)\b|\b(?:agendamentos?|compromissos?|hor[aá]rios?|reuni[oõ]es?|visitas?|citas?|appointments?|meetings?)\b[^.!?\n]{0,24}\b(?:meus?|minhas?|meu|minha)\b|\b(?:consultar|consult|ver|veja|olhar|olha|mostrar|mostre|listar|liste|check|show|list|revisar)\b[^.!?\n]{0,50}\b(?:agenda|agendamentos?|compromissos?|citas?|appointments?|meetings?)\b|\b(?:quando|what\s+time|when|cu[aá]ndo)\b[^.!?\n]{0,50}\b(?:agendamento|appointment|cita|reuni[aã]o|meeting|hor[aá]rio)\b/i;
const AGENDA_DIRECTIVE_RE = /\[\[\s*(AGENDAR|CANCELAR_AGENDA)\s*(?::\s*([^\]]*))?\]\]/gi;
const CONTEXT_FREE_SHORT_REPLY_RE =
  /^\s*(?:oi+|ol[aá]|oie|oide|hello|hi|hola|ok(?:ay)?|sim|s[ií]|yes|pode(?:\s+ser)?|claro|certo|isso|perfeito|obrigad[oa]?|thanks?|gracias|at[eé]\s+mais|tchau|bye)[\s.!?]*$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const AGENDA_FAILURE_REPLY =
  "Não consegui confirmar essa alteração na agenda agora. Nossa equipe vai conferir e te retornar em breve.";
export const AGENDA_FAILURE_REPLY_NO_HANDOFF =
  "Não consegui confirmar essa alteração na agenda agora. Tente novamente em instantes ou informe outra data e horário.";
export const AGENDA_SUCCESS_REPLY_SCHEDULED = "Pronto, seu agendamento foi confirmado.";
export const AGENDA_SUCCESS_REPLY_RESCHEDULED = "Pronto, seu agendamento foi remarcado.";
export const AGENDA_SUCCESS_REPLY_CANCELLED = "Pronto, cancelei seu agendamento.";
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
  "Não consegui identificar a data e o horário certinhos. Me diga o dia e a hora que você prefere (por exemplo: 20/07 às 14h) que eu verifico para você.";
export const AGENDA_PAST_DATETIME_REPLY =
  "Esse horário já passou. Me diga outro dia e horário que eu verifico para você.";
export const AGENDA_INVALID_TIME_REPLY =
  "Esse horário não existe. Me diga uma hora válida entre 00:00 e 23:59 para eu verificar para você.";

/**
 * Traduções das respostas fixas de agenda.
 *
 * O agente atende em 6 idiomas e a listagem de compromissos já respondia
 * traduzida, mas estas mensagens saíam sempre em pt-BR — um agente configurado
 * em inglês ou espanhol devolvia português no meio da conversa.
 *
 * A chave de cada entrada é o próprio texto pt-BR (as constantes acima), o que
 * permite localizar num único ponto de saída por comparação exata, sem propagar
 * o idioma pelos ~30 pontos que produzem estas respostas. Mesmo espírito de
 * `localizedAgentFailureReply`.
 */
const AGENDA_REPLY_TRANSLATIONS: ReadonlyMap<string, Record<SupportedLanguageCode, string>> =
  new Map([
    [
      AGENDA_FAILURE_REPLY,
      {
        pt: AGENDA_FAILURE_REPLY,
        en: "I couldn't confirm that change to the schedule right now. Our team will check and get back to you shortly.",
        es: "No pude confirmar ese cambio en la agenda ahora. Nuestro equipo lo revisará y te responderá en breve.",
        fr: "Je n'ai pas pu confirmer cette modification de l'agenda pour le moment. Notre équipe va vérifier et vous répondre sous peu.",
        de: "Ich konnte diese Terminänderung gerade nicht bestätigen. Unser Team prüft das und meldet sich in Kürze.",
        it: "Non sono riuscito a confermare questa modifica in agenda ora. Il nostro team verificherà e ti risponderà a breve.",
      },
    ],
    [
      AGENDA_FAILURE_REPLY_NO_HANDOFF,
      {
        pt: AGENDA_FAILURE_REPLY_NO_HANDOFF,
        en: "I couldn't confirm that change to the schedule right now. Please try again shortly or tell me another date and time.",
        es: "No pude confirmar ese cambio en la agenda ahora. Inténtalo de nuevo en unos instantes o dime otra fecha y hora.",
        fr: "Je n'ai pas pu confirmer cette modification de l'agenda pour le moment. Réessayez dans un instant ou indiquez-moi une autre date et heure.",
        de: "Ich konnte diese Terminänderung gerade nicht bestätigen. Bitte versuchen Sie es gleich noch einmal oder nennen Sie mir ein anderes Datum und eine andere Uhrzeit.",
        it: "Non sono riuscito a confermare questa modifica in agenda ora. Riprova tra poco o indicami un'altra data e ora.",
      },
    ],
    [
      AGENDA_SUCCESS_REPLY_SCHEDULED,
      {
        pt: AGENDA_SUCCESS_REPLY_SCHEDULED,
        en: "All set, your appointment is confirmed.",
        es: "Listo, tu cita está confirmada.",
        fr: "C'est fait, votre rendez-vous est confirmé.",
        de: "Fertig, Ihr Termin ist bestätigt.",
        it: "Fatto, il tuo appuntamento è confermato.",
      },
    ],
    [
      AGENDA_SUCCESS_REPLY_RESCHEDULED,
      {
        pt: AGENDA_SUCCESS_REPLY_RESCHEDULED,
        en: "All set, your appointment has been rescheduled.",
        es: "Listo, tu cita fue reprogramada.",
        fr: "C'est fait, votre rendez-vous a été reporté.",
        de: "Fertig, Ihr Termin wurde verschoben.",
        it: "Fatto, il tuo appuntamento è stato riprogrammato.",
      },
    ],
    [
      AGENDA_SUCCESS_REPLY_CANCELLED,
      {
        pt: AGENDA_SUCCESS_REPLY_CANCELLED,
        en: "Done, I've cancelled your appointment.",
        es: "Listo, cancelé tu cita.",
        fr: "C'est fait, j'ai annulé votre rendez-vous.",
        de: "Erledigt, ich habe Ihren Termin storniert.",
        it: "Fatto, ho cancellato il tuo appuntamento.",
      },
    ],
    [
      AGENDA_AUTOMATION_DISABLED_REPLY,
      {
        pt: AGENDA_AUTOMATION_DISABLED_REPLY,
        en: "I can look up your existing appointments, but I can't create, reschedule or cancel appointments here at the moment.",
        es: "Puedo consultar tus citas existentes, pero no puedo crear, reprogramar ni cancelar citas por aquí en este momento.",
        fr: "Je peux consulter vos rendez-vous existants, mais je ne peux pas créer, reporter ou annuler de rendez-vous ici pour le moment.",
        de: "Ich kann Ihre bestehenden Termine einsehen, aber im Moment hier keine Termine anlegen, verschieben oder stornieren.",
        it: "Posso consultare i tuoi appuntamenti esistenti, ma al momento non posso crearne, riprogrammarne o cancellarne da qui.",
      },
    ],
    [
      AGENDA_SLOT_TAKEN_REPLY,
      {
        pt: AGENDA_SLOT_TAKEN_REPLY,
        en: "That time just became unavailable on our schedule. Could you suggest another date or time? I'll check availability and confirm right away.",
        es: "Ese horario acaba de quedar no disponible en nuestra agenda. ¿Puedes indicarme otra fecha u hora? Verifico la disponibilidad y te confirmo enseguida.",
        fr: "Ce créneau vient de devenir indisponible dans notre agenda. Pouvez-vous m'indiquer une autre date ou heure ? Je vérifie la disponibilité et je confirme aussitôt.",
        de: "Dieser Termin ist in unserem Kalender gerade belegt worden. Können Sie mir ein anderes Datum oder eine andere Uhrzeit nennen? Ich prüfe die Verfügbarkeit und bestätige sofort.",
        it: "Quell'orario è appena diventato non disponibile nella nostra agenda. Puoi indicarmi un'altra data o ora? Verifico la disponibilità e confermo subito.",
      },
    ],
    [
      AGENDA_UNVERIFIED_CLAIM_REPLY,
      {
        pt: AGENDA_UNVERIFIED_CLAIM_REPLY,
        en: "One moment — I haven't recorded that change to the schedule yet. Confirm the exact date and time (for example: 20/07 at 14:00) and I'll record it right now.",
        es: "Un momento — todavía no registré ese cambio en la agenda. Confírmame la fecha y la hora exactas (por ejemplo: 20/07 a las 14:00) y lo registro ahora mismo.",
        fr: "Un instant — je n'ai pas encore enregistré cette modification dans l'agenda. Confirmez-moi la date et l'heure exactes (par exemple : 20/07 à 14:00) et je l'enregistre tout de suite.",
        de: "Einen Moment — ich habe diese Änderung noch nicht im Kalender erfasst. Bestätigen Sie mir das genaue Datum und die Uhrzeit (zum Beispiel: 20.07. um 14:00), dann trage ich es sofort ein.",
        it: "Un attimo — non ho ancora registrato questa modifica in agenda. Confermami la data e l'ora esatte (per esempio: 20/07 alle 14:00) e la registro subito.",
      },
    ],
    [
      AGENDA_DATETIME_NEEDED_REPLY,
      {
        pt: AGENDA_DATETIME_NEEDED_REPLY,
        en: "I couldn't work out the exact date and time. Tell me the day and time you prefer (for example: 20/07 at 2pm) and I'll check for you.",
        es: "No pude identificar la fecha y la hora exactas. Dime el día y la hora que prefieres (por ejemplo: 20/07 a las 14h) y lo verifico para ti.",
        fr: "Je n'ai pas réussi à identifier la date et l'heure exactes. Indiquez-moi le jour et l'heure que vous préférez (par exemple : 20/07 à 14h) et je vérifie pour vous.",
        de: "Ich konnte das genaue Datum und die Uhrzeit nicht erkennen. Nennen Sie mir den gewünschten Tag und die Uhrzeit (zum Beispiel: 20.07. um 14 Uhr), dann prüfe ich das für Sie.",
        it: "Non sono riuscito a identificare la data e l'ora esatte. Dimmi il giorno e l'ora che preferisci (per esempio: 20/07 alle 14) e verifico per te.",
      },
    ],
    [
      AGENDA_PAST_DATETIME_REPLY,
      {
        pt: AGENDA_PAST_DATETIME_REPLY,
        en: "That time has already passed. Tell me another day and time and I'll check for you.",
        es: "Ese horario ya pasó. Dime otro día y hora y lo verifico para ti.",
        fr: "Ce créneau est déjà passé. Indiquez-moi un autre jour et une autre heure et je vérifie pour vous.",
        de: "Dieser Zeitpunkt liegt bereits in der Vergangenheit. Nennen Sie mir einen anderen Tag und eine andere Uhrzeit, dann prüfe ich das für Sie.",
        it: "Quell'orario è già passato. Dimmi un altro giorno e orario e verifico per te.",
      },
    ],
    [
      AGENDA_INVALID_TIME_REPLY,
      {
        pt: AGENDA_INVALID_TIME_REPLY,
        en: "That time doesn't exist. Give me a valid time between 00:00 and 23:59 so I can check for you.",
        es: "Ese horario no existe. Dime una hora válida entre 00:00 y 23:59 para verificarlo.",
        fr: "Cette heure n'existe pas. Donnez-moi une heure valide entre 00:00 et 23:59 pour que je vérifie.",
        de: "Diese Uhrzeit gibt es nicht. Nennen Sie mir eine gültige Uhrzeit zwischen 00:00 und 23:59, damit ich prüfen kann.",
        it: "Quell'ora non esiste. Dimmi un orario valido tra le 00:00 e le 23:59 così verifico.",
      },
    ],
  ]);

/**
 * Devolve a versão da resposta fixa no idioma pedido. Texto que não é uma
 * resposta fixa do sistema (prosa do modelo, que já vem no idioma certo) passa
 * intacto.
 */
export function localizeAgendaReply(
  text: string,
  languageCode?: SupportedLanguageCode | null,
): string {
  if (!languageCode || languageCode === "pt") return text;
  return AGENDA_REPLY_TRANSLATIONS.get(text)?.[languageCode] ?? text;
}

function agendaFailureReplyForError(
  error: unknown,
  disp?: AgentAgendaDisponibilidade | null,
): string | null {
  const reason = error instanceof Error ? error.message : "";
  if (reason === "outside_agenda_availability") return buildOutsideAvailabilityReply(disp);
  if (reason === "agenda_slot_taken") return AGENDA_SLOT_TAKEN_REPLY;
  if (reason === "invalid_or_past_agenda_datetime") return AGENDA_PAST_DATETIME_REPLY;
  return null;
}

/**
 * Convite de agenda sem slot concreto (ex.: outreach Meta "Que tal agendarmos?").
 * Continuidade conversacional — NÃO autoriza mutação.
 */
export function isSoftAgendaInvite(text: string | null | undefined, timezone: string): boolean {
  const trimmed = text?.trim() ?? "";
  if (!trimmed) return false;
  if (!textHasSchedulingContext(trimmed) && !AGENDA_TOPIC_RE.test(trimmed)) return false;
  if (textHasExplicitDateAnchor(trimmed, timezone) && textHasExplicitTime(trimmed)) return false;
  return true;
}

/**
 * Confirmação órfã com data+hora explícitas (sem pending). Só este caso deve
 * descartar a resposta do modelo no short-ack — perguntas naturais de dia/hora
 * ("Qual horário…?") precisam passar.
 */
function orphanConcreteScheduleConfirmation(
  assistantText: string,
  timezone = "UTC",
): boolean {
  if (HUMAN_DELEGATION_IN_REPLY_RE.test(assistantText)) return false;
  return (
    CONFIRM_ASK_RE.test(assistantText) &&
    textHasExplicitDateAnchor(assistantText, timezone) &&
    textHasExplicitTime(assistantText)
  );
}

/** Modelo pede dia/hora de forma humana, sem afirmar sucesso nem inventar slot completo. */
function modelAsksNaturallyForMissingSlot(
  cleanText: string,
  timezone = "UTC",
): boolean {
  const trimmed = cleanText.trim();
  if (!trimmed || AGENDA_SUCCESS_CLAIM_RE.test(trimmed)) return false;
  if (orphanConcreteScheduleConfirmation(trimmed, timezone)) return false;
  // Inventar hora concreta enquanto falta a do lead não é "pedir o que falta".
  if (textHasExplicitTime(trimmed)) return false;
  const asks =
    trimmed.includes("?") ||
    /\b(me\s+(?:diga|passa|fala|informa)|qual|quais|que\s+dia|que\s+hor|when|what\s+time)\b/i.test(
      trimmed,
    );
  const aboutSlot =
    AGENDA_TOPIC_RE.test(trimmed) ||
    /\b(dia|data|hora|hor[aá]rio|quando|amanh[ãa]|hoje)\b/i.test(trimmed);
  // "Posso já deixar uma conversa agendada?" é convite, não pergunta — não tem
  // "?" nem "me diga"/"qual", mas também não afirma sucesso nem inventa slot
  // concreto (já filtrado acima). Sem isso, o cliente que nunca falou de
  // agenda (ex.: só perguntou "do que se trata?") recebia a cobrança robótica
  // de "não consegui identificar a data e o horário" para um convite que o
  // próprio modelo fez, sem o cliente ter tentado marcar nada ainda.
  return (asks && aboutSlot) || isSoftAgendaInvite(trimmed, timezone);
}

/** Modelo já oferece outro horário dentro da janela, sem claim de sucesso. */
function modelAsksNaturallyForOutsideWindow(cleanText: string): boolean {
  const trimmed = cleanText.trim();
  if (!trimmed || AGENDA_SUCCESS_CLAIM_RE.test(trimmed)) return false;
  const asks =
    trimmed.includes("?") ||
    /\b(me\s+(?:diga|passa|fala|informa)|outro|outra|qual|quais)\b/i.test(trimmed);
  const aboutSlot =
    AGENDA_TOPIC_RE.test(trimmed) ||
    /\b(dia|data|hora|hor[aá]rio|quando|janela|dispon)/i.test(trimmed);
  return asks && aboutSlot;
}

/**
 * Pergunta de confirmação neutra usada quando a resposta do modelo precisa ser
 * substituída por segurança (claim de sucesso sem mutação). Sem nomenclatura de
 * nicho: a data/hora vem da própria diretiva; o tipo de compromisso fica com o
 * prompt do tenant nas mensagens normais.
 */
function formatAgendaDateForCustomer(date: string): string {
  const normalized = normalizeAgentAgendaDate(date);
  return normalized ?? date;
}

function formatAgendaTimeForCustomer(time: string): string {
  const normalized = normalizeAgentAgendaTime(time) ?? time;
  const match = normalized.match(/^(\d{2}):(\d{2})$/);
  if (!match) return normalized;
  const hour = String(Number(match[1]));
  return match[2] === "00" ? `${hour}h` : `${hour}h${match[2]}`;
}

function buildAgendaConfirmationQuestion(directive: AgendaDirective | null): string {
  if (directive?.type === "schedule") {
    return `Posso confirmar para ${formatAgendaDateForCustomer(directive.date)}, às ${formatAgendaTimeForCustomer(directive.time)}?`;
  }
  if (directive?.type === "cancel") {
    return "Posso cancelar esse horário para você?";
  }
  return "Posso confirmar essa alteração na agenda?";
}

function buildAgendaCancelConfirmationQuestion(
  event: Pick<AgendaEventRow, "start_at" | "location">,
  timezone: string,
): string {
  const when = formatEventDateTimePtBr(event.start_at, timezone);
  const place = event.location?.trim() ? `, em ${event.location.trim()}` : "";
  return `Você quer cancelar seu agendamento de ${when}${place}?`;
}

function buildAgendaCancelDisambiguationQuestion(
  events: Array<Pick<AgendaEventRow, "start_at" | "location">>,
  timezone: string,
): string {
  const options = events
    .slice(0, 3)
    .map((event, index) => {
      const place = event.location?.trim() ? `, em ${event.location.trim()}` : "";
      return `${index + 1}) ${formatEventDateTimePtBr(event.start_at, timezone)}${place}`;
    })
    .join("; ");
  return `Encontrei mais de um agendamento ativo: ${options}. Qual deles você quer cancelar?`;
}

function assistantAskedCancelDisambiguation(text?: string | null): boolean {
  const normalized = text?.trim() ?? "";
  return (
    /encontrei\s+mais\s+de\s+um\s+agendamento\s+ativo/i.test(normalized) &&
    /qual\s+deles\s+voc[eê]\s+quer\s+cancelar/i.test(normalized)
  );
}

const HUMAN_DELEGATION_IN_REPLY_RE =
  /\b(atendente\s+humano|humano\s+vai|entrar\s+em\s+contato|nossa\s+equipe|equipe\s+vai|respons[aá]vel\s+vai|transferir|transfer[eê]ncia)\b/i;
const CONFIRM_ASK_RE =
  /\b(posso confirmar|pode confirmar|confirma|confirmar|confirmando|tudo bem|tudo certo|serve|fica bom|pode ser|posso agendar|vou agendar)\b/i;
const DATE_OR_TIME_IN_TEXT_RE = /\d{1,2}\/\d{1,2}|\d{1,2}[:h]\d{2}|\bàs\s+\d{1,2}/i;
const AGENDA_TOPIC_RE =
  /\b(agendamento|agendar|agendad[ao]s?|remarc|reagend|hor[aá]rio|compromisso|marcar|cancel)/i;

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
  if (/^\s*(sim|ok|confirmo)\b/i.test(text) && CONFIRMATION_RE.test(text)) {
    return false;
  }
  return (
    /\b(quero|preciso|gostaria|desejo|vou)(?:\s+de)?\s+(cancelar|remarcar|reagendar|agendar|marcar|desmarcar)\b/i.test(
      text,
    ) ||
    /\b(cancelar|remarcar|reagendar|desmarcar)\s+(meu|minha|o|a)?\s*agendamento/i.test(text) ||
    /\b(?:pode|podem)\s+(?:me\s+)?(?:cancelar|remarcar|reagendar|agendar|marcar|desmarcar)\b/i.test(text) ||
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
  "fica",
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
  languageCode?: SupportedLanguageCode | null,
): ResolveAgendaTurnResult {
  // Localiza no último ponto antes de sair: qualquer resposta fixa do sistema
  // produzida acima (em pt-BR) vira o texto do idioma da conversa.
  const localized = (r: ResolveAgendaTurnResult): ResolveAgendaTurnResult => {
    const text = localizeAgendaReply(r.text, languageCode);
    return text === r.text ? r : { ...r, text };
  };
  if (ctaHandoffAtivo !== false) return localized(result);
  // O texto de sucesso já foi produzido pelo backend somente depois do commit
  // real e contém data/hora em formato humano. Substituí-lo por uma constante
  // curta ("Agendamento confirmado.") apagava contexto e voltava a soar robótico.
  if (
    result.action === "scheduled" ||
    result.action === "rescheduled" ||
    result.action === "cancelled"
  ) {
    const sanitized = sanitizeAgendaReplyForNoHandoff(result.text)
      .replace(/às\s+(\d{1,2}):00\b/gi, (_match, hour: string) => `às ${Number(hour)}h`)
      .replace(/às\s+(\d{1,2}):(\d{2})\b/gi, (_match, hour: string, minute: string) =>
        `às ${Number(hour)}h${minute}`,
      );
    if (result.action === "cancelled") {
      return localized({ ...result, text: AGENDA_SUCCESS_REPLY_CANCELLED });
    }
    if (/\b\d{2}\/\d{2}\/\d{4}\b/.test(sanitized)) {
      return localized({ ...result, text: sanitized });
    }
    return localized({
      ...result,
      text:
        result.action === "rescheduled"
          ? AGENDA_SUCCESS_REPLY_RESCHEDULED
          : AGENDA_SUCCESS_REPLY_SCHEDULED,
    });
  }
  if (result.action === "failed") {
    // Só o texto genérico (que cita "nossa equipe") é trocado; mensagens específicas
    // por motivo (fora da janela, horário ocupado) já são neutras e ficam intactas.
    if (result.text === AGENDA_FAILURE_REPLY) {
      return localized({ ...result, text: AGENDA_FAILURE_REPLY_NO_HANDOFF });
    }
    return localized(result);
  }
  return localized({ ...result, text: sanitizeAgendaReplyForNoHandoff(result.text) });
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
    // Uma resposta posterior encerra a proposta anterior. Continuar buscando
    // para trás fazia "Ok"/"Até mais" reutilizar um agendamento já executado.
    return null;
  }
  return null;
}

function extractPhone(remoteJid: string): string | null {
  return normalizeCanonicalWhatsAppPhone(remoteJid);
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
  const normalizedDate = normalizeAgentAgendaDate(directive.date);
  const normalizedTime = normalizeAgentAgendaTime(directive.time);
  if (!normalizedDate || !normalizedTime) return new Date(Number.NaN);
  const [day, month, year] = normalizedDate.split("/").map(Number);
  const [hour, minute] = normalizedTime.split(":").map(Number);
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

/**
 * O local não tem parser determinístico como data/hora — o modelo pode
 * inventar um endereço plausível no campo oculto (visto em produção: "Avenida
 * Paulista, 1234" sem nenhuma base real). Só confia no local alegado pelo
 * modelo quando (a) o próprio cliente escreveu esse texto, ou (b) já usamos
 * exatamente esse local antes para este tenant (endereço real e recorrente,
 * não uma alucinação nova a cada turno). Sem correspondência, omite o local
 * em vez de gravar/repetir um endereço não verificado.
 */
async function resolveTrustedAgendaLocation(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  clientText: string;
  modelLocation: string | null | undefined;
}): Promise<string | null> {
  const claimed = params.modelLocation?.trim();
  if (!claimed) return null;
  if (params.clientText.toLowerCase().includes(claimed.toLowerCase())) return claimed;

  const { data, error } = await params.sb
    .from("agenda_events")
    .select("location")
    .eq("tenant_id", params.tenantId)
    .not("location", "is", null)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return null;

  const knownLocations = new Set(
    ((data ?? []) as { location: string | null }[])
      .map((r) => r.location?.trim().toLowerCase())
      .filter((v): v is string => Boolean(v)),
  );
  // Nenhum agendamento anterior com local: nada para validar contra ainda —
  // aceita a primeira ocorrência (não há como fazer melhor sem um endereço
  // configurado explicitamente pelo operador).
  if (knownLocations.size === 0) return claimed;
  return knownLocations.has(claimed.toLowerCase()) ? claimed : null;
}

async function findUpcomingActiveAgendaEvents(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  now?: Date;
  limit?: number;
}): Promise<AgendaEventRow[]> {
  const attendeePhone = extractPhone(params.remoteJid);
  if (!attendeePhone) return [];
  const { data, error } = await params.sb
    .from("agenda_events")
    .select("*")
    .eq("tenant_id", params.tenantId)
    .eq("attendee_phone", attendeePhone)
    .neq("status", "cancelled")
    .gte("start_at", (params.now ?? new Date()).toISOString())
    .order("start_at", { ascending: true })
    .limit(params.limit ?? 4);
  if (error) throw error;
  return (data as AgendaEventRow[] | null) ?? [];
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
  conversationSequence?: number | null;
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

  const guarded = Boolean(
    params.jobId &&
    params.claimedGeneration != null &&
    params.conversationSequence != null &&
    params.conversationSequence > 0,
  );
  const { data, error } = await params.sb.rpc(
    guarded ? "apply_agent_agenda_mutation_guarded" : "apply_agent_agenda_mutation",
    {
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
    ...(guarded ? { p_conversation_sequence: params.conversationSequence } : {}),
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
    // Dentro do guard `changed && !deduplicated` de propósito: o card só se
    // move uma vez por mudança real da agenda. Falha aqui nunca invalida o
    // compromisso, que já foi confirmado ao cliente.
    await applyAgendaCrmMove({
      sb: params.sb,
      tenantId: params.tenantId,
      action: syncedResult.action,
      agentId: params.agentId ?? syncedResult.event.agent_id,
      leadId: params.leadId ?? syncedResult.event.lead_id,
      attendeePhone: syncedResult.event.attendee_phone,
    }).catch(() => undefined);
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
  conversationSequence?: number | null;
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
    await applyAgendaCrmMove({
      sb,
      tenantId: params.tenantId,
      action: "cancelled",
      agentId: params.agentId ?? event.agent_id,
      leadId: params.leadId ?? event.lead_id,
      attendeePhone: event.attendee_phone,
    }).catch(() => undefined);
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
    await applyAgendaCrmMove({
      sb,
      tenantId: params.tenantId,
      action: "scheduled",
      agentId: params.agentId ?? inserted.agent_id,
      leadId: params.leadId ?? inserted.lead_id,
      attendeePhone: inserted.attendee_phone,
    }).catch(() => undefined);
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
  await applyAgendaCrmMove({
    sb,
    tenantId: params.tenantId,
    action: "rescheduled",
    agentId: params.agentId ?? inserted.agent_id,
    leadId: params.leadId ?? inserted.lead_id,
    attendeePhone: inserted.attendee_phone,
  }).catch(() => undefined);
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

type ContactAgendaListRow = {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  status: string;
  location: string | null;
};

export function clientRequestedAgendaList(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (
    detectAgendaCancelIntent(trimmed) ||
    RESCHEDULE_RE.test(trimmed) ||
    isInitialAgendaMutationRequest(trimmed)
  ) return false;
  return AGENDA_READ_INTENT_RE.test(trimmed);
}

function agendaListLocale(text: string): string {
  const language = detectSupportedLanguageCode(text);
  return ({ pt: "pt-BR", en: "en-US", es: "es-ES", fr: "fr-FR", de: "de-DE", it: "it-IT" })[language];
}

function formatContactAgendaListReply(params: {
  events: ContactAgendaListRow[];
  timezone: string;
  clientText: string;
}): string {
  const language = detectSupportedLanguageCode(params.clientText);
  if (params.events.length === 0) {
    return {
      pt: "Não encontrei nenhum agendamento ativo para este número.",
      en: "I couldn't find any active appointments for this number.",
      es: "No encontré ninguna cita activa para este número.",
      fr: "Je n’ai trouvé aucun rendez-vous actif pour ce numéro.",
      de: "Ich habe für diese Nummer keine aktiven Termine gefunden.",
      it: "Non ho trovato appuntamenti attivi per questo numero.",
    }[language];
  }

  const locale = agendaListLocale(params.clientText);
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone: parseTimezone(params.timezone),
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const items = params.events.map((event) => {
    const when = formatter.format(new Date(event.start_at));
    const location = event.location?.trim() ? ` — ${event.location.trim()}` : "";
    return `${when}${location}`;
  });
  const prefix = {
    pt: params.events.length === 1 ? "Encontrei este agendamento para o seu número:" : "Encontrei estes agendamentos para o seu número:",
    en: params.events.length === 1 ? "I found this appointment for your number:" : "I found these appointments for your number:",
    es: params.events.length === 1 ? "Encontré esta cita para tu número:" : "Encontré estas citas para tu número:",
    fr: params.events.length === 1 ? "J’ai trouvé ce rendez-vous pour votre numéro :" : "J’ai trouvé ces rendez-vous pour votre numéro :",
    de: params.events.length === 1 ? "Ich habe diesen Termin für Ihre Nummer gefunden:" : "Ich habe diese Termine für Ihre Nummer gefunden:",
    it: params.events.length === 1 ? "Ho trovato questo appuntamento per il tuo numero:" : "Ho trovato questi appuntamenti per il tuo numero:",
  }[language];
  return `${prefix}\n${items.map((item) => `• ${item}`).join("\n")}`;
}

async function resolveContactAgendaList(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  timezone: string;
  clientText: string;
}): Promise<ResolveAgendaTurnResult> {
  const attendeePhone = extractPhone(params.remoteJid);
  if (!attendeePhone) {
    return {
      action: "failed",
      text: "Não consigo consultar a agenda por este identificador. Faça a solicitação pelo mesmo número usado no agendamento.",
    };
  }
  const { data, error } = await params.sb.rpc("list_contact_agenda", {
    p_tenant_id: params.tenantId,
    p_attendee_phone: attendeePhone,
    p_include_history: false,
    p_limit: 5,
  });
  if (error) {
    console.warn("[agent-agenda-list]", {
      tenant_id: params.tenantId,
      error: error.message,
    });
    return {
      action: "failed",
      text: "Não consegui consultar sua agenda agora. Tente novamente em instantes.",
    };
  }
  const events = Array.isArray(data) ? (data as ContactAgendaListRow[]) : [];
  return {
    action: "listed",
    text: formatContactAgendaListReply({ ...params, events }),
  };
}

export type ResolveAgendaTurnResult = {
  text: string;
  action:
    | "none"
    | "listed"
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
  params: {
    clientText: string;
    assistantText: string;
    timezone: string;
    recentClientMessages?: string[];
    agendaDisponibilidade?: AgentAgendaDisponibilidade | null;
  },
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
    agendaDisponibilidade: params.agendaDisponibilidade,
  });
  if (!resolved) return directive;
  return { ...directive, date: resolved.date, time: resolved.time };
}

type PendingAgendaActionRow = {
  id: string;
  journey_id: string | null;
  action: "create" | "reschedule" | "cancel";
  event_id: string | null;
  proposed_date: string | null;
  proposed_time: string | null;
  proposed_location: string | null;
  timezone: string;
  expires_at: string;
  conversation_sequence: number | null;
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
  journeyId?: string | null;
}): Promise<PendingAgendaActionRow | null> {
  const { data } = await params.sb
    .from("agent_agenda_pending_actions")
    .select("id,journey_id,action,event_id,proposed_date,proposed_time,proposed_location,timezone,expires_at,conversation_sequence")
    .eq("tenant_id", params.tenantId)
    .eq("remote_jid", params.remoteJid)
    .eq("agent_id", params.agentId)
    .eq("state", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as PendingAgendaActionRow;
  if (params.journeyId && row.journey_id && row.journey_id !== params.journeyId) {
    await params.sb
      .from("agent_agenda_pending_actions")
      .update({ state: "superseded", updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("state", "pending");
    return null;
  }
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
  conversationSequence?: number | null;
  timezone: string;
}): Promise<void> {
  const existing = await loadPendingAgendaAction({ ...params, journeyId: params.journeyId });
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
    conversation_sequence: params.conversationSequence ?? null,
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
  const when = `${formatAgendaDateForCustomer(directive.date)}, às ${formatAgendaTimeForCustomer(directive.time)}`;
  return action === "rescheduled"
    ? `Pronto, remarquei para ${when}${location}.`
    : `Pronto, ficou agendado para ${when}${location}.`;
}

function cancelEventBelongsToConversation(
  event: AgendaEventRow | null,
  remoteJid: string,
): event is AgendaEventRow {
  if (!event || event.status === "cancelled") return false;
  const phone = extractPhone(remoteJid);
  if (!phone || event.attendee_phone !== phone) return false;
  return new Date(event.start_at).getTime() > Date.now();
}

async function resolveCancelCandidate(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  timezone: string;
  clientText: string;
  requestedEventId?: string | null;
}): Promise<{ event: AgendaEventRow | null; options: AgendaEventRow[] }> {
  if (params.requestedEventId && UUID_RE.test(params.requestedEventId)) {
    const requested = await getAgendaEventById(params.tenantId, params.requestedEventId);
    return cancelEventBelongsToConversation(requested, params.remoteJid)
      ? { event: requested, options: [requested] }
      : { event: null, options: [] };
  }

  const options = await findUpcomingActiveAgendaEvents({
    sb: params.sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
  });
  if (options.length <= 1) return { event: options[0] ?? null, options };

  const numberedChoice = params.clientText.trim().match(/^(?:op[cç][aã]o\s*)?([1-3])[.!?\s]*$/i);
  if (numberedChoice) {
    const selected = options[Number(numberedChoice[1]) - 1] ?? null;
    if (selected) return { event: selected, options };
  }

  const requestedDateTime = resolveScheduleDateTimeFromText({
    clientText: params.clientText,
    timezone: params.timezone,
  });
  if (requestedDateTime) {
    const match = options.find((event) => {
      const fields = formatScheduleFieldsFromDate(new Date(event.start_at), params.timezone);
      return fields.date === requestedDateTime.date && fields.time === requestedDateTime.time;
    });
    if (match) return { event: match, options };
  }
  return { event: null, options };
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
  conversationSequence?: number | null;
  journeyId?: string | null;
  recentClientMessages?: string[] | null;
  /** Último outbound do agente nesta jornada (soft-invite Meta, etc.). */
  priorAssistantText?: string | null;
}): Promise<ResolveAgendaTurnResult | null> {
  const pending = await loadPendingAgendaAction({
    sb: params.sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    agentId: params.agentId,
    journeyId: params.journeyId,
  });
  if (
    !pending &&
    params.plan.action !== "none" &&
    params.plan.action !== "list" &&
    CONTEXT_FREE_SHORT_REPLY_RE.test(params.clientText)
  ) {
    // Sem proposta pendente, um "sim"/"pode ser" curto NÃO autoriza execução.
    // Se o modelo já propôs data+hora concretas, NÃO early-return: cai no fluxo
    // normal para gravar pending (senão o próximo "Fica sim" herda plano alucinado).
    const modelClean = stripAgendaDirectives(params.modelText).trim();
    const softInvite = isSoftAgendaInvite(params.priorAssistantText, params.timezone);
    const concreteFromModel =
      Boolean(modelClean) &&
      !AGENDA_SUCCESS_CLAIM_RE.test(modelClean) &&
      (orphanConcreteScheduleConfirmation(modelClean, params.timezone) ||
        Boolean(
          resolveScheduleDateTimeFromText({
            clientText: "",
            assistantText: modelClean,
            timezone: params.timezone,
            agendaDisponibilidade: params.agendaDisponibilidade,
          }),
        ));
    if (!concreteFromModel) {
      if (
        modelClean &&
        !AGENDA_SUCCESS_CLAIM_RE.test(modelClean) &&
        !orphanConcreteScheduleConfirmation(modelClean, params.timezone)
      ) {
        return { text: modelClean, action: "none", deferHandoff: true };
      }
      if (softInvite && !AGENDA_SUCCESS_CLAIM_RE.test(modelClean)) {
        const language = detectSupportedLanguageCode(params.clientText);
        return {
          text: modelClean || {
            pt: "Perfeito! Qual dia e horário ficam melhores para você?",
            en: "Perfect! What day and time work best for you?",
            es: "¡Perfecto! ¿Qué día y hora te vienen mejor?",
            fr: "Parfait ! Quel jour et quelle heure vous conviennent le mieux ?",
            de: "Perfekt! Welcher Tag und welche Uhrzeit passen Ihnen am besten?",
            it: "Perfetto! Quale giorno e orario ti vanno meglio?",
          }[language],
          action: "none",
          deferHandoff: true,
        };
      }
      const language = detectSupportedLanguageCode(params.clientText);
      return {
        text: {
          pt: "Certo. Como posso ajudar?",
          en: "All right. How can I help?",
          es: "De acuerdo. ¿Cómo puedo ayudarte?",
          fr: "D’accord. Comment puis-je vous aider ?",
          de: "Alles klar. Wie kann ich helfen?",
          it: "Va bene. Come posso aiutarti?",
        }[language],
        action: "none",
      };
    }
  }
  if (pending?.action === "cancel" && AGENDA_REJECTION_RE.test(params.clientText)) {
    await params.sb
      .from("agent_agenda_pending_actions")
      .update({ state: "rejected", updated_at: new Date().toISOString() })
      .eq("id", pending.id)
      .eq("state", "pending");
    return {
      text: "Tudo bem, mantive seu agendamento como está.",
      action: "none",
      deferHandoff: true,
    };
  }
  const standaloneConfirmation = Boolean(pending && isStandaloneAgendaConfirmation(params.clientText));
  const confirmationOnlyTurn =
    isStandaloneAgendaConfirmation(params.clientText) &&
    !textHasExplicitDateAnchor(params.clientText, params.timezone) &&
    !textHasExplicitTime(params.clientText);
  const shortAckWithoutClientSlot =
    CONTEXT_FREE_SHORT_REPLY_RE.test(params.clientText) &&
    !textHasExplicitDateAnchor(params.clientText, params.timezone) &&
    !textHasExplicitTime(params.clientText);
  const plannedAction = executableAction(params.plan.action);
  const action = standaloneConfirmation ? pending!.action : plannedAction;
  if (!action) return null;
  if (action !== "cancel" && textHasInvalidExplicitTime(params.clientText)) {
    return {
      text: AGENDA_INVALID_TIME_REPLY,
      action: "failed",
      deferHandoff: true,
    };
  }

  const rawEffectivePlan: AgentAgendaPlan = standaloneConfirmation
    ? {
        action: pending!.action,
        date: pending!.proposed_date,
        time: pending!.proposed_time,
        location: pending!.proposed_location,
        eventId: pending!.event_id,
      }
    : params.plan;
  const normalizedEffectivePlan: AgentAgendaPlan = {
    ...rawEffectivePlan,
    date: normalizeAgentAgendaDate(rawEffectivePlan.date),
    time: normalizeAgentAgendaTime(rawEffectivePlan.time),
  };
  // Plano vindo do MODELO com data/hora já no passado é lixo determinístico
  // (alucinações reais de produção: "16/10/2023", "05/10/2023"). Uma PROPOSTA
  // para o passado nunca é legítima — anula na entrada, antes de qualquer
  // decisão. Plano vindo de proposta PENDENTE (standaloneConfirmation) fica
  // intacto: confirmar tarde demais um slot que passou deve continuar
  // recebendo o honesto "Esse horário já passou".
  if (!standaloneConfirmation && normalizedEffectivePlan.date && normalizedEffectivePlan.time) {
    const planStartAt = directiveStartAt(
      {
        type: "schedule",
        date: normalizedEffectivePlan.date,
        time: normalizedEffectivePlan.time,
        location: null,
      },
      params.timezone,
    );
    if (Number.isNaN(planStartAt.getTime()) || planStartAt.getTime() <= Date.now()) {
      normalizedEffectivePlan.date = null;
      normalizedEffectivePlan.time = null;
    }
  }
  // Confirmação / short-ack sem slot no texto do lead: recuperar da proposta
  // (pending já está em rawEffectivePlan) ou da prosa do assistente/modelo —
  // nunca assistantText vazio com fallback de plano alucinado "hoje 14h".
  // Short-ack ("Pode ser") também é confirmation-only: priorizar a prosa do
  // modelo neste turno (slot concreto) sobre o prior (soft-invite sem data).
  const proposalSourceText = shortAckWithoutClientSlot
    ? (params.modelText?.trim() || params.priorAssistantText?.trim() || "")
    : confirmationOnlyTurn
      ? (params.priorAssistantText?.trim() || params.modelText)
      : "";
  const allowPlanFallback =
    !confirmationOnlyTurn &&
    !shortAckWithoutClientSlot &&
    Boolean(normalizedEffectivePlan.date && normalizedEffectivePlan.time);
  const resolvedFromClient = action === "cancel"
    ? null
    : resolveScheduleDateTimeFromText({
        clientText: params.clientText,
        assistantText: proposalSourceText,
        timezone: params.timezone,
        fallbackDate: allowPlanFallback
          ? normalizedEffectivePlan.date ?? undefined
          : standaloneConfirmation
            ? normalizedEffectivePlan.date ?? undefined
            : undefined,
        fallbackTime: allowPlanFallback
          ? normalizedEffectivePlan.time ?? undefined
          : standaloneConfirmation
            ? normalizedEffectivePlan.time ?? undefined
            : undefined,
        recentClientMessages: params.recentClientMessages,
        agendaDisponibilidade: params.agendaDisponibilidade,
      });
  // Texto real do lead e histórico da mesma jornada são soberanos sobre o
  // plano do modelo. Foi aqui que uma alucinação `2023-10-17` venceu o áudio
  // "amanhã às duas" no incidente de produção.
  let effectivePlan: AgentAgendaPlan = resolvedFromClient
    ? { ...normalizedEffectivePlan, date: resolvedFromClient.date, time: resolvedFromClient.time }
    : normalizedEffectivePlan;

  // Âncora parcial do lead sem resolução completa: não herdar date/time inventados
  // pelo modelo (causava "Esse horário já passou" com hoje 14h).
  if (
    action !== "cancel" &&
    !resolvedFromClient &&
    !standaloneConfirmation
  ) {
    const clientDate = textHasExplicitDateAnchor(params.clientText, params.timezone);
    const clientTime = textHasExplicitTime(params.clientText);
    const incompleteScheduleAsk =
      !clientDate &&
      !clientTime &&
      /\b(?:agendar|marcar|remarcar|reagendar|agendamento)\b/i.test(params.clientText);
    if ((clientDate && !clientTime) || (clientTime && !clientDate) || incompleteScheduleAsk) {
      effectivePlan = { ...effectivePlan, date: null, time: null };
    }
  }

  // Cliente sem NENHUM sinal de agenda ("Uai pode ser", "ta ficando doido?"):
  // o único slot legítimo é o que o próprio agente DISSE no texto visível ao
  // lead — nunca o campo oculto do modelo (fonte das alucinações de 2023).
  // Deriva do texto e segue o fluxo normal de proposta (validação de
  // disponibilidade + pending + confirmação em duas fases). Sem slot parseável
  // no texto, permanece !scheduleComplete e o ramo existente pede dia/horário
  // com naturalidade. Nenhuma execução acontece aqui — só a origem do
  // candidato muda para algo que o humano de fato leu.
  if (
    action === "create" &&
    !resolvedFromClient &&
    !standaloneConfirmation &&
    !(effectivePlan.date && effectivePlan.time) &&
    !textHasExplicitDateAnchor(params.clientText, params.timezone) &&
    !textHasExplicitTime(params.clientText)
  ) {
    const modelCleanForSlot = stripAgendaDirectives(params.modelText).trim();
    const slotFromReply = modelCleanForSlot
      ? resolveScheduleDateTimeFromText({
          clientText: "",
          assistantText: modelCleanForSlot,
          timezone: params.timezone,
          agendaDisponibilidade: params.agendaDisponibilidade,
        })
      : null;
    if (slotFromReply) {
      effectivePlan = { ...effectivePlan, date: slotFromReply.date, time: slotFromReply.time };
    }
  }

  // Cliente deu só a DATA (ex.: "terça" sem hora reconhecível) — o bloco de
  // "âncora parcial" acima já zerou effectivePlan para nunca herdar a hora que
  // falta do campo OCULTO do modelo (fonte da alucinação de 2023). Mas a hora
  // ausente pode estar, correta, na PROSA VISÍVEL do próprio modelo (ex.: "Que
  // tal terça-feira às 14h?"), que não é alucinação escondida — é o texto que
  // o lead literalmente vai ler. Preenche só a hora; a data que o lead já deu
  // nunca é sobrescrita pelo modelo. Nunca ativa com sinal de "agora"/imediato
  // no texto do cliente (mesmo veto de resolveScheduleDateTimeFromText) — um
  // pedido "segunda agora" é ambíguo demais para completar com a hora do
  // modelo (regressão coberta pelo incidente "Pode ser segunda agora").
  // (Não há um ramo simétrico "hora sem data": quando o cliente só dá uma hora
  // sem âncora, resolveScheduleDateTimeFromText já resolve isso para "hoje"
  // — resolvedFromClient nunca fica null nesse caso, então esse bloco não
  // seria alcançado.)
  if (
    action === "create" &&
    !resolvedFromClient &&
    !standaloneConfirmation &&
    !(effectivePlan.date && effectivePlan.time) &&
    textHasExplicitDateAnchor(params.clientText, params.timezone) &&
    !textHasExplicitTime(params.clientText) &&
    !textHasImmediateNowExpression(params.clientText)
  ) {
    const modelCleanForHalf = stripAgendaDirectives(params.modelText).trim();
    const timeFromReply = modelCleanForHalf
      ? resolveTimeSignalFromText(modelCleanForHalf, params.agendaDisponibilidade)
      : null;
    const dateFromClient = timeFromReply
      ? resolveDateAnchorFromText(params.clientText, params.timezone)
      : null;
    if (timeFromReply && dateFromClient) {
      effectivePlan = { ...effectivePlan, date: dateFromClient, time: timeFromReply };
    }
  }
  let cancelEvent: AgendaEventRow | null = null;
  if (action === "cancel") {
    const cancelCandidate = await resolveCancelCandidate({
      sb: params.sb,
      tenantId: params.tenantId,
      remoteJid: params.remoteJid,
      timezone: params.timezone,
      clientText: params.clientText,
      requestedEventId: standaloneConfirmation ? pending?.event_id : effectivePlan.eventId,
    });
    cancelEvent = cancelCandidate.event;
    if (!cancelEvent) {
      if (!standaloneConfirmation && cancelCandidate.options.length > 1) {
        return {
          text: buildAgendaCancelDisambiguationQuestion(cancelCandidate.options, params.timezone),
          action: "needs_confirmation",
          deferHandoff: true,
        };
      }
      if (pending) {
        await params.sb
          .from("agent_agenda_pending_actions")
          .update({ state: "expired", updated_at: new Date().toISOString() })
          .eq("id", pending.id)
          .eq("state", "pending");
      }
      return {
        text: "Não encontrei um agendamento ativo para cancelar.",
        action: "failed",
        deferHandoff: true,
      };
    }
    const currentFields = formatScheduleFieldsFromDate(
      new Date(cancelEvent.start_at),
      params.timezone,
    );
    effectivePlan = {
      ...effectivePlan,
      eventId: cancelEvent.id,
      date: currentFields.date,
      time: currentFields.time,
      location: cancelEvent.location ?? null,
    };
    if (
      standaloneConfirmation &&
      pending &&
      (pending.proposed_date !== currentFields.date || pending.proposed_time !== currentFields.time)
    ) {
      await savePendingAgendaAction({
        sb: params.sb,
        tenantId: params.tenantId,
        remoteJid: params.remoteJid,
        journeyId: params.journeyId,
        agentId: params.agentId,
        action: "cancel",
        plan: effectivePlan,
        jobId: params.jobId,
        generation: params.claimedGeneration,
        conversationSequence: params.conversationSequence,
        timezone: params.timezone,
      });
      return {
        text: buildAgendaCancelConfirmationQuestion(cancelEvent, params.timezone),
        action: "needs_confirmation",
        deferHandoff: true,
      };
    }
  }
  if (action !== "cancel" && effectivePlan.location) {
    effectivePlan = {
      ...effectivePlan,
      location: await resolveTrustedAgendaLocation({
        sb: params.sb,
        tenantId: params.tenantId,
        clientText: params.clientText,
        modelLocation: effectivePlan.location,
      }),
    };
  }
  const scheduleComplete = action === "cancel" || Boolean(effectivePlan.date && effectivePlan.time);

  if (action !== "cancel" && scheduleComplete) {
    const candidate: AgendaDirective = {
      type: "schedule",
      date: effectivePlan.date!,
      time: effectivePlan.time!,
      location: effectivePlan.location,
    };
    const startAt = directiveStartAt(candidate, params.timezone);

    // Cliente sem NENHUM sinal de mutação neste turno (ex.: "ok"/"obrigado"
    // depois de já ter confirmado um agendamento), mas o modelo volta a
    // alegar sucesso ("ficou agendado") com o MESMO horário de um evento
    // ativo real deste contato: não reabre o ciclo de proposta/confirmação —
    // isso fazia o agente perguntar "Posso confirmar?" de novo para algo que
    // o lead já confirmou minutos antes (incidente real: "ok"/"obrigado" pós-
    // agendamento). Mesma verificação (findNextActiveAgendaEvent) já usada no
    // caminho legado para NÃO preservar afirmações não verificadas — aqui é o
    // espelho: preserva quando a afirmação bate com um evento real, em vez de
    // reabrir a proposta.
    if (
      action === "create" &&
      !standaloneConfirmation &&
      !pending &&
      !Number.isNaN(startAt.getTime()) &&
      !isInitialAgendaMutationRequest(params.clientText) &&
      !RESCHEDULE_RE.test(params.clientText) &&
      !detectAgendaCancelIntent(params.clientText)
    ) {
      const modelCleanForClaim = stripAgendaDirectives(params.modelText).trim();
      if (AGENDA_SUCCESS_CLAIM_RE.test(modelCleanForClaim)) {
        try {
          const activeEvent = await findNextActiveAgendaEvent({
            sb: params.sb,
            tenantId: params.tenantId,
            remoteJid: params.remoteJid,
          });
          const sameSlot =
            activeEvent != null &&
            Math.abs(new Date(activeEvent.start_at).getTime() - startAt.getTime()) < 60_000;
          if (sameSlot) {
            return { text: modelCleanForClaim, action: "none", deferHandoff: true };
          }
        } catch {
          // Fail-open: segue o fluxo normal abaixo (nunca bloqueia nem duplica).
        }
      }
    }

    const invalidOrPast = Number.isNaN(startAt.getTime()) || startAt.getTime() <= Date.now();
    const outsideAvailability =
      !invalidOrPast &&
      params.agendaDisponibilidade?.ativo === true &&
      !isWithinAgendaAvailability(startAt, params.agendaDisponibilidade, params.timezone);
    if (invalidOrPast || outsideAvailability) {
      if (pending) {
        await params.sb
          .from("agent_agenda_pending_actions")
          .update({ state: "expired", updated_at: new Date().toISOString() })
          .eq("id", pending.id)
          .eq("state", "pending");
      }
      const modelClean = stripAgendaDirectives(params.modelText).trim();
      if (outsideAvailability) {
        return {
          text: modelAsksNaturallyForOutsideWindow(modelClean)
            ? modelClean
            : buildOutsideAvailabilityReply(params.agendaDisponibilidade),
          action: "failed",
          deferHandoff: true,
        };
      }
      const startValid = !Number.isNaN(startAt.getTime());
      return {
        text: startValid && startAt.getTime() <= Date.now()
          ? AGENDA_PAST_DATETIME_REPLY
          : modelAsksNaturallyForMissingSlot(modelClean, params.timezone)
            ? modelClean
            : AGENDA_DATETIME_NEEDED_REPLY,
        action: "failed",
        deferHandoff: true,
      };
    }
  }

  // Toda mutação começa como proposta. A única autorização de execução é a
  // confirmação de uma ação pendente específica, inclusive para criar e
  // remarcar. Isso impede diferenças de comportamento conforme o rótulo
  // escolhido pelo modelo para o mesmo pedido do cliente.
  const directAuthorized = false;
  const proposal =
    isProposalAction(params.plan.action) && !standaloneConfirmation && !directAuthorized;
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
        conversationSequence: params.conversationSequence,
        timezone: params.timezone,
      });
    }
    const directive: AgendaDirective | null = action === "cancel"
      ? { type: "cancel", eventId: effectivePlan.eventId && UUID_RE.test(effectivePlan.eventId) ? effectivePlan.eventId : null }
      : effectivePlan.date && effectivePlan.time
        ? { type: "schedule", date: effectivePlan.date, time: effectivePlan.time, location: effectivePlan.location }
        : null;
    const modelCleanForConfirm = stripAgendaDirectives(params.modelText).trim();
    const keepNaturalProposal =
      scheduleComplete &&
      action !== "cancel" &&
      Boolean(modelCleanForConfirm) &&
      !AGENDA_SUCCESS_CLAIM_RE.test(modelCleanForConfirm) &&
      orphanConcreteScheduleConfirmation(modelCleanForConfirm, params.timezone);
    // Sem data/hora resolvida e validada, o texto do modelo não pode ser
    // devolvido cru: ele pode ter inventado um horário concreto (ex.: plano
    // alucinado com data no passado) sem que nada tenha sido gravado como
    // pendente. Mesmo filtro já usado nos outros ramos deste arquivo — deixa
    // passar perguntas humanas genéricas, troca por AGENDA_DATETIME_NEEDED_REPLY
    // quando o texto do modelo afirma uma hora que ninguém confirmou.
    const naturalMissingSlotText = modelAsksNaturallyForMissingSlot(modelCleanForConfirm, params.timezone)
      ? modelCleanForConfirm
      : AGENDA_DATETIME_NEEDED_REPLY;
    return {
      text: scheduleComplete
        ? action === "cancel" && cancelEvent
          ? buildAgendaCancelConfirmationQuestion(cancelEvent, params.timezone)
          : keepNaturalProposal
            ? modelCleanForConfirm
            : buildAgendaConfirmationQuestion(directive)
        : naturalMissingSlotText,
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
      conversationSequence: params.conversationSequence,
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

/**
 * O modelo às vezes classifica agenda.action="list" (consultar compromisso
 * existente) uma resposta que na verdade está respondendo a uma pergunta de
 * agendamento em aberto do próprio agente — ex.: agente pergunta "Podemos
 * agendar um horário?" e o cliente responde "Sim, amanhã às duas". Não há
 * verbo explícito de agendamento nessa resposta ("quero agendar", "pode
 * marcar"), então nenhuma regra de `isInitialAgendaMutationRequest` cobre o
 * caso — a decisão fica 100% com o modelo, que aqui errou.
 *
 * Reusa só sinais determinísticos que o resto do arquivo já usa (nenhuma
 * lógica nova de data/hora): a pergunta anterior do agente tinha contexto de
 * agenda E a resposta do cliente tem confirmação curta ou sinal de data/hora.
 * Universal — não depende do nicho/negócio configurado pelo cliente.
 */
export function listPlanLooksLikeScheduleAnswer(params: {
  clientText: string;
  priorAssistantText?: string | null;
  timezone: string;
}): boolean {
  const prior = params.priorAssistantText?.trim();
  if (!prior || !textHasSchedulingContext(prior)) return false;
  const text = params.clientText.trim();
  if (!text) return false;
  return (
    CONFIRMATION_RE.test(text.toLowerCase()) ||
    textHasExplicitDateAnchor(text, params.timezone) ||
    textHasExplicitTime(text)
  );
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
  conversationSequence?: number | null;
  journeyId?: string | null;
  /** Mensagens inbound recentes do lead (ordem temporal), para resolver
   *  complementos que chegaram em jobs anteriores (ex.: data num turno, hora no
   *  seguinte). Já filtradas por tenant+journey e janela segura pelo chamador. */
  recentClientMessages?: string[] | null;
  /**
   * Idioma das respostas fixas do sistema. O chamador resolve com a mesma regra
   * do prompt (idioma fixo do agente quando configurado; senão o do cliente).
   * Ausente = detecta do texto do cliente, que é o que a listagem de
   * compromissos já fazia — sem isso, tudo saía em pt-BR.
   */
  languageCode?: SupportedLanguageCode | null;
}): Promise<ResolveAgendaTurnResult> {
  const cleanText = stripAgendaDirectives(params.modelText);
  const replyLanguage =
    params.languageCode ?? detectSupportedLanguageCode(params.clientText);
  const finalize = (result: ResolveAgendaTurnResult) =>
    finalizeResolveAgendaTurnResult(result, params.ctaHandoffAtivo, replyLanguage);
  const clientRequestedMutation =
    isInitialAgendaMutationRequest(params.clientText) ||
    RESCHEDULE_RE.test(params.clientText) ||
    detectAgendaCancelIntent(params.clientText);

  // Corrige o plano ANTES de decidir o ramo — assim toda a lógica de baixo
  // (âncora de data/hora, disponibilidade, proposta em duas fases) já recebe
  // um plano de agendamento normal, em vez de precisar de um caminho especial.
  let agendaPlan = params.agendaPlan;
  if (
    agendaPlan?.action === "list" &&
    !clientRequestedMutation &&
    !clientRequestedAgendaList(params.clientText) &&
    listPlanLooksLikeScheduleAnswer({
      clientText: params.clientText,
      priorAssistantText: params.priorAssistantText,
      timezone: params.timezone,
    })
  ) {
    console.info("[agent-agenda-turn]", {
      tenant_id: params.tenantId,
      agent_id: params.agentId,
      action: "list_plan_reclassified_as_schedule",
    });
    agendaPlan = { ...agendaPlan, action: "propose_create" };
  }

  const requestedList =
    clientRequestedAgendaList(params.clientText) ||
    (agendaPlan?.action === "list" && !clientRequestedMutation);
  if (requestedList) {
    return finalize(await resolveContactAgendaList({
      sb: params.sb ?? createSupabaseServiceClient(),
      tenantId: params.tenantId,
      remoteJid: params.remoteJid,
      timezone: params.timezone,
      clientText: params.clientText,
    }));
  }

  if (!params.agendaAutomationEnabled) {
    const parsed = parseAgendaDirectives(params.modelText);
    const modelClaimedMutation = AGENDA_SUCCESS_CLAIM_RE.test(cleanText);
    if (
      parsed.directives.length > 0 ||
      parsed.invalid ||
      (agendaPlan?.action ?? "none") !== "none" ||
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

  if (agendaPlan && params.agentId) {
    const continuesCancelDisambiguation =
      assistantAskedCancelDisambiguation(params.priorAssistantText) &&
      params.clientText.trim().length > 0;
    const structuredPlan =
      agendaPlan.action === "none" &&
      (detectAgendaCancelIntent(params.clientText) || continuesCancelDisambiguation)
        ? { ...agendaPlan, action: "propose_cancel" as const }
        : agendaPlan;
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
      plan: structuredPlan,
      agendaLembretes: params.agendaLembretes,
      agendaDisponibilidade: params.agendaDisponibilidade,
      slotIndex: params.slotIndex,
      operationKey: params.operationKey,
      jobId: params.jobId,
      claimedGeneration: params.claimedGeneration,
      conversationSequence: params.conversationSequence,
      journeyId: params.journeyId,
      recentClientMessages: params.recentClientMessages,
      priorAssistantText: params.priorAssistantText,
    });
    if (structured) return finalize(structured);
  }

  // Jobs duráveis só aceitam o plano estruturado atual ou uma proposta
  // persistida. O histórico em linguagem natural nunca autoriza uma mutação.
  if (params.jobId) {
    return finalize({ text: cleanText, action: "none" });
  }

  const parsed = parseAgendaDirectives(params.modelText);
  if (parsed.invalid || parsed.directives.length > 1) {
    return finalize({ text: AGENDA_FAILURE_REPLY, action: "failed", deferHandoff: true });
  }

  const directive = parsed.directives.length === 1 ? parsed.directives[0]! : null;
  if (directive?.type !== "cancel" && textHasInvalidExplicitTime(params.clientText)) {
    return finalize({ text: AGENDA_INVALID_TIME_REPLY, action: "failed", deferHandoff: true });
  }
  const proposalText = params.priorAssistantText?.trim() ?? "";
  const recentClientMessages = (params.recentClientMessages ?? [])
    .map((text) => text.trim())
    .filter(Boolean);
  const standaloneConfirmationText = isStandaloneAgendaConfirmation(params.clientText);
  const assistantForConfirm = standaloneConfirmationText
    ? proposalText
    : assistantTextForSchedulingConfirmation(cleanText, params.priorAssistantText);
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
  if (currentContinuesAgenda && !standaloneConfirmationText) {
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
  const hasMutationIntent =
    cancelFromDirective ||
    scheduleFromDirective ||
    cancelFromContext ||
    scheduleFromContext ||
    confirmedFromPriorProposal;

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
        // Falta a hora, mas a conversa é do modelo QUANDO a resposta dele já
        // pergunta pelo horário (tem "?" e fala de agenda, sem afirmar sucesso
        // e SEM inventar uma hora que o lead não deu). Um "Perfeito!" genérico
        // ou uma hora inventada caem no texto fixo que pede o que falta.
        // Execução continua bloqueada em ambos os casos.
        const modelAsksNaturally = modelAsksNaturallyForMissingSlot(
          cleanText,
          params.timezone,
        );
        return finalize({
          text: modelAsksNaturally ? cleanText : AGENDA_DATETIME_NEEDED_REPLY,
          action: modelAsksNaturally ? "none" : "failed",
          deferHandoff: true,
        });
      }
      if (hasTime) {
        const resolved = resolveScheduleDateTimeFromText({
          clientText: params.clientText,
          assistantText: proposalText || assistantForConfirm,
          timezone: params.timezone,
          recentClientMessages,
          agendaDisponibilidade: params.agendaDisponibilidade,
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
      agendaDisponibilidade: params.agendaDisponibilidade,
    });
  } else {
    const resolved = resolveScheduleDateTimeFromText({
      clientText: params.clientText,
      assistantText: proposalText || assistantForConfirm,
      timezone: params.timezone,
      recentClientMessages,
      agendaDisponibilidade: params.agendaDisponibilidade,
    });
    if (!resolved) {
      // Data/hora incompletas (ex.: "pode ser hoje as") — nunca inventar um
      // horário. A resposta do modelo segue QUANDO ela já pergunta pelo
      // dia/horário (tem "?" e fala de agenda, sem afirmar sucesso e sem
      // propor hora concreta que ninguém deu); senão o texto fixo pede o que
      // falta. Execução continua bloqueada nos dois casos.
      const modelAsksNaturally = modelAsksNaturallyForMissingSlot(
        cleanText,
        params.timezone,
      );
      return finalize({
        text: modelAsksNaturally ? cleanText : AGENDA_DATETIME_NEEDED_REPLY,
        action: modelAsksNaturally ? "none" : "failed",
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
      conversationSequence: params.conversationSequence ?? null,
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
