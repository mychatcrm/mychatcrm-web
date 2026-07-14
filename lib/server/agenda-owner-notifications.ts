import "server-only";

import { sendSystemNotification } from "@/lib/server/system-agent";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type AppointmentNotificationAction = "scheduled" | "rescheduled" | "cancelled";

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

const ACTION_HEADLINES: Record<AppointmentNotificationAction, string> = {
  scheduled: "Novo agendamento confirmado pelo agente.",
  rescheduled: "Agendamento remarcado pelo agente.",
  cancelled: "Agendamento cancelado pelo agente.",
};

export function buildAppointmentNotificationMessage(params: {
  action: AppointmentNotificationAction;
  attendeeName: string | null;
  attendeePhone: string | null;
  whenPtBr: string;
  location: string | null;
}): string {
  const clientLabel = params.attendeeName?.trim() || params.attendeePhone?.trim() || "Não informado";
  const lines = [
    `Aviso MyChatCRM — ${ACTION_HEADLINES[params.action]}`,
    `Cliente: ${clientLabel}`,
  ];
  if (params.attendeePhone?.trim()) lines.push(`Telefone: ${params.attendeePhone.trim()}`);
  lines.push(`Quando: ${params.whenPtBr}`);
  if (params.location?.trim()) lines.push(`Local: ${params.location.trim()}`);
  return lines.join("\n");
}

export async function notifyTenantAppointmentChange(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  action: AppointmentNotificationAction;
  agendaEventId: string;
  attendeeName: string | null;
  attendeePhone: string | null;
  startAtIso: string;
  location: string | null;
  timezone: string;
  agentId?: string | null;
}): Promise<void> {
  try {
    const sb = params.sb ?? createSupabaseServiceClient();
    const { data: tenant, error } = await sb
      .from("tenants")
      .select("appointment_notification_phone")
      .eq("id", params.tenantId)
      .maybeSingle();

    if (error) {
      console.warn("[agenda-owner-notifications] tenant_lookup_failed", {
        tenant_id: params.tenantId,
        error: error.message,
      });
      return;
    }

    const phone = String((tenant as { appointment_notification_phone?: string | null } | null)?.appointment_notification_phone ?? "").trim();
    if (!phone) {
      console.info("[agenda-owner-notifications] skipped", {
        tenant_id: params.tenantId,
        agenda_event_id: params.agendaEventId,
        reason: "missing_appointment_notification_phone",
      });
      return;
    }

    const message = buildAppointmentNotificationMessage({
      action: params.action,
      attendeeName: params.attendeeName,
      attendeePhone: params.attendeePhone,
      whenPtBr: formatEventDateTimePtBr(params.startAtIso, params.timezone),
      location: params.location,
    });

    const sent = await sendSystemNotification(phone, message, "", {
      type: "appointment_notification",
      metadata: {
        tenant_id: params.tenantId,
        agenda_event_id: params.agendaEventId,
        action: params.action,
        agent_id: params.agentId ?? null,
        attendee_phone_last4: params.attendeePhone ? params.attendeePhone.replace(/\D/g, "").slice(-4) : null,
      },
    });

    if (!sent.ok) {
      console.warn("[agenda-owner-notifications] send_failed", {
        tenant_id: params.tenantId,
        agenda_event_id: params.agendaEventId,
        action: params.action,
        error: sent.error ?? "send_failed",
      });
    }
  } catch (error) {
    console.warn("[agenda-owner-notifications] notify_failed", {
      tenant_id: params.tenantId,
      agenda_event_id: params.agendaEventId,
      action: params.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
