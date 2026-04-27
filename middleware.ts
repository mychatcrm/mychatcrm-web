import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, getAdminSessionByToken, hasAdminAccess, parseAdminWhitelist } from "@/lib/admin-auth";
import { CLIENT_SESSION_COOKIE, getClientSessionByToken } from "@/lib/client-auth";
import { redirectHttpToHttpsInProduction } from "@/lib/https-enforcement";
import { fetchMaintenanceSnapshot } from "@/lib/maintenance-middleware-snapshot";
import { isMaintenanceAnonymousAllowPath, isMaintenanceStatusApiPath } from "@/lib/maintenance-policy";
import {
  defaultDashboardPathForOrganizationRole,
  organizationRoleCanAccessDashboardRoute,
  organizationRoleCanAccessPersonalSettings,
  resolveOrganizationRole,
} from "@/lib/organization-role";

function getDashboardRouteKey(pathname: string) {
  const segment = pathname.replace(/^\/dashboard\/?/, "").split("/")[0] ?? "";
  return segment || "overview";
}

function getAdminRouteKey(pathname: string) {
  const segment = pathname.replace(/^\/admin\/?/, "").split("/")[0] ?? "";
  return segment || "dashboard";
}

function getClientIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? "";
  }
  return request.ip ?? "";
}

export async function middleware(request: NextRequest) {
  const httpsRedirect = redirectHttpToHttpsInProduction(request);
  if (httpsRedirect) return httpsRedirect;

  const { pathname } = request.nextUrl;

  if (isMaintenanceStatusApiPath(pathname)) {
    return NextResponse.next();
  }

  const maintenance = await fetchMaintenanceSnapshot(request);
  if (maintenance.enabled) {
    const adminToken = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
    const adminSession = getAdminSessionByToken(adminToken);
    const bypassMaintenance = Boolean(adminSession) || isMaintenanceAnonymousAllowPath(pathname);
    if (!bypassMaintenance) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          {
            ok: false,
            code: "MAINTENANCE",
            message: maintenance.message?.trim() || "Sistema em manutenção. Tente mais tarde.",
          },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        );
      }
      const dest = request.nextUrl.clone();
      dest.pathname = "/manutencao";
      dest.search = "";
      return NextResponse.redirect(dest);
    }
  }

  const isDashboard = pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  const isAdminArea = pathname === "/admin" || pathname.startsWith("/admin/");
  const isAdminLogin = pathname === "/admin/login";

  if (isDashboard) {
    const token = request.cookies.get(CLIENT_SESSION_COOKIE)?.value;
    const session = await getClientSessionByToken(token);

    if (!session) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("from", pathname);
      return NextResponse.redirect(url);
    }

    if (session.status === "cancelada") {
      const url = request.nextUrl.clone();
      url.pathname = "/planos";
      url.searchParams.set("erro", "plano-cancelado");
      return NextResponse.redirect(url);
    }

    if (session.accountSuspended) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("erro", "conta-suspensa");
      return NextResponse.redirect(url);
    }

    const orgRole = resolveOrganizationRole(session);
    const routeKey = getDashboardRouteKey(pathname);

    if (!organizationRoleCanAccessPersonalSettings(orgRole) && routeKey === "configuracoes") {
      const url = request.nextUrl.clone();
      url.pathname = defaultDashboardPathForOrganizationRole(orgRole);
      url.searchParams.delete("from");
      return NextResponse.redirect(url);
    }

    if (!organizationRoleCanAccessDashboardRoute(orgRole, routeKey)) {
      const url = request.nextUrl.clone();
      url.pathname = defaultDashboardPathForOrganizationRole(orgRole);
      url.searchParams.delete("from");
      return NextResponse.redirect(url);
    }

    return NextResponse.next();
  }

  if (isAdminArea && !isAdminLogin) {
    const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
    const session = getAdminSessionByToken(token);

    if (!session) {
      const url = request.nextUrl.clone();
      url.pathname = "/admin/login";
      url.searchParams.set("from", pathname);
      return NextResponse.redirect(url);
    }

    const whitelist = parseAdminWhitelist();
    if (whitelist.length > 0) {
      const ip = getClientIp(request);
      if (!ip || !whitelist.includes(ip)) {
        const url = request.nextUrl.clone();
        url.pathname = "/admin/login";
        url.searchParams.set("erro", "ip-nao-autorizado");
        return NextResponse.redirect(url);
      }
    }

    const routeKey = getAdminRouteKey(pathname);
    if (!hasAdminAccess(session, routeKey)) {
      const url = request.nextUrl.clone();
      url.pathname = "/admin";
      url.searchParams.set("erro", "sem-permissao");
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
    "/",
  ],
};
