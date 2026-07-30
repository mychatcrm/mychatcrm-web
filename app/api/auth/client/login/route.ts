import { NextResponse } from "next/server";
import {
  clientSessionCookieOptions,
  encodeClientSessionCookieValue,
  makeInitials,
  registerLiveClientSession,
  type ClientPlan,
  type ClientSession,
} from "@/lib/client-auth";
import { isVercelProduction } from "@/lib/demo-password-auth";
import { getClientIpFromRequest } from "@/lib/get-client-ip";
import { hierarchyRoleToOrganizationRole } from "@/lib/organization-hierarchy";
import { defaultDashboardPathForOrganizationRole, resolveOrganizationRole } from "@/lib/organization-role";
import { checkInMemoryRateLimit } from "@/lib/rate-limit-in-memory";
import { enterpriseLimitsToPlanLimits } from "@/lib/enterprise-provision-limits";
import { readEnterpriseProvisionByTenant } from "@/lib/server/enterprise-provisions-db";
import { findTeamMemberCredentials } from "@/lib/server/team-employees-db";
import { tenantPlanDefaults } from "@/lib/tenant-session-defaults";

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
    const teamHit = await findTeamMemberCredentials(emailLc, passwordTrim);
    if (teamHit && !teamHit.employee.accountSuspended) {
      const meta = tenantPlanDefaults(teamHit.tenantId);
      const ent = await readEnterpriseProvisionByTenant(teamHit.tenantId);
      const isEnterpriseTenant = Boolean(ent);
      const plan = isEnterpriseTenant ? ("enterprise" as const) : meta.plan;
      const planLabel = isEnterpriseTenant ? ("Enterprise" as const) : meta.planLabel;
      const companyName = isEnterpriseTenant && ent ? ent.organizationName : meta.companyName;
      const operationalLimits =
        isEnterpriseTenant && ent ? enterpriseLimitsToPlanLimits(ent.limits) : undefined;
      // `is_owner` é a fonte de verdade do titular em qualquer plano. O ramo
      // Enterprise fica como retrocompatibilidade para tenants provisionados
      // antes da migration de equipes.
      const isAccountOwner =
        teamHit.employee.isOwner === true ||
        Boolean(isEnterpriseTenant && ent && teamHit.employee.id === ent.ownerEmployeeId);
      const organizationRole = isAccountOwner
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
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[client-login] falha ao autenticar via Supabase:", msg);
    if (msg.includes("não definida") || msg.includes("SUPABASE_SERVICE_ROLE_KEY")) {
      return NextResponse.json(
        {
          error:
            "Serviço de autenticação indisponível. Confirme a configuração do servidor ou tente novamente em instantes.",
        },
        { status: 503 },
      );
    }
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
      session.status === "cancelada"
        ? "/planos?erro=plano-cancelado"
        : defaultDashboardPathForOrganizationRole(orgRole),
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
