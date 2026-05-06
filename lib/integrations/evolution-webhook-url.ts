/** URL pública do webhook Evolution com token na query (sem depender de headers custom). */
export function buildEvolutionWebhookUrl(publicBaseUrl: string, webhookToken: string): string {
  const trimmed = publicBaseUrl.replace(/\/+$/, "");
  const base = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
  const u = new URL(`${base}/api/webhooks/evolution`);
  u.searchParams.set("token", webhookToken);
  return u.toString();
}

export function getPublicBaseUrlFromRequest(request: Request): string {
  const envUrl =
    process.env.MYCHATCRM_PUBLIC_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.VERCEL_URL?.trim();
  if (envUrl) {
    const u = envUrl.replace(/\/+$/, "");
    if (u.startsWith("http://") || u.startsWith("https://")) return u;
    return `https://${u}`;
  }
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}
