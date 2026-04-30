import { NextResponse } from "next/server";
import {
  authenticateClient,
  clientSessionCookieOptions,
  encodeClientSessionCookieValue,
  makeInitials,
  registerLiveClientSession,
  type ClientPlan,
  type ClientSession,
} from "@/lib/client-auth";
import { allowDemoPasswordLogin, isVercelProduction } from "@/lib/demo-password-auth";
import { getClientIpFromRequest } from "@/lib/get-client-ip";
import { hierarchyRoleToOrganizationRole } from "@/lib/organization-hierarchy";
import { defaultDashboardPathForOrganizationRole, resolveOrganizationRole } from "@/lib/organization-role";
import { checkInMemoryRateLimit } from "@/lib/rate-limit-in-memory";
import { enterpriseLimitsToPlanLimits } from "@/lib/enterprise-provision-limits";
import { getEnterpriseProvisionByTenantId } from "@/lib/server/enterprise-provisions-fs";
import {
  findTeamMemberCredentialsAcrossTenants,
  teamMemberEmailExistsAcrossTenants,
} from "@/lib/server/team-employees-fs";
import { tenantPlanDefaults } from "@/lib/tenant-session-defaults";

function logClientLoginDiskError(err: unknown) {
  const msg = err instanceof Error ? err.message : "unknown_error";
  console.error("[client-login] falha ao ler colaboradores no disco:", msg);
}

export async function POST(request: Request) {
  const ip = getClientIpFromRequest(request) || "unknown";
  const rl = checkInMemoryRateLimit(`client-login:${ip}`, 25, 15 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Demasiadas tentativas. Aguarde e tente novamente." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  if (isVercelProduction() && !process.env.CLIENT_SESSION_COOKIE_SECRET?.trim()) {
    console.error("[client-login] produção sem CLIENT_SESSION_COOKIE_SECRET");
    return NextResponse.json(
      {
        error:
          "Não foi possível iniciar sessão neste ambiente. Se o problema persistir, contacte o suporte técnico.",
      },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => null);
  const email = String(body?.email ?? "");
  const password = String(body?.password ?? "");

  const emailLc = email.trim().toLowerCase();
  const passwordTrim = password.trim();

  let session: ClientSession | null = null;
  try {
    const teamHit = findTeamMemberCredentialsAcrossTenants(emailLc, passwordTrim);
    if (teamHit && !teamHit.employee.accountSuspended) {
      const meta = tenantPlanDefaults(teamHit.tenantId);
      const ent = getEnterpriseProvisionByTenantId(teamHit.tenantId);
      const isEnterpriseTenant = Boolean(ent);
      const plan = isEnterpriseTenant ? ("enterprise" as const) : meta.plan;
      const planLabel = isEnterpriseTenant ? ("Enterprise" as const) : meta.planLabel;
      const companyName = isEnterpriseTenant && ent ? ent.organizationName : meta.companyName;
      const operationalLimits = isEnterpriseTenant && ent ? enterpriseLimitsToPlanLimits(ent.limits) : undefined;
      const organizationRole =
        isEnterpriseTenant && ent && teamHit.employee.id === ent.ownerEmployeeId
          ? ("owner" as const)
          : hierarchyRoleToOrganizationRole(teamHit.employee.hierarchyRole);
      session = registerLiveClientSession({
        tenantId: teamHit.tenantId,
        email: teamHit.employee.email,
        displayName: teamHit.employee.nome,
        companyName,
        plan: plan as ClientPlan,
        planLabel,
        initials: makeInitials(teamHit.employee.nome),
        status: "ativa",
        organizationRole,
        employeeId: teamHit.employee.id,
        reportsToEmployeeId: teamHit.employee.reportsToId,
        accountSuspended: false,
        operationalLimits,
      });
    }
  } catch (err) {
    logClientLoginDiskError(err);
  }

  if (!session) {
    session = authenticateClient(email, password);
  }

  const demoPass = process.env.DEMO_CLIENT_PASSWORD?.trim() || "admin";

  /**
   * Demo: senha demo + e-mail que não está registado como colaborador → sessão dono (plano Profissional).
   * Só com `ALLOW_DEMO_PASSWORD_AUTH` ou ambiente não produtivo (ver `lib/demo-password-auth.ts`).
   */
  if (
    allowDemoPasswordLogin() &&
    !session &&
    passwordTrim === demoPass &&
    !teamMemberEmailExistsAcrossTenants(emailLc)
  ) {
    const nameSeed = emailLc.split("@")[0] ?? "cliente";
    const displayName = nameSeed
      .split(/[._-]+/)
      .filter(Boolean)
      .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
      .join(" ");
    session = registerLiveClientSession({
      tenantId: "tenant-operacao-cliente",
      email: email.trim(),
      displayName: displayName || "Cliente",
      companyName: "Operação Cliente",
      plan: "equipa",
      planLabel: "Equipa",
      initials: makeInitials(displayName || "Cliente"),
      status: "ativa",
      organizationRole: "owner",
    });
  }

  if (!session) {
    return NextResponse.json({ error: "Credenciais inválidas." }, { status: 401 });
  }
  if (session.accountSuspended) {
    return NextResponse.json({ error: "Conta suspensa." }, { status: 403 });
  }

  const orgRole = resolveOrganizationRole(session);
  const response = NextResponse.json({
    ok: true,
    redirectedTo:
      session.status === "cancelada" ? "/planos?erro=plano-cancelado" : defaultDashboardPathForOrganizationRole(orgRole),
    status: session.status,
  });

  let cookieValue: string;
  try {
    cookieValue = await encodeClientSessionCookieValue(session);
  } catch (err) {
    console.error("[client-login] falha ao assinar cookie de sessão:", err);
    return NextResponse.json(
      {
        error:
          "Não foi possível iniciar sessão neste ambiente. Se o problema persistir, contacte o suporte técnico.",
      },
      { status: 503 },
    );
  }
  response.cookies.set({
    ...clientSessionCookieOptions(),
    value: cookieValue,
  });

  return response;
}
