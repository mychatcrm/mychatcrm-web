/**
 * GET /api/client/agentes/voices
 * Retorna a lista de vozes disponíveis no ElevenLabs para o tenant autenticado.
 */
import { NextResponse } from "next/server";
import { requireAgentManagementSession } from "@/lib/server/agent-management-access";
import { listElevenLabsVoices } from "@/lib/integrations/elevenlabs";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireAgentManagementSession();
  if (!guard.ok) return guard.response;

  try {
    const voices = await listElevenLabsVoices();
    return NextResponse.json({ voices });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao buscar vozes.";
    console.error("[api/client/agentes/voices] GET", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
