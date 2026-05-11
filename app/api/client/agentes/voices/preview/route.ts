/**
 * POST /api/client/agentes/voices/preview
 * Gera uma amostra em português para preview de voz ElevenLabs.
 */
import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { textToSpeechElevenLabs } from "@/lib/integrations/elevenlabs";

export const dynamic = "force-dynamic";

const PREVIEW_TEXT = "Olá! Eu sou seu assistente virtual. Como posso te ajudar hoje?";

export async function POST(request: Request) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  let body: { voice_id?: unknown };
  try {
    body = (await request.json()) as { voice_id?: unknown };
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const voiceId = typeof body.voice_id === "string" ? body.voice_id.trim() : "";
  if (!voiceId) {
    return NextResponse.json({ error: "voice_id é obrigatório." }, { status: 400 });
  }

  try {
    const audioBuffer = await textToSpeechElevenLabs(PREVIEW_TEXT, voiceId);
    const audioBody = new Uint8Array(audioBuffer);
    return new Response(audioBody, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao gerar preview de voz.";
    console.error("[api/client/agentes/voices/preview] POST", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
