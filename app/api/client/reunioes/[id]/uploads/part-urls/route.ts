/**
 * POST /api/client/reunioes/{id}/uploads/part-urls
 *
 * Devolve URLs presignadas para o navegador enviar as partes DIRETO ao R2.
 * Nenhum byte de áudio passa por aqui — é o que mantém a função serverless
 * fora do caminho da banda.
 */
import { NextResponse } from "next/server";
import {
  meetingRouteError,
  readJsonBody,
  requireMeetingRouteContext,
} from "@/lib/server/meetings-route-guard";
import { createMeetingUploadPartUrls } from "@/lib/server/meeting-uploads";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const guard = await requireMeetingRouteContext();
  if (!guard.ok) return guard.response;
  const { session, scope, sb } = guard.value;

  const meetingId = params.id?.trim();
  if (!meetingId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  const body = await readJsonBody(request);
  if (!body || !Array.isArray(body.partNumbers)) {
    return NextResponse.json({ error: "partNumbers ausente." }, { status: 400 });
  }

  const partNumbers = body.partNumbers.map((value) => Number(value));

  try {
    const urls = await createMeetingUploadPartUrls({ sb, session, scope, meetingId, partNumbers });
    return NextResponse.json({ urls }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return meetingRouteError(error);
  }
}
