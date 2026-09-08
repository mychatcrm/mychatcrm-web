/**
 * GET    /api/client/reunioes/{id} — detalhe da reunião.
 * PATCH  /api/client/reunioes/{id} — título, tipo, tags, visibilidade, lead, notas.
 * DELETE /api/client/reunioes/{id} — exclusão (marca; o job de retenção apaga o áudio).
 *
 * Fora do escopo devolve 404 em todos os verbos — confirmar que o registro
 * existe já seria vazamento entre empresas.
 */
import { NextResponse } from "next/server";
import {
  meetingRouteError,
  readJsonBody,
  requireMeetingRouteContext,
} from "@/lib/server/meetings-route-guard";
import {
  softDeleteMeetingForSession,
  updateMeetingForSession,
} from "@/lib/server/meetings-db";
import { getMeetingDetail } from "@/lib/server/meeting-detail";

export const dynamic = "force-dynamic";

const NOT_FOUND = { error: "Reunião não encontrada." };

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const guard = await requireMeetingRouteContext();
  if (!guard.ok) return guard.response;
  const { session, scope, sb } = guard.value;

  const meetingId = params.id?.trim();
  if (!meetingId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  try {
    const detail = await getMeetingDetail({ sb, session, scope, meetingId });
    if (!detail) return NextResponse.json(NOT_FOUND, { status: 404 });
    return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return meetingRouteError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const guard = await requireMeetingRouteContext();
  if (!guard.ok) return guard.response;
  const { session, scope, sb } = guard.value;

  const meetingId = params.id?.trim();
  if (!meetingId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  const body = await readJsonBody(request);
  if (!body) return NextResponse.json({ error: "JSON inválido." }, { status: 400 });

  try {
    const meeting = await updateMeetingForSession({
      sb,
      session,
      scope,
      meetingId,
      patch: {
        title: typeof body.title === "string" ? body.title : undefined,
        meetingType: typeof body.meetingType === "string" ? body.meetingType : undefined,
        tags: Array.isArray(body.tags) ? body.tags.map((tag) => String(tag)) : undefined,
        visibility: typeof body.visibility === "string" ? body.visibility : undefined,
        // `null` desvincula; `undefined` não mexe. Por isso o `in`, e não um
        // truthy check: sem ele, desvincular seria impossível.
        leadId: "leadId" in body ? (typeof body.leadId === "string" ? body.leadId : null) : undefined,
        userNotes: typeof body.userNotes === "string" ? body.userNotes : undefined,
      },
    });
    if (!meeting) return NextResponse.json(NOT_FOUND, { status: 404 });
    return NextResponse.json({ meeting });
  } catch (error) {
    return meetingRouteError(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const guard = await requireMeetingRouteContext();
  if (!guard.ok) return guard.response;
  const { session, scope, sb } = guard.value;

  const meetingId = params.id?.trim();
  if (!meetingId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  try {
    const deleted = await softDeleteMeetingForSession({ sb, session, scope, meetingId });
    if (!deleted) return NextResponse.json(NOT_FOUND, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return meetingRouteError(error);
  }
}
