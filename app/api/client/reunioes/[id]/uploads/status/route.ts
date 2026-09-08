/**
 * GET /api/client/reunioes/{id}/uploads/status
 *
 * Estado do envio no R2, não no navegador. É o que permite dizer "encontramos
 * uma gravação interrompida" mesmo depois de o IndexedDB do usuário sumir.
 *
 * DELETE cancela o envio e libera as partes já enviadas.
 */
import { NextResponse } from "next/server";
import { meetingRouteError, requireMeetingRouteContext } from "@/lib/server/meetings-route-guard";
import { abortMeetingUpload, getMeetingUploadStatus } from "@/lib/server/meeting-uploads";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const guard = await requireMeetingRouteContext();
  if (!guard.ok) return guard.response;
  const { session, scope, sb } = guard.value;

  const meetingId = params.id?.trim();
  if (!meetingId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  try {
    const status = await getMeetingUploadStatus({ sb, session, scope, meetingId });
    return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
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
    await abortMeetingUpload({ sb, session, scope, meetingId });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return meetingRouteError(error);
  }
}
