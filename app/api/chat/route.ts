import { NextResponse } from "next/server";
import { completeMarketingChat, resolveChatAiConfigFromEnv, type ChatTurn } from "@/lib/integrations";

type ChatRequestBody = {
  messages?: ChatTurn[];
  sessionId?: string;
  test?: boolean;
};

const SESSION_LIMIT = 20;
const RATE_LIMIT_WINDOW_MS = 1000 * 60 * 60;
const sessionUsage = new Map<string, { count: number; startedAt: number }>();

const MAX_MESSAGES = 28;
const MAX_CONTENT_LENGTH = 6000;

function streamText(text: string, status = 200) {
  const encoder = new TextEncoder();
  const chunks = text.split(/(\s+)/).filter(Boolean);
  const stream = new ReadableStream({
    start(controller) {
      let index = 0;
      const push = () => {
        if (index >= chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(chunks[index]));
        index += 1;
        setTimeout(push, 12);
      };
      push();
    },
  });

  return new Response(stream, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function checkRateLimit(sessionId: string) {
  const now = Date.now();
  const current = sessionUsage.get(sessionId);
  if (!current || now - current.startedAt > RATE_LIMIT_WINDOW_MS) {
    sessionUsage.set(sessionId, { count: 1, startedAt: now });
    return { ok: true };
  }
  if (current.count >= SESSION_LIMIT) {
    return { ok: false };
  }
  current.count += 1;
  sessionUsage.set(sessionId, current);
  return { ok: true };
}

function sanitizeMessages(raw: unknown): ChatTurn[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ChatTurn[] = [];
  for (const item of raw.slice(-MAX_MESSAGES)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const role = o.role === "user" || o.role === "assistant" ? o.role : null;
    const content = typeof o.content === "string" ? o.content : "";
    if (!role) continue;
    const trimmed = content.slice(0, MAX_CONTENT_LENGTH).trim();
    if (!trimmed) continue;
    out.push({ role, content: trimmed });
  }
  return out;
}

export async function POST(request: Request) {
  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  const sessionId = body.sessionId?.trim();
  const messages = sanitizeMessages(body.messages);

  if (!sessionId) {
    return NextResponse.json({ error: "Sessão inválida." }, { status: 400 });
  }

  if (!body.test && (!messages || messages.length === 0)) {
    return NextResponse.json({ error: "Nenhuma mensagem enviada." }, { status: 400 });
  }

  const rate = checkRateLimit(sessionId);
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Muitas mensagens. Aguarde um momento." },
      { status: 429 },
    );
  }

  if (body.test) {
    const cfg = resolveChatAiConfigFromEnv();
    if (!cfg) {
      return NextResponse.json(
        { ok: false, error: "Provedor de IA não configurado no servidor." },
        { status: 503 },
      );
    }
    return NextResponse.json({
      ok: true,
      provider: cfg.provider,
      message: "Conexão com o provedor disponível no ambiente.",
    });
  }

  const result = await completeMarketingChat(messages!);

  if (!result.ok) {
    if (result.code === "UNCONFIGURED") {
      return NextResponse.json(
        { error: "Chat temporariamente indisponível. Entre em contato pelo WhatsApp." },
        { status: 503 },
      );
    }
    if (result.code === "EMPTY_REPLY") {
      return NextResponse.json({ error: "Serviço indisponível no momento." }, { status: 502 });
    }
    const detail = result.detail ?? "";
    if (detail.includes("401") || detail.includes("403")) {
      return NextResponse.json({ error: "Serviço indisponível no momento." }, { status: 401 });
    }
    if (detail.includes("429")) {
      return NextResponse.json(
        { error: "Muitas mensagens. Aguarde um momento." },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { error: "Demorei para responder. Tente novamente." },
      { status: 504 },
    );
  }

  return streamText(result.text);
}
