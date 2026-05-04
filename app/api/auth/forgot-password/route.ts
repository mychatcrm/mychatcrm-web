import { NextResponse } from "next/server";
import { getClientIpFromRequest } from "@/lib/get-client-ip";
import { checkInMemoryRateLimit } from "@/lib/rate-limit-in-memory";
import { requestPasswordReset, type PasswordResetScope } from "@/lib/server/password-reset";

const GENERIC_MESSAGE =
  "Se existir uma conta associada a este e-mail, enviámos instruções para redefinir a palavra-passe. Verifique a caixa de entrada e o spam.";

export async function POST(request: Request) {
  const ip = getClientIpFromRequest(request) || "unknown";
  const rl = checkInMemoryRateLimit(`forgot-password:${ip}`, 5, 15 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { message: "Demasiados pedidos. Aguarde alguns minutos e tente novamente." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    email?: string;
    scope?: string;
  } | null;

  const emailRaw = String(body?.email ?? "");
  const scopeRaw = String(body?.scope ?? "member").toLowerCase();
  const scope: PasswordResetScope = scopeRaw === "admin" ? "admin" : "member";

  try {
    const result = await requestPasswordReset({ emailRaw, scope });

    if (!result.mailConfigured) {
      console.error("[forgot-password] RESEND_API_KEY ausente — recuperação por e-mail indisponível.");
      return NextResponse.json(
        {
          message:
            "O envio de e-mail não está configurado neste ambiente. Contacte o suporte técnico para redefinir a sua palavra-passe.",
        },
        { status: 503 },
      );
    }

    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[forgot-password]", msg);
    if (msg.includes("não definida") || msg.includes("SUPABASE_SERVICE_ROLE_KEY")) {
      return NextResponse.json(
        {
          message:
            "O serviço de autenticação está temporariamente indisponível. Tente novamente dentro de instantes ou contacte o suporte.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  }
}
