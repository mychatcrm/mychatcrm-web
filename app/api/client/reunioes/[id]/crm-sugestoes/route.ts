/**
 * GET  /api/client/reunioes/{id}/crm-sugestoes — diff proposto para o lead.
 * POST /api/client/reunioes/{id}/crm-sugestoes — aplica só os campos marcados.
 *
 * O POST não aceita VALORES do cliente, só nomes de campo: o servidor
 * recalcula as sugestões e usa as que ele mesmo produziu. Aceitar valores
 * transformaria a rota num jeito de escrever qualquer coisa no lead com a
 * aparência de "a IA sugeriu".
 */
import { NextResponse } from "next/server";
import {
  meetingRouteError,
  readJsonBody,
  requireMeetingRouteContext,
} from "@/lib/server/meetings-route-guard";
import { applyCrmSuggestions, getCrmSuggestions } from "@/lib/server/meeting-crm-suggestions";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const guard = await requireMeetingRouteContext();
  if (!guard.ok) return guard.response;
  const { session, scope, sb } = guard.value;

  const meetingId = params.id?.trim();
  if (!meetingId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  try {
    const result = await getCrmSuggestions({ sb, session, scope, meetingId });
    // Sem lead vinculado não há sugestão — não é erro.
    if (!result) return NextResponse.json({ leadId: null, suggestions: [] });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
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
  const fields = Array.isArray(body?.fields) ? body.fields.map((field) => String(field)) : [];
  if (fields.length === 0) {
    return NextResponse.json({ error: "Nenhum campo selecionado." }, { status: 400 });
  }

  try {
    const result = await applyCrmSuggestions({ sb, session, scope, meetingId, fields });
    if (!result) return NextResponse.json({ error: "Reunião não encontrada." }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    return meetingRouteError(error);
  }
}
