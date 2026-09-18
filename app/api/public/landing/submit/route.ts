/**
 * Endpoint público do formulário das páginas.
 *
 * É a única rota da aplicação que responde num host de cliente, e a única sem
 * sessão. Por isso tudo aqui é fechado por omissão:
 *
 * - a página é resolvida pelo HOST do pedido, nunca por um id vindo do corpo,
 *   senão qualquer um postaria leads no CRM de qualquer tenant;
 * - só aceita as chaves declaradas na versão publicada;
 * - limite por IP, porque um formulário aberto na internet é alvo de robô.
 */
import { NextResponse } from "next/server";
import { parseLandingAttribution } from "@/lib/landing/attribution";
import { landingHostConfig } from "@/lib/landing/config";
import { extractPlatformSlug } from "@/lib/landing/host-routing";
import { checkInMemoryRateLimit } from "@/lib/rate-limit-in-memory";
import { getClientIpFromRequest } from "@/lib/get-client-ip";
import { resolvePublishedLandingByHost } from "@/lib/server/landing-pages-db";
import { recordLandingSubmission } from "@/lib/server/landing-submission";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RATE_LIMIT_MAX = 8;
const RATE_LIMIT_WINDOW_MS = 60_000;

function resolveRequestHost(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-host");
  const host = (forwarded ?? request.headers.get("host") ?? "").trim().toLowerCase();
  return host.split(":")[0] ?? "";
}

export async function POST(request: Request) {
  const host = resolveRequestHost(request);
  if (!host) {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const ip = getClientIpFromRequest(request);
  const limit = checkInMemoryRateLimit(`landing:${host}:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Muitas tentativas. Aguarde um momento." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  /**
   * Campo-armadilha: preenchido só por robô, que preenche tudo o que encontra.
   * Responde sucesso para o robô não descobrir que foi barrado e tentar outra
   * forma — mas nada é gravado.
   */
  if (typeof body.website === "string" && body.website.trim()) {
    return NextResponse.json({ ok: true, message: "Recebemos o seu contacto." });
  }

  const config = landingHostConfig();
  // Qualquer falha de infraestrutura vira resposta amigável: o visitante está
  // num formulário comercial, não pode receber rasto de pilha.
  const published = await resolvePublishedLandingByHost({
    host,
    platformSlug: extractPlatformSlug(host, config.pagesDomain),
  }).catch((error: unknown) => {
    console.error("[landing-submit] resolução falhou", error);
    return null;
  });

  if (!published) {
    return NextResponse.json({ error: "Formulário indisponível." }, { status: 404 });
  }

  const attribution = parseLandingAttribution({
    query: (body.attribution ?? {}) as Record<string, string>,
    referrer: typeof body.referrer === "string" ? body.referrer : null,
  });

  const result = await recordLandingSubmission({
    published,
    payload: (body.fields ?? {}) as Record<string, unknown>,
    consentGiven: body.consent === true,
    attribution,
    ip,
    userAgent: request.headers.get("user-agent"),
  }).catch((error: unknown) => {
    console.error("[landing-submit] gravação falhou", error);
    return {
      ok: false as const,
      code: "failed" as const,
      message: "Não foi possível enviar agora. Tente novamente.",
    };
  });

  if (!result.ok) {
    if (result.code === "invalid") {
      return NextResponse.json({ error: "Confira os campos.", errors: result.errors }, { status: 400 });
    }
    return NextResponse.json({ error: result.message }, { status: result.code === "unavailable" ? 503 : 500 });
  }

  return NextResponse.json({ ok: true, message: result.successMessage });
}
