import { NextResponse } from "next/server";
import { adminSessionCookieOptions } from "@/lib/admin-auth";
import { getClientIpFromRequest } from "@/lib/get-client-ip";
import { checkInMemoryRateLimit } from "@/lib/rate-limit-in-memory";
import { authenticateAdminFromDb } from "@/lib/server/admin-auth-db";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";

export async function POST(request: Request) {
  const ip = getClientIpFromRequest(request) || "unknown";
  const rl = checkInMemoryRateLimit(`admin-login:${ip}`, 25, 15 * 60 * 1000);
  if (!rl.ok) {
    void appendOperationalAuditEvent({
      actorType: "administrator", module: "auth.admin", action: "login.rate_limited",
      status: "blocked", severity: "warning", critical: true,
      resourceType: "admin_session", resultCode: "rate_limited",
    });
    return NextResponse.json(
      { error: "Demasiadas tentativas. Aguarde e tente novamente." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const body = await request.json().catch(() => null);
  const email = String(body?.email ?? "");
  const password = String(body?.password ?? "");

  let session;
  try {
    session = await authenticateAdminFromDb(email, password);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[admin-login]", msg);
    if (msg.includes("não definida") || msg.includes("SUPABASE_SERVICE_ROLE_KEY")) {
      return NextResponse.json(
        {
          error:
            "Serviço de autenticação indisponível. Confirme a configuração do servidor ou tente novamente em instantes.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: "Não foi possível validar as credenciais. Tente novamente dentro de momentos." },
      { status: 503 },
    );
  }

  if (!session) {
    void appendOperationalAuditEvent({
      actorType: "administrator", module: "auth.admin", action: "login.failed",
      status: "blocked", severity: "warning", critical: true,
      resourceType: "admin_session", resultCode: "invalid_credentials",
    });
    return NextResponse.json({ error: "E-mail ou senha incorretos." }, { status: 401 });
  }

  try {
    await appendOperationalAuditEvent({
      actorType: "administrator", actorId: session.adminId,
      module: "auth.admin", action: "login.completed", status: "completed",
      critical: true, resourceType: "admin_session", resourceId: session.adminId,
      resultCode: "authenticated", relatedIds: { admin_id: session.adminId },
    }, { strict: true });
  } catch {
    return NextResponse.json({ error: "Login bloqueado porque a auditoria de segurança está indisponível." }, { status: 503 });
  }

  const response = NextResponse.json({ ok: true, redirectedTo: "/admin" });
  // Cookie format: adminId:role:issuedAtMs — the issuedAt is compared post-reset.
  response.cookies.set({
    ...adminSessionCookieOptions(),
    value: `${session.adminId}:${session.role}:${Date.now()}`,
  });
  return response;
}
