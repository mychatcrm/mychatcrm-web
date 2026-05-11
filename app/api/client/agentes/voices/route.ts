/**
 * GET /api/client/agentes/voices
 * Retorna a lista de vozes disponíveis no ElevenLabs para o tenant autenticado.
 */
import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { listElevenLabsVoices } from "@/lib/integrations/elevenlabs";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  try {
    const voices = await listElevenLabsVoices();
    return NextResponse.json({ voices });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao buscar vozes.";
    console.error("[api/client/agentes/voices] GET", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
