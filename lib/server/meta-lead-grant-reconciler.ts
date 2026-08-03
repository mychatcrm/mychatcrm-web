import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MetaGraphRequestError,
  metaGraphErrorCode,
  metaGraphRequest,
} from "@/lib/server/meta-graph-api";
import {
  verifyMetaUserAccessToken,
} from "@/lib/server/meta-lead-connection-health";

type GrantRow = {
  tenant_id: string;
  user_access_token: string;
  credential_fingerprint: string;
  token_kind: string | null;
  token_mode: "business_integration_system_user" | "user" | null;
  client_business_id: string | null;
  oauth_nonce: string;
};

type GrantedPage = {
  id: string;
  name: string;
  access_token: string;
};

type PagesResponse = {
  data?: GrantedPage[];
  paging?: { next?: string };
};

type GrantIdentityResponse = {
  id?: string;
  client_business_id?: string;
};

export type MetaGrantDiscoveryResult = {
  checked: number;
  pagesDiscovered: number;
  retrying: number;
  actionRequired: number;
};

async function updateGrant(
  sb: SupabaseClient,
  grant: GrantRow,
  values: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await sb
    .from("meta_lead_grants")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("tenant_id", grant.tenant_id)
    .eq("credential_fingerprint", grant.credential_fingerprint)
    .eq("oauth_nonce", grant.oauth_nonce)
    .select("tenant_id")
    .maybeSingle<{ tenant_id: string }>();
  if (error) {
    throw new Error(`meta_lead_grant_update_failed:${error.message}`);
  }
  return Boolean(data);
}

async function discoverGrant(params: {
  sb: SupabaseClient;
  grant: GrantRow;
  appId: string;
  appSecret: string;
}): Promise<{
  pages: number;
  status: "ready" | "retrying" | "action_required";
}> {
  const { sb, grant } = params;
  const tokenCheck = await verifyMetaUserAccessToken({
    userAccessToken: grant.user_access_token,
    appId: params.appId,
    appSecret: params.appSecret,
    requireDurable: true,
  });
  if (!tokenCheck.ok) {
    const status = tokenCheck.retryable ? "retrying" : "action_required";
    await updateGrant(sb, grant, {
      discovery_status: status,
      last_error_code: tokenCheck.code,
      next_discovery_at: tokenCheck.retryable
        ? new Date(Date.now() + 15 * 60_000).toISOString()
        : null,
    });
    return { pages: 0, status };
  }

  const pages = new Map<string, GrantedPage>();
  let complete = true;
  let clientBusinessId = grant.client_business_id;
  try {
    const identity = await metaGraphRequest<GrantIdentityResponse>("/me", {
      accessToken: grant.user_access_token,
      searchParams: { fields: "id,client_business_id" },
    });
    clientBusinessId = identity.client_business_id?.trim() || clientBusinessId;
  } catch (error) {
    complete = false;
    console.warn("[meta-grant-reconcile] identity probe failed", {
      tenant_id: grant.tenant_id,
      code: metaGraphErrorCode(error),
    });
  }

  if (
    grant.token_mode === "business_integration_system_user" &&
    !clientBusinessId
  ) {
    const status = complete ? "action_required" : "retrying";
    await updateGrant(sb, grant, {
      discovery_status: status,
      token_kind: tokenCheck.tokenKind ?? grant.token_kind,
      last_error_code: complete
        ? "client_business_missing"
        : "identity_probe_failed",
      next_discovery_at: complete
        ? null
        : new Date(Date.now() + 15 * 60_000).toISOString(),
    });
    return { pages: 0, status };
  }

  const identityUpdated = await updateGrant(sb, grant, {
    token_kind: tokenCheck.tokenKind ?? grant.token_kind,
    client_business_id: clientBusinessId,
  });
  if (!identityUpdated) {
    return { pages: 0, status: "retrying" };
  }

  let nextUrl: string | undefined = "/me/accounts";
  let firstPage = true;
  try {
    for (let pageNumber = 0; nextUrl && pageNumber < 20; pageNumber += 1) {
      const response: PagesResponse = await metaGraphRequest<PagesResponse>(
        nextUrl,
        {
          accessToken: grant.user_access_token,
          searchParams: firstPage
            ? { fields: "id,name,access_token", limit: 100 }
            : undefined,
        },
      );
      firstPage = false;
      for (const page of response.data ?? []) {
        if (page.id && page.name && page.access_token) pages.set(page.id, page);
      }
      nextUrl = response.paging?.next;
    }
    if (nextUrl) complete = false;
  } catch (error) {
    complete = false;
    console.warn("[meta-grant-reconcile] page enumeration failed", {
      tenant_id: grant.tenant_id,
      code: metaGraphErrorCode(error),
    });
  }

  if (pages.size === 0) {
    const targetIds = Array.from(
      new Set(Object.values(tokenCheck.granularScopeTargets).flat()),
    ).slice(0, 100);
    for (let offset = 0; offset < targetIds.length; offset += 5) {
      const batch = targetIds.slice(offset, offset + 5);
      const resolved = await Promise.all(
        batch.map(async (targetId) => {
          try {
            return await metaGraphRequest<GrantedPage>(
              `/${encodeURIComponent(targetId)}`,
              {
                accessToken: grant.user_access_token,
                searchParams: { fields: "id,name,access_token" },
              },
            );
          } catch (error) {
            if (
              error instanceof MetaGraphRequestError &&
              error.retryable
            ) {
              complete = false;
            }
            return null;
          }
        }),
      );
      for (const page of resolved) {
        if (page?.id && page.name && page.access_token) pages.set(page.id, page);
      }
    }
  }

  const now = new Date().toISOString();
  if (pages.size > 0) {
    const { data: applied, error } = await sb.rpc(
      "upsert_meta_grant_discovered_pages_v2",
      {
        p_tenant_id: grant.tenant_id,
        p_expected_grant_fingerprint: grant.credential_fingerprint,
        p_oauth_nonce: grant.oauth_nonce,
        p_pages: Array.from(pages.values()).map((page) => ({
          page_id: page.id,
          page_name: page.name,
          page_access_token: page.access_token,
        })),
      },
    );
    if (error) {
      throw new Error(`meta_grant_pages_upsert_failed:${error.message}`);
    }
    if (applied !== true) {
      return { pages: 0, status: "retrying" };
    }
  }

  const status =
    !complete
      ? "retrying"
      : pages.size > 0
        ? "ready"
        : "action_required";
  await updateGrant(sb, grant, {
    discovery_status: status,
    last_error_code:
      status === "retrying"
        ? "asset_discovery_incomplete"
        : status === "action_required"
          ? "no_pages"
          : null,
    discovered_page_count: pages.size,
    last_discovered_at: complete ? now : null,
    next_discovery_at:
      status === "retrying"
        ? new Date(Date.now() + 15 * 60_000).toISOString()
        : null,
  });
  return { pages: pages.size, status };
}

