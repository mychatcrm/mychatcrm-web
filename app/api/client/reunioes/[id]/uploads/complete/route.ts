/**
 * POST /api/client/reunioes/{id}/uploads/complete
 *
 * Fecha o multipart, confere o objeto no R2 e enfileira o processamento.
 * Idempotente: duplo clique em "Finalizar" devolve a reunião como está.
 */
import { NextResponse } from "next/server";
import {
  meetingRouteError,
  readJsonBody,
  requireMeetingRouteContext,
} from "@/lib/server/meetings-route-guard";
import { completeMeetingUpload } from "@/lib/server/meeting-uploads";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const guard = await requireMeetingRouteContext();
  if (!guard.ok) return guard.response;
  const { session, scope, sb } = guard.value;

  const meetingId = params.id?.trim();
  if (!meetingId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  const body = await readJsonBody(request);
  if (!body || !Array.isArray(body.parts)) {
    return NextResponse.json({ error: "parts ausente." }, { status: 400 });
  }

  const parts = body.parts.map((entry) => {
    const part = (entry ?? {}) as Record<string, unknown>;
    return { partNumber: Number(part.partNumber), etag: String(part.etag ?? "") };
  });

  const durationMs =
    typeof body.durationMs === "number" && Number.isFinite(body.durationMs) ? body.durationMs : null;

  try {
    const meeting = await completeMeetingUpload({
      sb,
      session,
      scope,
      meetingId,
      parts,
      durationMs,
      recordedAt: typeof body.recordedAt === "string" ? body.recordedAt : null,
    });
    return NextResponse.json({ meeting }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return meetingRouteError(error);
  }
}
