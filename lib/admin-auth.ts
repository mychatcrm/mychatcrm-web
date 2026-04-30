import { cookies } from "next/headers";
import { cookieSecureFlag } from "@/lib/cookie-security";
import { allowDemoPasswordLogin } from "@/lib/demo-password-auth";

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

const ADMIN_SESSIONS: Record<string, AdminSession> = {
  "admin-super": {
    token: "admin-super",
    adminId: "admin-renato-lagares",
    email: "renatolagares@live.com",
    displayName: "Renato Lagares",
    initials: "RL",
    role: "super_admin",
    roleLabel: "Super Admin",
  },
};

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

function demoAdminPassword(): string {
  return process.env.DEMO_ADMIN_PASSWORD?.trim() || "admin";
}

export function authenticateAdmin(emailRaw: string, password: string): AdminSession | null {
  if (!allowDemoPasswordLogin()) return null;
  const email = emailRaw.trim().toLowerCase();
  const pass = password.trim();

  if (!email || !pass) return null;

  const demoPass = demoAdminPassword();

  if (email === "renatolagares@live.com" && pass === demoPass) {
    return ADMIN_SESSIONS["admin-super"];
  }

  return null;
}

export function getAdminSessionByToken(token?: string | null) {
  if (!token) return null;
  const row = ADMIN_SESSIONS[token];
  if (!row) return null;
  if (!allowDemoPasswordLogin()) return null;
  return row;
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

export async function getAdminSessionFromCookies() {
  const store = await cookies();
  return getAdminSessionByToken(store.get(ADMIN_SESSION_COOKIE)?.value);
}
