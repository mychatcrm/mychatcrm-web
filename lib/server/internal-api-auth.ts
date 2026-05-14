/** Tokens aceitos nas rotas internas (process-agent-job, agent-response-jobs/process). */
export function getInternalApiToken(): string | null {
  return (
    process.env.INTERNAL_API_TOKEN?.trim() ||
    process.env.AGENT_RESPONSE_JOBS_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    process.env.EVOLUTION_WEBHOOK_SECRET?.trim() ||
    null
  );
}

export function verifyInternalApiRequest(request: Request): boolean {
  const expected = getInternalApiToken();
  if (!expected) return false;

  const internalToken = request.headers.get("x-internal-token");
  if (internalToken && internalToken === expected) return true;

  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${expected}`) return true;

  const agentJobsSecret = request.headers.get("x-agent-jobs-secret");
  return Boolean(agentJobsSecret && agentJobsSecret === expected);
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
