/**
 * POST /api/client/reunioes/{id}/tarefas/aplicar
 *
 * Transforma tarefas extraídas em compromissos na agenda. É o passo que faz a
 * reunião virar execução, e não mais um documento bonito.
 *
 * Tarefa sem prazo NÃO vira compromisso: agendar num dia inventado seria pior
 * que não agendar. A interface pede a data antes.
 */
import { NextResponse } from "next/server";
import {
  meetingRouteError,
  readJsonBody,
  requireMeetingRouteContext,
} from "@/lib/server/meetings-route-guard";
import { getMeetingForSession } from "@/lib/server/meetings-db";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";

export const dynamic = "force-dynamic";

/** Compromisso de 30 min às 9h locais do dia do prazo. */
const DEFAULT_HOUR_UTC = 12;
const DURATION_MIN = 30;

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const guard = await requireMeetingRouteContext();
  if (!guard.ok) return guard.response;
  const { session, scope, sb } = guard.value;

  const meetingId = params.id?.trim();
  if (!meetingId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  const body = await readJsonBody(request);
  const taskIds = Array.isArray(body?.taskIds) ? body.taskIds.map((id) => String(id)) : [];
  if (taskIds.length === 0) {
    return NextResponse.json({ error: "Nenhuma tarefa selecionada." }, { status: 400 });
  }

  try {
    const meeting = await getMeetingForSession({ sb, session, scope, meetingId });
    if (!meeting) return NextResponse.json({ error: "Reunião não encontrada." }, { status: 404 });

    const { data: tasks } = await sb
      .from("meeting_action_items")
      .select("id, text, due_date, assignee_employee_id, applied_agenda_event_id")
      .eq("tenant_id", session.tenantId)
      .eq("meeting_id", meetingId)
      .in("id", taskIds);

    const rows = (tasks ?? []) as unknown as Array<Record<string, unknown>>;
    const created: string[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];

    for (const task of rows) {
      const taskId = String(task.id);

      // Idempotente: clicar duas vezes não duplica o compromisso.
      if (task.applied_agenda_event_id) {
        skipped.push({ id: taskId, reason: "ja_aplicada" });
        continue;
      }
      const dueDate = typeof task.due_date === "string" ? task.due_date : null;
      if (!dueDate) {
        skipped.push({ id: taskId, reason: "sem_prazo" });
        continue;
      }

      const startAt = new Date(`${dueDate}T${String(DEFAULT_HOUR_UTC).padStart(2, "0")}:00:00.000Z`);
      const endAt = new Date(startAt.getTime() + DURATION_MIN * 60_000);

      const { data: event, error } = await sb
        .from("agenda_events")
        .insert({
          tenant_id: session.tenantId,
          title: String(task.text ?? "").slice(0, 200),
          description: `Tarefa identificada na reunião "${meeting.title || "sem título"}".`,
          start_at: startAt.toISOString(),
          end_at: endAt.toISOString(),
          status: "confirmed",
          created_by: session.employeeId ?? session.email,
          lead_id: meeting.leadId,
          team_id: meeting.teamId,
          owner_employee_id:
            (typeof task.assignee_employee_id === "string" ? task.assignee_employee_id : null) ??
            session.employeeId ??
            null,
          updated_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (error || !event) {
        skipped.push({ id: taskId, reason: "falha_agenda" });
        continue;
      }

      const eventId = String((event as { id: string }).id);
      await sb
        .from("meeting_action_items")
        .update({
          applied_agenda_event_id: eventId,
          applied_at: new Date().toISOString(),
          applied_by_employee_id: session.employeeId ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", session.tenantId)
        .eq("id", taskId);

      created.push(taskId);
    }

    if (created.length > 0) {
      await appendOperationalAuditEvent({
        tenantId: session.tenantId,
        actorType: "customer",
        actorId: session.employeeId ?? session.email,
        module: "meetings",
        action: "action_items_applied_to_agenda",
        resourceType: "meeting",
        resourceId: meetingId,
        status: "completed",
        metadata: { created: created.length, skipped: skipped.length },
      });
    }

    return NextResponse.json({ created, skipped });
  } catch (error) {
    return meetingRouteError(error);
  }
}
