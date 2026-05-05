import { NextResponse } from "next/server";
import { getClientIpFromRequest } from "@/lib/get-client-ip";
import { checkInMemoryRateLimit } from "@/lib/rate-limit-in-memory";
import { completePasswordReset } from "@/lib/server/password-reset";

export async function POST(request: Request) {
  const ip = getClientIpFromRequest(request) || "unknown";
  const rl = checkInMemoryRateLimit(`reset-password:ip:${ip}`, 10, 15 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { message: "Demasiadas tentativas. Aguarde e tente novamente." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    token?: string;
    password?: string;
  } | null;

  const token = String(body?.token ?? "");
  const password = String(body?.password ?? "");

  try {
    const result = await completePasswordReset({ rawToken: token, newPassword: password });

    if (result.ok) {
      return NextResponse.json({ ok: true, message: "Palavra-passe atualizada. Já pode iniciar sessão." });
    }

    if (result.code === "weak_password") {
      return NextResponse.json(
        { message: "A palavra-passe deve ter pelo menos 8 caracteres." },
        { status: 400 },
      );
    }

    if (result.code === "expired") {
      return NextResponse.json(
        { message: "Este link expirou. Solicite uma nova recuperação de palavra-passe." },
        { status: 400 },
      );
    }

    if (result.code === "already_used") {
      return NextResponse.json(
        { message: "Este link já foi utilizado. Solicite uma nova recuperação se necessário." },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { message: "Link inválido ou expirado. Solicite uma nova recuperação de palavra-passe." },
      { status: 400 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[reset-password] unexpected:", msg);
    if (msg.includes("não definida") || msg.includes("SUPABASE_SERVICE_ROLE_KEY")) {
      return NextResponse.json(
        { message: "Serviço temporariamente indisponível. Tente novamente mais tarde." },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { message: "Não foi possível redefinir a palavra-passe. Tente novamente." },
      { status: 500 },
    );
  }
}
