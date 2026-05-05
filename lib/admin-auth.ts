import { cookies } from "next/headers";
import { cookieSecureFlag } from "@/lib/cookie-security";
import { getAdminSessionByIdFromDb } from "@/lib/server/admin-auth-db";
import { hasAdminAccessByRole, type AdminRole } from "@/lib/admin-permissions";

export const ADMIN_SESSION_COOKIE = "mychatcrm_admin_session";

export type AdminSession = {
  token: string;
  adminId: string;
  email: string;
  displayName: string;
  initials: string;
  role: AdminRole;
  roleLabel: string;
};

const WEEK_IN_SECONDS = 60 * 60 * 24 * 7;

function getSecureCookieFlag() {
  return cookieSecureFlag();
}

/**
 * Verificação leve no middleware (Edge-safe, sem DB).
 * Cookie format: adminId:role:issuedAtMs (issuedAt optional — backward compat).
 * Retorna uma sessão mínima para o middleware — a verificação completa
 * (incluindo invalidação pós-reset via passwordChangedAt) acontece nas
 * páginas e rotas via getAdminSessionFromCookies().
 */
export function getAdminSessionByToken(value: string | undefined): AdminSession | null {
  if (!value) return null;
  const parts = value.split(":");
  const adminId = parts[0];
  const role = parts[1];
  if (!adminId) return null;
  const validRole = role as AdminRole;
  const validRoles: AdminRole[] = ["super_admin", "admin", "financeiro", "suporte", "marketing", "desenvolvedor"];
  const resolvedRole: AdminRole = validRoles.includes(validRole) ? validRole : "admin";
  return {
    token: value,
    adminId,
    email: "",
    displayName: "",
    initials: "",
    role: resolvedRole,
    roleLabel: resolvedRole,
  };
}

export function hasAdminAccess(session: AdminSession, routeKey: string) {
  return hasAdminAccessByRole(session.role, routeKey);
}

export function parseAdminWhitelist() {
  const raw = process.env.ADMIN_IP_WHITELIST?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function adminSessionCookieOptions() {
  return {
    name: ADMIN_SESSION_COOKIE,
    httpOnly: true,
    sameSite: "strict" as const,
    secure: getSecureCookieFlag(),
    path: "/",
    maxAge: WEEK_IN_SECONDS,
  };
}

export async function getAdminSessionFromCookies(): Promise<AdminSession | null> {
  const store = await cookies();
  const raw = store.get(ADMIN_SESSION_COOKIE)?.value;
  if (!raw) return null;
  const parts = raw.split(":");
  const adminId = parts[0];
  const issuedAt = parts[2] ? parseInt(parts[2], 10) : null;
  if (!adminId) return null;

  const session = await getAdminSessionByIdFromDb(adminId);
  if (!session) return null;

  // If the cookie carries issuedAt and the password was changed after it was issued,
  // the session is stale — force re-login.
  if (issuedAt && session.passwordChangedAt && issuedAt < session.passwordChangedAt) {
    return null;
  }

  return session;
}
