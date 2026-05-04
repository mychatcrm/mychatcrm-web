import createIntlMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  getAdminSessionByToken,
  hasAdminAccess,
  parseAdminWhitelist,
} from "@/lib/admin-auth";
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
import { routing } from "@/i18n/routing";

const intlMiddleware = createIntlMiddleware(routing);

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

/** Detect the locale currently encoded in the URL path, if any. */
function detectLocaleFromPath(pathname: string): string {
  const found = routing.locales.find(
    (l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`),
  );
  return found ?? routing.defaultLocale;
}

/** Build the localized maintenance path. Default locale has no prefix with "as-needed". */
function localizedMaintenancePath(locale: string): string {
  return locale === routing.defaultLocale ? "/manutencao" : `/${locale}/manutencao`;
}

export async function middleware(request: NextRequest) {
  // 1. HTTPS redirect (production only)
  const httpsRedirect = redirectHttpToHttpsInProduction(request);
  if (httpsRedirect) return httpsRedirect;

  const { pathname } = request.nextUrl;

  // 2. Maintenance status API — always pass through
  if (isMaintenanceStatusApiPath(pathname)) {
    return NextResponse.next();
  }

  // ── UNLOCALIZED SECTIONS (dashboard, admin, api) ──────────────────────────

  const isDashboard = pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  const isAdminArea = pathname === "/admin" || pathname.startsWith("/admin/");
  const isAdminLogin = pathname === "/admin/login";
  const isAdminForgotPassword = pathname === "/admin/forgot-password";
  const isAdminPublicAuth = isAdminLogin || isAdminForgotPassword;
  const isApiRoute = pathname.startsWith("/api/");

  if (isDashboard || isAdminArea || isApiRoute) {
    // Maintenance check (these routes are not locale-prefixed)
    const maintenance = await fetchMaintenanceSnapshot(request);
    if (maintenance.enabled) {
      const adminToken = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
      const adminSession = getAdminSessionByToken(adminToken);
      const bypass = Boolean(adminSession) || isMaintenanceAnonymousAllowPath(pathname);
      if (!bypass) {
        if (isApiRoute) {
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

    if (isApiRoute) return NextResponse.next();

    // ── Dashboard auth ───────────────────────────────────────────────────────
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

    // ── Admin auth ───────────────────────────────────────────────────────────
    if (isAdminArea && !isAdminPublicAuth) {
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

  // ── LOCALIZED PUBLIC ROUTES ───────────────────────────────────────────────

  // Maintenance check for public pages (redirects to localized maintenance page)
  const maintenance = await fetchMaintenanceSnapshot(request);
  if (maintenance.enabled) {
    const adminToken = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
    const adminSession = getAdminSessionByToken(adminToken);
    const bypass = Boolean(adminSession) || isMaintenanceAnonymousAllowPath(pathname);
    if (!bypass) {
      const locale = detectLocaleFromPath(pathname);
      const dest = request.nextUrl.clone();
      dest.pathname = localizedMaintenancePath(locale);
      dest.search = "";
      return NextResponse.redirect(dest);
    }
  }

  // Delegate locale detection, prefix routing and URL rewriting to next-intl
  return intlMiddleware(request);
}

export const config = {
  matcher: [
    // Match everything except Next.js internals and static files
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    "/",
  ],
};
