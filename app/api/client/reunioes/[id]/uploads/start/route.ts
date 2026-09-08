/**
 * POST /api/client/reunioes/{id}/uploads/start
 * Abre (ou retoma) o multipart upload no R2.
 */
import { NextResponse } from "next/server";
import { meetingRouteError, requireMeetingRouteContext } from "@/lib/server/meetings-route-guard";
import { startMeetingUpload } from "@/lib/server/meeting-uploads";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const guard = await requireMeetingRouteContext();
  if (!guard.ok) return guard.response;
  const { session, scope, sb } = guard.value;

  const meetingId = params.id?.trim();
  if (!meetingId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  try {
    const result = await startMeetingUpload({ sb, session, scope, meetingId });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return meetingRouteError(error);
  }
}
