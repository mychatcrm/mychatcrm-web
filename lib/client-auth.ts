import { cookieSecureFlag } from "@/lib/cookie-security";
import { allowDemoPasswordLogin } from "@/lib/demo-password-auth";
// authenticateClient removido — autenticação real via team-employees JSON (lib/server/team-employees-fs.ts)
import { signClientSessionCookie, verifyClientSessionCookie } from "@/lib/client-session-signing";
import type { OrganizationRole } from "@/lib/organization-role";
import { normalizeToPlan, type PlanLimits } from "@/lib/plan-policy";

/**
 * Sessão cliente e helpers usáveis no middleware, em rotas API e em `"use client"`.
 * Leitura de cookies com `next/headers` está em `lib/client-auth-server.ts` para não ir parar ao bundle do browser.
 */
export const CLIENT_SESSION_COOKIE = "mychatcrm_client_session";

export type ClientPlan = "solo" | "equipa" | "escala" | "enterprise";
export type ClientAccountStatus = "ativa" | "cancelada";

const PLAN_LABELS: Record<ClientPlan, "Solo" | "Equipa" | "Escala" | "Enterprise"> = {
  solo: "Solo",
  equipa: "Equipa",
  escala: "Escala",
  enterprise: "Enterprise",
};

/** Migra cookies antigos (`profissional` / `master`) usando a mesma normalização que `lib/plan-policy.ts`. */
export function migrateClientSessionFromLegacyCookie(session: ClientSession): ClientSession {
  const plan = normalizeToPlan(session.plan as unknown as string) as ClientPlan;
  const planLabel = PLAN_LABELS[plan];
  if (plan === session.plan && session.planLabel === planLabel) return session;
  return { ...session, plan, planLabel };
}

export type ClientSession = {
  token: string;
  /** Epoch ms na criação da sessão assinada (cookie mc1). */
  issuedAt?: number;
  tenantId: string;
  email: string;
  displayName: string;
  companyName: string;
  plan: ClientPlan;
  planLabel: "Solo" | "Equipa" | "Escala" | "Enterprise";
  initials: string;
  status: ClientAccountStatus;
  /** Ausente ou `owner`: acesso completo ao painel (inclui configurações pessoais da conta). */
  organizationRole?: OrganizationRole;
  /** Quando o login veio de um registo em Colaboradores (ficheiro no servidor). */
  employeeId?: string;
  reportsToEmployeeId?: string;
  /** Conta de colaborador suspensa — bloqueada no middleware. */
  accountSuspended?: boolean;
  /** Enterprise: limites acordados gravados no servidor e incluídos no cookie assinado. */
  operationalLimits?: PlanLimits;
};

const liveClientSessions = new Map<string, ClientSession>();

export function registerLiveClientSession(partial: Omit<ClientSession, "token">): ClientSession {
  const token =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `live-${crypto.randomUUID()}`
      : `live-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const full: ClientSession = { ...partial, token, issuedAt: Date.now() };
  liveClientSessions.set(token, full);
  return full;
}

export function deleteLiveClientSession(token: string) {
  liveClientSessions.delete(token);
}

const WEEK_IN_SECONDS = 60 * 60 * 24 * 7;

const CLIENT_SESSIONS: Record<string, ClientSession> = {};

function getSecureCookieFlag() {
  return cookieSecureFlag();
}

export function makeInitials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? "C"}${parts[1]?.[0] ?? "L"}`.toUpperCase();
  }
  return (parts[0] ?? "CL").slice(0, 2).toUpperCase();
}


/**
 * Resolve sessão a partir do valor do cookie.
 * Identificadores «live-*» em memória foram complementados com cookie assinado (`mc1.*`) para o middleware (Edge),
 * onde não existe o `Map` em memória das rotas Node.
 */
export async function getClientSessionByToken(cookieValue?: string | null): Promise<ClientSession | null> {
  if (!cookieValue) return null;
  if (cookieValue.startsWith("mc1.")) {
    const verified = await verifyClientSessionCookie(cookieValue);
    return verified ? migrateClientSessionFromLegacyCookie(verified) : null;
  }
  const staticSession = CLIENT_SESSIONS[cookieValue];
  if (staticSession) {
    if (!allowDemoPasswordLogin()) return null;
    return migrateClientSessionFromLegacyCookie(staticSession);
  }
  const live = liveClientSessions.get(cookieValue);
  return live ? migrateClientSessionFromLegacyCookie(live) : null;
}

/** Valor a gravar no cookie: identificador curto das demos estáticas, ou blob assinado para sessões live. */
export async function encodeClientSessionCookieValue(session: ClientSession): Promise<string> {
  if (CLIENT_SESSIONS[session.token]) return session.token;
  return signClientSessionCookie(session);
}

/** Plano com maior limite mensal de leads e recursos (Escala ou Enterprise). */
export function isMasterClient(session: ClientSession) {
  return session.plan === "escala" || session.plan === "enterprise";
}

export function clientSessionCookieOptions() {
  return {
    name: CLIENT_SESSION_COOKIE,
    httpOnly: true,
    sameSite: "strict" as const,
    secure: getSecureCookieFlag(),
    path: "/",
    maxAge: WEEK_IN_SECONDS,
  };
}

