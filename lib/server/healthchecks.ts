/**
 * Healthchecks.io pings (server-only). Never log URLs. Never NEXT_PUBLIC_.
 */

export type MyChatHealthcheck =
  | "agent_response"
  | "follow_ups"
  | "evolution_reconcile"
  | "meta_connections"
  | "omnichannel";

const ENV_KEYS: Record<MyChatHealthcheck, string> = {
  agent_response: "HEALTHCHECK_MYCHATCRM_AGENT_RESPONSE_URL",
  follow_ups: "HEALTHCHECK_MYCHATCRM_FOLLOWUPS_URL",
  evolution_reconcile: "HEALTHCHECK_MYCHATCRM_EVOLUTION_RECONCILE_URL",
  meta_connections: "HEALTHCHECK_MYCHATCRM_META_CONNECTIONS_URL",
  omnichannel: "HEALTHCHECK_MYCHATCRM_OMNICHANNEL_URL",
};

function urlFor(check: MyChatHealthcheck): string | null {
  const raw = process.env[ENV_KEYS[check]]?.trim();
  return raw && /^https?:\/\//i.test(raw) ? raw.replace(/\/$/, "") : null;
}

async function ping(base: string, suffix: "" | "/fail"): Promise<void> {
  try {
    await fetch(`${base}${suffix}`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    /* monitoring must never break jobs */
  }
}

export async function healthcheckSuccess(check: MyChatHealthcheck): Promise<void> {
  const url = urlFor(check);
  if (!url) return;
  await ping(url, "");
}

export async function healthcheckFail(check: MyChatHealthcheck): Promise<void> {
  const url = urlFor(check);
  if (!url) return;
  await ping(url, "/fail");
}
