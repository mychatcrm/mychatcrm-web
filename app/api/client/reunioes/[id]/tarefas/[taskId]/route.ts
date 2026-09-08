/**
 * PATCH /api/client/reunioes/{id}/tarefas/{taskId}
 * Estado, responsável e prazo de uma tarefa extraída.
 */
import { NextResponse } from "next/server";
import {
  meetingRouteError,
  readJsonBody,
  requireMeetingRouteContext,
} from "@/lib/server/meetings-route-guard";
import { getMeetingForSession } from "@/lib/server/meetings-db";

export const dynamic = "force-dynamic";

const STATUSES = new Set(["aberta", "concluida", "ignorada"]);
const PRIORITIES = new Set(["baixa", "media", "alta"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function PATCH(
  request: Request,
  { params }: { params: { id: string; taskId: string } },
) {
  const guard = await requireMeetingRouteContext();
  if (!guard.ok) return guard.response;
  const { session, scope, sb } = guard.value;

  const meetingId = params.id?.trim();
  const taskId = params.taskId?.trim();
  if (!meetingId || !taskId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  const body = await readJsonBody(request);
  if (!body) return NextResponse.json({ error: "JSON inválido." }, { status: 400 });

  try {
    // O escopo é conferido pela reunião: quem não alcança a reunião não alcança
    // as tarefas dela.
    const meeting = await getMeetingForSession({ sb, session, scope, meetingId });
    if (!meeting) return NextResponse.json({ error: "Reunião não encontrada." }, { status: 404 });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (typeof body.status === "string") {
      if (!STATUSES.has(body.status)) {
        return NextResponse.json({ error: "Status inválido." }, { status: 400 });
      }
      patch.status = body.status;
    }
    if (typeof body.priority === "string") {
      if (!PRIORITIES.has(body.priority)) {
        return NextResponse.json({ error: "Prioridade inválida." }, { status: 400 });
      }
      patch.priority = body.priority;
    }
    if ("dueDate" in body) {
      const dueDate = typeof body.dueDate === "string" ? body.dueDate : null;
      if (dueDate && !ISO_DATE.test(dueDate)) {
        return NextResponse.json({ error: "Data inválida." }, { status: 400 });
      }
      patch.due_date = dueDate;
      // Data confirmada por uma pessoa deixa de ser dedução.
      patch.due_date_inferred = false;
    }
    if ("assigneeEmployeeId" in body) {
      patch.assignee_employee_id =
        typeof body.assigneeEmployeeId === "string" ? body.assigneeEmployeeId : null;
    }

    const { data, error } = await sb
      .from("meeting_action_items")
      .update(patch)
      .eq("tenant_id", session.tenantId)
      .eq("meeting_id", meetingId)
      .eq("id", taskId)
      .select("id, status, priority, due_date, due_date_inferred, assignee_employee_id")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "Tarefa não encontrada." }, { status: 404 });

    return NextResponse.json({ task: data });
  } catch (error) {
    return meetingRouteError(error);
  }
}
