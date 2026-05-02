import { cookies } from "next/headers";
import { cookieSecureFlag } from "@/lib/cookie-security";
import { getAdminSessionByIdFromDb } from "@/lib/server/admin-auth-db";

export const ADMIN_SESSION_COOKIE = "mychatcrm_admin_session";

export type AdminRole =
  | "super_admin"
  | "admin"
  | "financeiro"
  | "suporte"
  | "marketing"
  | "desenvolvedor";

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

const ROLE_PERMISSION_MAP: Record<AdminRole, string[]> = {
  super_admin: ["*"],
  admin: [
    "dashboard",
    "analytics",
    "clientes",
    "leads",
    "inadimplentes",
    "cancelamentos",
    "planos",
    "enterprise",
    "cupons",
    "parcerias",
    "features",
    "financeiro",
    "faturas",
    "pagamentos",
    "churn",
    "suporte",
    "comunicados",
    "notificacoes",
    "configuracoes",
    "apis",
    "logs",
    "seguranca",
  ],
  financeiro: ["dashboard", "financeiro", "faturas", "pagamentos", "churn", "clientes", "inadimplentes", "parcerias"],
  suporte: ["dashboard", "clientes", "leads", "suporte", "comunicados"],
  marketing: ["dashboard", "analytics", "cupons", "parcerias", "comunicados", "notificacoes", "leads"],
  desenvolvedor: ["dashboard", "configuracoes", "apis", "logs", "seguranca"],
};

function getSecureCookieFlag() {
  return cookieSecureFlag();
}

/**
 * Verificação leve no middleware (Edge-safe, sem DB).
 * O cookie contém o adminId no formato "adminId:role" após o login.
 * Retorna uma sessão mínima para o middleware — a verificação completa
 * acontece nas páginas e rotas via getAdminSessionFromCookies().
 */
export function getAdminSessionByToken(value: string | undefined): AdminSession | null {
  if (!value) return null;
  const [adminId, role] = value.split(":");
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
  const allowed = ROLE_PERMISSION_MAP[session.role] ?? [];
  return allowed.includes("*") || allowed.includes(routeKey);
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
  const adminId = raw.includes(":") ? raw.split(":")[0] : raw;
  if (!adminId) return null;
  return getAdminSessionByIdFromDb(adminId);
}
