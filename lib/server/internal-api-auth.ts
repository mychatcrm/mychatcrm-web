import { timingSafeEqual } from "node:crypto";

export type InternalSecretName =
  | "INTERNAL_API_TOKEN"
  | "AGENT_RESPONSE_JOBS_SECRET"
  | "CRON_SECRET"
  | "EVOLUTION_WEBHOOK_SECRET";

const SECRET_ENV: Record<InternalSecretName, string> = {
  INTERNAL_API_TOKEN: "INTERNAL_API_TOKEN",
  AGENT_RESPONSE_JOBS_SECRET: "AGENT_RESPONSE_JOBS_SECRET",
  CRON_SECRET: "CRON_SECRET",
  EVOLUTION_WEBHOOK_SECRET: "EVOLUTION_WEBHOOK_SECRET",
};

/** Secrets usados para ASSINAR chamadas internas (nunca Evolution webhook). */
const SIGNING_PRIORITY: InternalSecretName[] = [
  "INTERNAL_API_TOKEN",
  "AGENT_RESPONSE_JOBS_SECRET",
  "CRON_SECRET",
];

function readSecret(name: InternalSecretName): string | null {
  const trimmed = process.env[SECRET_ENV[name]]?.trim();
  return trimmed ? trimmed : null;
}

function getConfiguredSecrets(names: readonly InternalSecretName[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const value = readSecret(name);
    if (value && !seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

/** Token preferido para ASSINAR chamadas internas (mantém a ordem de prioridade). */
export function getInternalApiToken(): string | null {
  return getConfiguredSecrets(SIGNING_PRIORITY)[0] ?? null;
}

/** Comparação em tempo constante que nunca lança e não vaza o comprimento. */
function safeEquals(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Aceita a requisição se o token apresentado casar com algum secret na allowlist.
 * Vazio nunca autentica; nenhum valor é registrado em log.
 *
 * Default (sem options): INTERNAL + AGENT_JOBS + CRON — sem EVOLUTION_WEBHOOK_SECRET.
 */
export function verifyInternalApiRequest(
  request: Request,
  options?: { allowedSecrets?: readonly InternalSecretName[] },
): boolean {
  const allowed = options?.allowedSecrets ?? SIGNING_PRIORITY;
  const secrets = getConfiguredSecrets(allowed);
  if (secrets.length === 0) return false;

  const authHeader = request.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const candidates = [
    request.headers.get("x-internal-token")?.trim() ?? "",
    bearer,
    request.headers.get("x-agent-jobs-secret")?.trim() ?? "",
  ].filter(Boolean);

  for (const candidate of candidates) {
    for (const secret of secrets) {
      if (safeEquals(candidate, secret)) return true;
    }
  }
  return false;
}

export function internalApiAuthHeaders(): Record<string, string> {
  const token = getInternalApiToken();
  if (!token) return {};
  return {
    Authorization: `Bearer ${token}`,
    "x-internal-token": token,
    "x-agent-jobs-secret": token,
  };
}
