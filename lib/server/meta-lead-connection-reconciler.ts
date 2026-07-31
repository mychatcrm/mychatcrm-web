import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildMetaConnectionFailureHealth,
  persistMetaConnectionHealth,
  verifyMetaAppLeadgenWebhook,
  verifyMetaPageLeadConnection,
  verifyMetaUserAccessToken,
  type MetaConnectionHealthStatus,
} from "@/lib/server/meta-lead-connection-health";
import { reconcileMetaLeadGrantDiscovery } from "@/lib/server/meta-lead-grant-reconciler";

type ConnectionRow = {
  tenant_id: string;
  page_id: string;
  page_access_token: string;
  user_access_token: string | null;
  credential_fingerprint: string;
};

export type MetaConnectionReconcileResult = {
  ok: boolean;
  checked: number;
  ready: number;
  degraded: number;
  actionRequired: number;
  grantsChecked: number;
  pagesDiscovered: number;
  results: Array<{
    tenantId: string;
    pageId: string;
    status: MetaConnectionHealthStatus;
    code: string | null;
  }>;
};

export async function reconcileMetaLeadConnections(params: {
  sb: SupabaseClient;
  limit?: number;
  tenantId?: string;
}): Promise<MetaConnectionReconcileResult> {
  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appId || !appSecret) {
    throw new Error("meta_app_credentials_missing");
  }

  const now = new Date().toISOString();
  const grantDiscovery = await reconcileMetaLeadGrantDiscovery({
    sb: params.sb,
    appId,
    appSecret,
    limit: 10,
  });
  let query = params.sb
    .from("meta_connections")
    .select(
      "tenant_id, page_id, page_access_token, user_access_token, credential_fingerprint",
    )
    .neq("health_status", "revoked")
    .or(`next_health_check_at.is.null,next_health_check_at.lte.${now}`)
    .order("next_health_check_at", { ascending: true, nullsFirst: true })
    .limit(Math.max(1, Math.min(params.limit ?? 12, 50)));
  if (params.tenantId) {
    query = query.eq("tenant_id", params.tenantId);
  }

  const { data, error } = await query.returns<ConnectionRow[]>();
  if (error) {
    throw new Error(`meta_connections_reconcile_query_failed:${error.message}`);
  }
  const connections = data ?? [];
  if (connections.length === 0) {
    return {
      ok: true,
      checked: 0,
      ready: 0,
      degraded: 0,
      actionRequired: 0,
      grantsChecked: grantDiscovery.checked,
      pagesDiscovered: grantDiscovery.pagesDiscovered,
      results: [],
    };
  }

  const appWebhook = await verifyMetaAppLeadgenWebhook({ appId, appSecret });
  const tokenChecks = new Map<
    string,
    ReturnType<typeof verifyMetaUserAccessToken>
  >();
  const results: MetaConnectionReconcileResult["results"] = [];

  for (let offset = 0; offset < connections.length; offset += 8) {
    const batch = connections.slice(offset, offset + 8);
    await Promise.all(
      batch.map(async (connection) => {
        const userAccessToken = connection.user_access_token?.trim();
        let health;
        if (!userAccessToken) {
          health = buildMetaConnectionFailureHealth({
            code: "user_token_missing",
            appWebhook,
          });
        } else {
          let tokenCheckPromise = tokenChecks.get(userAccessToken);
          if (!tokenCheckPromise) {
            tokenCheckPromise = verifyMetaUserAccessToken({
              userAccessToken,
              appId,
              appSecret,
              requireDurable: true,
            });
            tokenChecks.set(userAccessToken, tokenCheckPromise);
          }
          const tokenCheck = await tokenCheckPromise;
          health = await verifyMetaPageLeadConnection({
            pageId: connection.page_id,
            pageAccessToken: connection.page_access_token,
            tokenCheck,
            appWebhook,
          });
        }

        const persisted = await persistMetaConnectionHealth({
          sb: params.sb,
          tenantId: connection.tenant_id,
          pageId: connection.page_id,
          health,
          expectedCredentialFingerprint: connection.credential_fingerprint,
        });
        results.push({
          tenantId: connection.tenant_id,
          pageId: connection.page_id,
          status: persisted.status,
          code: health.code,
        });
      }),
    );
  }

  const ready = results.filter((result) => result.status === "ready").length;
  const degraded = results.filter(
    (result) =>
      result.status === "degraded" || result.status === "legacy_grace",
  ).length;
  const actionRequired = results.filter(
    (result) =>
      result.status === "action_required" || result.status === "revoked",
  ).length;
  return {
    ok: actionRequired === 0,
    checked: results.length,
    ready,
    degraded,
    actionRequired,
    grantsChecked: grantDiscovery.checked,
    pagesDiscovered: grantDiscovery.pagesDiscovered,
    results,
  };
}
