/**
 * POST /api/client/agentes/voices/preview
 * Gera uma amostra no idioma escolhido para preview de voz ElevenLabs.
 */
import { NextResponse } from "next/server";
import { requireAgentManagementSession } from "@/lib/server/agent-management-access";
import {
  elevenLabsPreviewErrorMessage,
  isElevenLabsQuotaOrAuthError,
  textToSpeechElevenLabs,
} from "@/lib/integrations/elevenlabs";

export const dynamic = "force-dynamic";

const PREVIEW_TEXT_BY_LANG = {
  pt: "Olá! Eu sou seu assistente virtual. Como posso te ajudar hoje?",
  en: "Hello! I am your virtual assistant. How can I help you today?",
  es: "¡Hola! Soy tu asistente virtual. ¿Cómo puedo ayudarte hoy?",
  fr: "Bonjour! Je suis votre assistant virtuel. Comment puis-je vous aider aujourd'hui?",
  de: "Hallo! Ich bin Ihr virtueller Assistent. Wie kann ich Ihnen heute helfen?",
  it: "Ciao! Sono il tuo assistente virtuale. Come posso aiutarti oggi?",
} as const;

type PreviewLang = keyof typeof PREVIEW_TEXT_BY_LANG;

function normalizePreviewLang(value: unknown): PreviewLang {
  return typeof value === "string" && value in PREVIEW_TEXT_BY_LANG ? (value as PreviewLang) : "pt";
}

export async function POST(request: Request) {
  const guard = await requireAgentManagementSession();
  if (!guard.ok) return guard.response;

  let body: { voice_id?: unknown; lang?: unknown };
  try {
    body = (await request.json()) as { voice_id?: unknown; lang?: unknown };
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const voiceId = typeof body.voice_id === "string" ? body.voice_id.trim() : "";
  if (!voiceId) {
    return NextResponse.json({ error: "voice_id é obrigatório." }, { status: 400 });
  }

  try {
    const lang = normalizePreviewLang(body.lang);
    const audioBuffer = await textToSpeechElevenLabs(PREVIEW_TEXT_BY_LANG[lang], voiceId);
    const audioBody = new Uint8Array(audioBuffer);
    return new Response(audioBody, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const friendly = elevenLabsPreviewErrorMessage(e);
    console.error("[api/client/agentes/voices/preview] POST", e instanceof Error ? e.message : e);
    const status = isElevenLabsQuotaOrAuthError(e) ? 402 : 502;
    return NextResponse.json({ error: friendly }, { status });
  }
}
