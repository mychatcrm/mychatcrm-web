/**
 * GET /api/client/reunioes/{id}/transcript
 * Segmentos da transcrição, em ordem de leitura.
 */
import { NextResponse } from "next/server";
import { meetingRouteError, requireMeetingRouteContext } from "@/lib/server/meetings-route-guard";
import { getMeetingTranscript } from "@/lib/server/meeting-detail";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const guard = await requireMeetingRouteContext();
  if (!guard.ok) return guard.response;
  const { session, scope, sb } = guard.value;

  const meetingId = params.id?.trim();
  if (!meetingId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  try {
    const segments = await getMeetingTranscript({ sb, session, scope, meetingId });
    if (!segments) return NextResponse.json({ error: "Reunião não encontrada." }, { status: 404 });
    return NextResponse.json({ segments }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return meetingRouteError(error);
  }
}
