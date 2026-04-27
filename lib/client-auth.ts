import { cookieSecureFlag } from "@/lib/cookie-security";
import { allowDemoPasswordLogin } from "@/lib/demo-password-auth";
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

/** Nome apresentável a partir do e-mail (parte local), para não mostrar personas fictícias na conta. */
export function accountDisplayNameFromEmail(emailRaw: string): string {
  const email = emailRaw.trim().toLowerCase();
  const local = (email.split("@")[0] ?? "").replace(/[.+_-]+/g, " ").trim();
  if (!local) return "Cliente";
  return local
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

const CLIENT_SESSIONS: Record<string, ClientSession> = {
  "client-profissional-demo": {
    token: "client-profissional-demo",
    tenantId: "tenant-clinica-oral-prime",
    email: "cliente@empresa.com.br",
    displayName: accountDisplayNameFromEmail("cliente@empresa.com.br"),
    companyName: "Clínica Oral Prime",
    plan: "equipa",
    planLabel: "Equipa",
    initials: makeInitials(accountDisplayNameFromEmail("cliente@empresa.com.br")),
    status: "ativa",
    organizationRole: "owner",
  },
  "client-master-demo": {
    token: "client-master-demo",
    tenantId: "tenant-mychatcrm-demo",
    email: "lagaresone@gmail.com",
    displayName: "Renato Lagares",
    companyName: "MyChatCRM Demo",
    plan: "escala",
    planLabel: "Escala",
    initials: "RL",
    status: "ativa",
    organizationRole: "owner",
  },
  "client-cancelado-demo": {
    token: "client-cancelado-demo",
    tenantId: "tenant-operacao-encerrada",
    email: "cancelado@empresa.com.br",
    displayName: "Conta Cancelada",
    companyName: "Operação Encerrada",
    plan: "equipa",
    planLabel: "Equipa",
    initials: "CC",
    status: "cancelada",
    organizationRole: "owner",
  },
  /** Demo: mesmo tenant que o dono Master, papel diretor. */
  "client-director-demo": {
    token: "client-director-demo",
    tenantId: "tenant-mychatcrm-demo",
    email: "diretor.demo@mychatcrm.local",
    displayName: "Diretor Demo",
    companyName: "MyChatCRM Demo",
    plan: "escala",
    planLabel: "Escala",
    initials: "DD",
    status: "ativa",
    organizationRole: "director",
  },
  "client-manager-demo": {
    token: "client-manager-demo",
    tenantId: "tenant-mychatcrm-demo",
    email: "gerente.demo@mychatcrm.local",
    displayName: "Gerente Demo",
    companyName: "MyChatCRM Demo",
    plan: "escala",
    planLabel: "Escala",
    initials: "GD",
    status: "ativa",
    organizationRole: "manager",
  },
  "client-seller-demo": {
    token: "client-seller-demo",
    tenantId: "tenant-mychatcrm-demo",
    email: "vendedor.demo@mychatcrm.local",
    displayName: "Vendedor Demo",
    companyName: "MyChatCRM Demo",
    plan: "escala",
    planLabel: "Escala",
    initials: "VD",
    status: "ativa",
    organizationRole: "seller",
  },
  /** Demo: plano Solo (sem colaboradores hierárquicos). */
  "client-solo-demo": {
    token: "client-solo-demo",
    tenantId: "tenant-solo-demo",
    email: "solo.demo@mychatcrm.local",
    displayName: "Solo Demo",
    companyName: "Consultório Solo",
    plan: "solo",
    planLabel: "Solo",
    initials: "SD",
    status: "ativa",
    organizationRole: "owner",
  },
};

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

export function authenticateClient(emailRaw: string, password: string): ClientSession | null {
  if (!allowDemoPasswordLogin()) return null;
  const email = emailRaw.trim().toLowerCase();
  const normalizedPassword = password.trim();

  if (!email || !normalizedPassword) {
    return null;
  }

  const demoPass = process.env.DEMO_CLIENT_PASSWORD?.trim() || "admin";

  if (email === "cancelado@empresa.com.br" && normalizedPassword === demoPass) {
    return CLIENT_SESSIONS["client-cancelado-demo"];
  }

  if (email === "lagaresone@gmail.com" && normalizedPassword === demoPass) {
    return CLIENT_SESSIONS["client-master-demo"];
  }

  if (email === "diretor.demo@mychatcrm.local" && normalizedPassword === demoPass) {
    return CLIENT_SESSIONS["client-director-demo"];
  }

  if (email === "gerente.demo@mychatcrm.local" && normalizedPassword === demoPass) {
    return CLIENT_SESSIONS["client-manager-demo"];
  }

  if (email === "vendedor.demo@mychatcrm.local" && normalizedPassword === demoPass) {
    return CLIENT_SESSIONS["client-seller-demo"];
  }

  if (email === "solo.demo@mychatcrm.local" && normalizedPassword === demoPass) {
    return CLIENT_SESSIONS["client-solo-demo"];
  }

  /** Dono demo plano Equipa (não confundir com colaboradores do mesmo e-mail no ficheiro de equipa). */
  if (email === "cliente@empresa.com.br" && normalizedPassword === demoPass) {
    const base = CLIENT_SESSIONS["client-profissional-demo"];
    const label = accountDisplayNameFromEmail(email);
    return { ...base, displayName: label, initials: makeInitials(label) };
  }

  return null;
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

