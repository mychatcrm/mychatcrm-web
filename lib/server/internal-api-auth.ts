import { timingSafeEqual } from "node:crypto";

/**
 * Todos os secrets internos configurados (não vazios), na ordem de prioridade.
 * A Vercel Cron envia CRON_SECRET no Authorization; chamadas internas do app
 * usam INTERNAL_API_TOKEN/AGENT_RESPONSE_JOBS_SECRET. Aceitar qualquer um dos
 * configurados evita 401 quando mais de um coexiste com valores diferentes.
 */
function getConfiguredInternalSecrets(): string[] {
  const raw = [
    process.env.INTERNAL_API_TOKEN,
    process.env.AGENT_RESPONSE_JOBS_SECRET,
    process.env.CRON_SECRET,
    process.env.EVOLUTION_WEBHOOK_SECRET,
  ];
  const seen = new Set<string>();
  for (const value of raw) {
    const trimmed = value?.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

/** Token preferido para ASSINAR chamadas internas (mantém a ordem de prioridade). */
export function getInternalApiToken(): string | null {
  return getConfiguredInternalSecrets()[0] ?? null;
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
 * Aceita a requisição se o token apresentado (x-internal-token, Bearer no
 * Authorization ou x-agent-jobs-secret) casar com QUALQUER secret interno
 * configurado. Vazio nunca autentica; nenhum valor é registrado em log.
 */
export function verifyInternalApiRequest(request: Request): boolean {
  const secrets = getConfiguredInternalSecrets();
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