export async function reconcileMetaLeadGrantDiscovery(params: {
  sb: SupabaseClient;
  appId: string;
  appSecret: string;
  limit?: number;
}): Promise<MetaGrantDiscoveryResult> {
  const now = new Date().toISOString();
  const { data, error } = await params.sb
    .from("meta_lead_grants")
    .select(
      "tenant_id, user_access_token, credential_fingerprint, token_kind, token_mode, client_business_id, oauth_nonce",
    )
    .in("discovery_status", ["pending", "discovering", "retrying"])
    .or(`next_discovery_at.is.null,next_discovery_at.lte.${now}`)
    .order("next_discovery_at", { ascending: true, nullsFirst: true })
    .limit(Math.max(1, Math.min(params.limit ?? 10, 25)))
    .returns<GrantRow[]>();
  if (error) {
    throw new Error(`meta_lead_grants_query_failed:${error.message}`);
  }

  const results: Array<Awaited<ReturnType<typeof discoverGrant>>> = [];
  const grants = data ?? [];
  for (let offset = 0; offset < grants.length; offset += 2) {
    const batch = grants.slice(offset, offset + 2);
    results.push(
      ...(await Promise.all(
        batch.map((grant) =>
          discoverGrant({
            sb: params.sb,
            grant,
            appId: params.appId,
            appSecret: params.appSecret,
          }),
        ),
      )),
    );
  }

  return {
    checked: grants.length,
    pagesDiscovered: results.reduce((total, result) => total + result.pages, 0),
    retrying: results.filter((result) => result.status === "retrying").length,
    actionRequired: results.filter(
      (result) => result.status === "action_required",
    ).length,
  };
}
