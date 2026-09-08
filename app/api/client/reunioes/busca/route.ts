/**
 * POST /api/client/reunioes/busca
 *
 * Busca no que foi dito, em todas as reuniões que a pessoa alcança.
 *
 * POST e não GET de propósito: a consulta é conteúdo de reunião e não deve ir
 * na URL, onde acabaria em log de acesso e histórico do navegador.
 */
import { NextResponse } from "next/server";
import {
  meetingRouteError,
  readJsonBody,
  requireMeetingRouteContext,
} from "@/lib/server/meetings-route-guard";
import { searchMeetings } from "@/lib/server/meeting-search";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const guard = await requireMeetingRouteContext();
  if (!guard.ok) return guard.response;
  const { session, scope, sb } = guard.value;

  const body = await readJsonBody(request);
  const query = typeof body?.query === "string" ? body.query : "";
  if (!query.trim()) return NextResponse.json({ hits: [] });

  try {
    const hits = await searchMeetings({ sb, session, scope, query, limit: 20 });
    return NextResponse.json({ hits }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return meetingRouteError(error);
  }
}
