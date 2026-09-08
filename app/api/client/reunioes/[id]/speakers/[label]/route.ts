/**
 * PATCH /api/client/reunioes/{id}/speakers/{label}
 *
 * Renomeia um falante e, opcionalmente, vincula a um colaborador.
 *
 * O nome é resolvido na renderização, não gravado em cada segmento: por isso
 * renomear aqui atualiza a transcrição inteira sem reescrever milhares de
 * linhas.
 */
import { NextResponse } from "next/server";
import {
  meetingRouteError,
  readJsonBody,
  requireMeetingRouteContext,
} from "@/lib/server/meetings-route-guard";
import { getMeetingForSession } from "@/lib/server/meetings-db";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: { id: string; label: string } },
) {
  const guard = await requireMeetingRouteContext();
  if (!guard.ok) return guard.response;
  const { session, scope, sb } = guard.value;

  const meetingId = params.id?.trim();
  const label = decodeURIComponent(params.label ?? "").trim();
  if (!meetingId || !label) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  const body = await readJsonBody(request);
  if (!body) return NextResponse.json({ error: "JSON inválido." }, { status: 400 });

  try {
    const meeting = await getMeetingForSession({ sb, session, scope, meetingId });
    if (!meeting) return NextResponse.json({ error: "Reunião não encontrada." }, { status: 404 });

    const displayName =
      typeof body.displayName === "string" ? body.displayName.trim().slice(0, 120) : null;

    const patch: Record<string, unknown> = {
      display_name: displayName || null,
      // Confirmado pela pessoa: a sugestão da IA deixa de valer para este rótulo.
      is_confirmed: Boolean(displayName),
      updated_at: new Date().toISOString(),
    };

    if ("employeeId" in body) {
      const employeeId = typeof body.employeeId === "string" ? body.employeeId.trim() : "";
      if (employeeId) {
        // Colaborador tem de ser do mesmo tenant — senão o vínculo viraria uma
        // forma de descobrir gente de outra empresa.
        const { data: member } = await sb
          .from("tenant_members")
          .select("id")
          .eq("tenant_id", session.tenantId)
          .eq("id", employeeId)
          .maybeSingle();
        if (!member) return NextResponse.json({ error: "Colaborador não encontrado." }, { status: 404 });
      }
      patch.employee_id = employeeId || null;
    }

    const { data, error } = await sb
      .from("meeting_speakers")
      .update(patch)
      .eq("tenant_id", session.tenantId)
      .eq("meeting_id", meetingId)
      .eq("label", label)
      .select("label, display_name, employee_id, is_confirmed")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "Falante não encontrado." }, { status: 404 });

    return NextResponse.json({ speaker: data });
  } catch (error) {
    return meetingRouteError(error);
  }
}
