import "server-only";

const GRAPH = "https://graph.facebook.com/v19.0";

/** Campos Page webhook exigidos para Lead Ads (novo lead + atualizações). */
export const META_PAGE_LEADGEN_WEBHOOK_FIELDS = "leadgen,leadgen_update";

type GraphError = { message?: string; type?: string; code?: number };
type SubscribedAppRow = { id?: string; name?: string; subscribed_fields?: string[] };
type SubscribedAppsResponse = { data?: SubscribedAppRow[]; error?: GraphError };
type SubscribeResponse = { success?: boolean; error?: GraphError };

export type PageWebhookSubscribeResult = {
  pageId: string;
  ok: boolean;
  error?: string;
  subscribedFields?: string[];
};

export type PageSubscribedAppsSnapshot = {
  pageId: string;
  apps: Array<{ appId: string; appName: string | null; subscribedFields: string[] }>;
  error?: string;
};

function expectedAppId(): string | null {
  return process.env.META_APP_ID?.trim() || null;
}

export function pageHasLeadgenSubscription(
  snapshot: PageSubscribedAppsSnapshot,
  appId: string | null = expectedAppId(),
): boolean {
  if (!appId || snapshot.error) return false;
  return snapshot.apps.some((app) => {
    if (app.appId !== appId) return false;
    const fields = app.subscribedFields.map((f) => f.toLowerCase());
    return fields.includes("leadgen");
  });
}

/** Lista apps subscritos à página (diagnóstico). */
export async function fetchPageSubscribedApps(
  pageId: string,
  pageAccessToken: string,
): Promise<PageSubscribedAppsSnapshot> {
  const url = `${GRAPH}/${encodeURIComponent(pageId)}/subscribed_apps?access_token=${encodeURIComponent(pageAccessToken)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const data = (await res.json()) as SubscribedAppsResponse;
    if (data.error) {
      return { pageId, apps: [], error: data.error.message ?? "Graph API error" };
    }
    const apps = (data.data ?? []).map((row) => ({
      appId: row.id ?? "",
      appName: row.name ?? null,
      subscribedFields: Array.isArray(row.subscribed_fields) ? row.subscribed_fields : [],
    }));
    return { pageId, apps: apps.filter((a) => a.appId) };
  } catch (err) {
    return {
      pageId,
      apps: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Subscreve a página ao app atual para receber webhooks leadgen (idempotente na Meta). */
export async function subscribePageToLeadgenWebhooks(
  pageId: string,
  pageAccessToken: string,
): Promise<PageWebhookSubscribeResult> {
  const url = `${GRAPH}/${encodeURIComponent(pageId)}/subscribed_apps?subscribed_fields=${encodeURIComponent(META_PAGE_LEADGEN_WEBHOOK_FIELDS)}&access_token=${encodeURIComponent(pageAccessToken)}`;
  try {
    const res = await fetch(url, { method: "POST", signal: AbortSignal.timeout(10_000) });
    const data = (await res.json()) as SubscribeResponse;
    if (data.error) {
      return { pageId, ok: false, error: data.error.message ?? "Graph subscribe failed" };
    }
    if (!res.ok && !data.success) {
      return { pageId, ok: false, error: `HTTP ${res.status}` };
    }
    const after = await fetchPageSubscribedApps(pageId, pageAccessToken);
    const appId = expectedAppId();
    const match = appId ? after.apps.find((a) => a.appId === appId) : after.apps[0];
    return {
      pageId,
      ok: true,
      subscribedFields: match?.subscribedFields,
    };
  } catch (err) {
    return { pageId, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
