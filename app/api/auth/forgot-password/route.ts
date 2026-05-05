import { NextResponse } from "next/server";
import { getClientIpFromRequest } from "@/lib/get-client-ip";
import { checkInMemoryRateLimit } from "@/lib/rate-limit-in-memory";
import { requestPasswordReset, type PasswordResetScope } from "@/lib/server/password-reset";

const GENERIC_MESSAGE =
  "Se existir uma conta associada a este e-mail, enviámos instruções para redefinir a palavra-passe. Verifique a caixa de entrada e o spam.";

export async function POST(request: Request) {
  const ip = getClientIpFromRequest(request) || "unknown";

  // Rate limit by IP (broad protection against flooding)
  const rlIp = checkInMemoryRateLimit(`forgot-password:ip:${ip}`, 10, 15 * 60 * 1000);
  if (!rlIp.ok) {
    return NextResponse.json(
      { message: "Demasiados pedidos. Aguarde alguns minutos e tente novamente." },
      { status: 429, headers: { "Retry-After": String(rlIp.retryAfterSec) } },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    email?: string;
    scope?: string;
  } | null;

  const emailRaw = String(body?.email ?? "").trim().toLowerCase();
  const scopeRaw = String(body?.scope ?? "member").toLowerCase();
  const scope: PasswordResetScope = scopeRaw === "admin" ? "admin" : "member";

  // Rate limit by normalised email (prevents targeted abuse against a single account)
  if (emailRaw) {
    const rlEmail = checkInMemoryRateLimit(
      `forgot-password:email:${emailRaw}`,
      3,
      15 * 60 * 1000,
    );
    if (!rlEmail.ok) {
      // Return generic message — do not confirm the email exists or is throttled
      return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
    }
  }

  try {
    const result = await requestPasswordReset({ emailRaw, scope });

    if (!result.mailConfigured) {
      console.error(
        "[forgot-password] RESEND_API_KEY ausente — e-mail indisponível; scope:", scope,
      );
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
    console.error("[forgot-password] unexpected:", msg, "scope:", scope);
    if (msg.includes("não definida") || msg.includes("SUPABASE_SERVICE_ROLE_KEY")) {
      return NextResponse.json(
        {
          message:
            "O serviço de autenticação está temporariamente indisponível. Tente novamente dentro de instantes ou contacte o suporte.",
        },
        { status: 503 },
      );
    }
    // Generic success — avoid leaking internal errors
    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  }
}
