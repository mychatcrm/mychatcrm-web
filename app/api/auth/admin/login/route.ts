import { NextResponse } from "next/server";
import { adminSessionCookieOptions, authenticateAdmin } from "@/lib/admin-auth";
import { allowDemoPasswordLogin, isVercelProduction } from "@/lib/demo-password-auth";
import { getClientIpFromRequest } from "@/lib/get-client-ip";
import { checkInMemoryRateLimit } from "@/lib/rate-limit-in-memory";

export async function POST(request: Request) {
  const ip = getClientIpFromRequest(request) || "unknown";
  const rl = checkInMemoryRateLimit(`admin-login:${ip}`, 25, 15 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Demasiadas tentativas. Aguarde e tente novamente." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const body = await request.json().catch(() => null);
  const email = String(body?.email ?? "");
  const password = String(body?.password ?? "");

  const session = authenticateAdmin(email, password);
  if (!session) {
    if (isVercelProduction() && !allowDemoPasswordLogin()) {
      return NextResponse.json(
        {
          error:
            "Login admin desativado em produção: na Vercel defina ALLOW_DEMO_PASSWORD_AUTH=1 e DEMO_ADMIN_PASSWORD (Production), depois redeploy.",
        },
        { status: 401 },
      );
    }
    return NextResponse.json({ error: "E-mail ou senha incorretos." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true, redirectedTo: "/admin" });
  response.cookies.set({
    ...adminSessionCookieOptions(),
    value: session.token,
  });
  return response;
}
