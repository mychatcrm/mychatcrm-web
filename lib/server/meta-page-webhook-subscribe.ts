import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  metaGraphErrorCode,
  metaGraphRequest,
} from "@/lib/server/meta-graph-api";

/** Campos Page webhook exigidos para Lead Ads (novo lead + atualizações). */
export const META_PAGE_LEADGEN_WEBHOOK_FIELDS = "leadgen,leadgen_update";

type GraphError = { message?: string; type?: string; code?: number };
type SubscribedAppRow = { id?: string; name?: string; subscribed_fields?: string[] };
type SubscribedAppsResponse = { data?: SubscribedAppRow[]; error?: GraphError };
type SubscribeResponse = { success?: boolean };

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

export type TenantPageLeadgenSubscriptionResult = {
  pageId: string;
  pageName: string | null;
  ok: boolean;
  wasSubscribed: boolean;
  subscribedFields?: string[];
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
  try {
    const data = await metaGraphRequest<SubscribedAppsResponse>(
      `/${encodeURIComponent(pageId)}/subscribed_apps`,
      {
        accessToken: pageAccessToken,
        searchParams: { fields: "id,name,subscribed_fields" },
      },
    );
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
      error: `${metaGraphErrorCode(err)}:${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Subscreve a página ao app atual para receber webhooks leadgen (idempotente na Meta). */
export async function subscribePageToLeadgenWebhooks(
  pageId: string,
  pageAccessToken: string,
): Promise<PageWebhookSubscribeResult> {
  try {
    const data = await metaGraphRequest<SubscribeResponse>(
      `/${encodeURIComponent(pageId)}/subscribed_apps`,
      {
        accessToken: pageAccessToken,
        method: "POST",
        form: { subscribed_fields: META_PAGE_LEADGEN_WEBHOOK_FIELDS },
      },
    );
    if (data.success !== true) {
      return { pageId, ok: false, error: "subscription_post_not_confirmed" };
    }

    const after = await fetchPageSubscribedApps(pageId, pageAccessToken);
    const appId = expectedAppId();
    if (!appId) {
      return { pageId, ok: false, error: "missing_meta_app_id" };
    }
    if (after.error) {
      return { pageId, ok: false, error: `subscription_verification_failed:${after.error}` };
    }
    const match = after.apps.find((a) => a.appId === appId);
    const subscribedFields = match?.subscribedFields ?? [];
    if (!match) {
      return { pageId, ok: false, error: "subscription_app_not_found" };
    }
    if (!subscribedFields.some((field) => field.toLowerCase() === "leadgen")) {
      return {
        pageId,
        ok: false,
        error: "subscription_leadgen_missing",
        subscribedFields,
      };
    }
    return {
      pageId,
      ok: true,
      subscribedFields,
    };
  } catch (err) {
    return {
      pageId,
      ok: false,
      error: `${metaGraphErrorCode(err)}:${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Ensures a tenant page is subscribed to Lead Ads webhooks. This is intentionally
 * called from lead-rule saves so every tenant gets the same protection: a rule
 * is not only stored locally, the Meta page is also prepared to deliver events.
 */
export async function ensureTenantPageLeadgenWebhookSubscription(params: {
  sb: SupabaseClient;
  tenantId: string;
  pageId: string;
}): Promise<TenantPageLeadgenSubscriptionResult> {
  const pageId = params.pageId.trim();
  const appId = expectedAppId();
  if (!pageId) {
    return {
      pageId,
      pageName: null,
      ok: false,
      wasSubscribed: false,
      error: "missing_page_id",
    };
  }
  if (!appId) {
    return {
      pageId,
      pageName: null,
      ok: false,
      wasSubscribed: false,
      error: "missing_meta_app_id",
    };
  }

  const { data: connection, error } = await params.sb
    .from("meta_connections")
    .select("page_id, page_name, page_access_token")
    .eq("tenant_id", params.tenantId)
    .eq("page_id", pageId)
    .maybeSingle<{ page_id: string; page_name: string | null; page_access_token: string | null }>();

  if (error) {
    return {
      pageId,
      pageName: null,
      ok: false,
      wasSubscribed: false,
      error: `meta_connection_query_failed:${error.message}`,
    };
  }
  if (!connection?.page_access_token?.trim()) {
    return {
      pageId,
      pageName: connection?.page_name ?? null,
      ok: false,
      wasSubscribed: false,
      error: "missing_page_access_token",
    };
  }

  const before = await fetchPageSubscribedApps(pageId, connection.page_access_token);
  const wasSubscribed = pageHasLeadgenSubscription(before, appId);
  if (wasSubscribed) {
    return {
      pageId,
      pageName: connection.page_name ?? null,
      ok: true,
      wasSubscribed: true,
      subscribedFields: before.apps.find((app) => app.appId === appId)?.subscribedFields,
    };
  }

  const subscribed = await subscribePageToLeadgenWebhooks(pageId, connection.page_access_token);
  return {
    pageId,
    pageName: connection.page_name ?? null,
    ok: subscribed.ok,
    wasSubscribed: false,
    subscribedFields: subscribed.subscribedFields,
    error: subscribed.error,
  };
}
