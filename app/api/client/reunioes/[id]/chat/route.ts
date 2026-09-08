/**
 * GET  /api/client/reunioes/{id}/chat — histórico de perguntas.
 * POST /api/client/reunioes/{id}/chat — pergunta sobre a reunião.
 */
import { NextResponse } from "next/server";
import {
  meetingRouteError,
  readJsonBody,
  requireMeetingRouteContext,
} from "@/lib/server/meetings-route-guard";
import { askMeeting, listMeetingChat } from "@/lib/server/meeting-chat";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const guard = await requireMeetingRouteContext();
  if (!guard.ok) return guard.response;
  const { session, scope, sb } = guard.value;

  const meetingId = params.id?.trim();
  if (!meetingId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  try {
    const messages = await listMeetingChat({ sb, session, scope, meetingId });
    if (!messages) return NextResponse.json({ error: "Reunião não encontrada." }, { status: 404 });
    return NextResponse.json({ messages }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return meetingRouteError(error);
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const guard = await requireMeetingRouteContext();
  if (!guard.ok) return guard.response;
  const { session, scope, sb } = guard.value;

  const meetingId = params.id?.trim();
  if (!meetingId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  const body = await readJsonBody(request);
  const question = typeof body?.question === "string" ? body.question : "";
  if (!question.trim()) return NextResponse.json({ error: "Pergunta vazia." }, { status: 400 });

  try {
    const result = await askMeeting({ sb, session, scope, meetingId, question });
    if (!result) return NextResponse.json({ error: "Reunião não encontrada." }, { status: 404 });

    if (!result.ok) {
      const message =
        result.code === "transcript_unavailable"
          ? "A transcrição desta reunião ainda não está pronta."
          : "Não foi possível responder agora. Tente de novo em instantes.";
      return NextResponse.json({ error: message, code: result.code }, { status: 422 });
    }

    return NextResponse.json({ answer: result.answer, cached: result.cached });
  } catch (error) {
    return meetingRouteError(error);
  }
}
