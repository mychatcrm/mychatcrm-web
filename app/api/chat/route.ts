import { NextResponse } from "next/server";
import { isChatWidgetTenantAgentAllowed } from "@/lib/ai/chat-widget-allowlist";
import { generateAgentResponse } from "@/lib/ai/generate-agent-response";
import { resolveOpenAiApiKey } from "@/lib/ai/openai-api-key";
import type { AiMessage } from "@/lib/ai/types";

type ChatRequestBody = {
  messages?: AiMessage[];
  sessionId?: string;
  tenantId?: string;
  agentId?: string;
  conversationId?: string;
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

function sanitizeMessages(raw: unknown): AiMessage[] | null {
  if (!Array.isArray(raw)) return null;
  const out: AiMessage[] = [];
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
    const key = await resolveOpenAiApiKey();
    if (!key) {
      return NextResponse.json(
        { ok: false, error: "OpenAI não configurada no servidor." },
        { status: 503 },
      );
    }
    return NextResponse.json({
      ok: true,
      provider: "openai",
      message: "Conexão com OpenAI disponível no ambiente.",
    });
  }

  const tenantId = body.tenantId?.trim() || "public";
  const agentId = body.agentId?.trim() || "marketing_site_assistant";
  if (!isChatWidgetTenantAgentAllowed(tenantId, agentId)) {
    return NextResponse.json({ error: "Combinação tenant/agente não permitida neste endpoint." }, { status: 403 });
  }

  const result = await generateAgentResponse({
    tenantId,
    agentId,
    conversationId: body.conversationId?.trim() || sessionId,
    customerId: sessionId,
    feature: "site_chat_widget",
    messages: messages!,
  });

  if (!result.ok) {
    if (result.code === "INVALID_INPUT" && result.detail === "AGENT_NOT_FOUND") {
      return NextResponse.json({ error: "Agente não encontrado para este tenant." }, { status: 404 });
    }
    if (result.code === "UNCONFIGURED") {
      return NextResponse.json(
        { error: "Chat temporariamente indisponível. Entre em contato pelo WhatsApp." },
        { status: 503 },
      );
    }
    if (result.code === "EMPTY_REPLY") {
      return NextResponse.json({ error: "Serviço indisponível no momento." }, { status: 502 });
    }
    if (result.code === "LIMIT_EXCEEDED") {
      return NextResponse.json({ error: "Limite de uso de IA atingido para este tenant." }, { status: 429 });
    }
    const detail = result.detail ?? "";
    if (result.code === "UPSTREAM_AUTH" || detail.includes("401") || detail.includes("403")) {
      return NextResponse.json({ error: "Serviço indisponível no momento." }, { status: 401 });
    }
    if (result.code === "UPSTREAM_RATE_LIMIT" || detail.includes("429")) {
      return NextResponse.json(
        { error: "Muitas mensagens. Aguarde um momento." },
        { status: 429 },
      );
    }
    if (result.code === "INVALID_INPUT") {
      return NextResponse.json({ error: "Dados inválidos para inferência." }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Demorei para responder. Tente novamente." },
      { status: 504 },
    );
  }

  return streamText(result.text);
}
