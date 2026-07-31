import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { notifyTenantIntegrationDisconnected } from "@/lib/server/integration-disconnect-notifications";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { metaGraphRequest } from "@/lib/server/meta-graph-api";

export const dynamic = "force-dynamic";

type MetaConnectionTokenRow = {
  user_access_token: string | null;
  user_token_fingerprint: string | null;
  token_kind: string | null;
  client_business_id: string | null;
};

type DeletedMetaConnectionRow = {
  page_id: string;
  page_name: string | null;
};

type MetaMeResponse = {
  id?: string;
  error?: { message?: string };
};

type MetaPermissionsResponse = {
  success?: boolean;
  error?: { message?: string };
};

async function revokeFacebookUserToken(userAccessToken: string): Promise<{
  ok: boolean;
  userId?: string;
  error?: string;
}> {
  try {
    const meData = await metaGraphRequest<MetaMeResponse>("/me", {
      accessToken: userAccessToken,
      searchParams: { fields: "id" },
    });
    const userId = meData.id;

    if (!userId) {
      return { ok: false, error: meData.error?.message ?? "Could not resolve Facebook user id." };
    }

    const permissionsData = await metaGraphRequest<MetaPermissionsResponse>(
      `/${encodeURIComponent(userId)}/permissions`,
      {
        accessToken: userAccessToken,
        method: "DELETE",
      },
    );

    return { ok: permissionsData.success !== false, userId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Disconnects all Meta pages for the authenticated tenant. */
export async function DELETE(): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const sb = createSupabaseServiceClient();

  const { data: tokenRows, error: tokenRowsError } = await sb
    .from("meta_connections")
    .select(
      "user_access_token, user_token_fingerprint, token_kind, client_business_id",
    )
    .eq("tenant_id", session.tenantId)
    .returns<MetaConnectionTokenRow[]>();

  if (tokenRowsError) {
    return NextResponse.json({ error: tokenRowsError.message }, { status: 500 });
  }
  const { data: grantRow, error: grantRowError } = await sb
    .from("meta_lead_grants")
    .select(
      "user_access_token, user_token_fingerprint, token_kind, client_business_id",
    )
    .eq("tenant_id", session.tenantId)
    .maybeSingle<MetaConnectionTokenRow>();
  if (grantRowError) {
    return NextResponse.json({ error: grantRowError.message }, { status: 500 });
  }

  const grantsByFingerprint = new Map<
    string,
    {
      userAccessToken: string;
      tokenKind: string | null;
      clientBusinessId: string | null;
    }
  >();
  for (const row of [...(tokenRows ?? []), ...(grantRow ? [grantRow] : [])]) {
    const token = row.user_access_token?.trim();
    const fingerprint = row.user_token_fingerprint?.trim();
    if (!token || !fingerprint || grantsByFingerprint.has(fingerprint)) continue;
    grantsByFingerprint.set(fingerprint, {
      userAccessToken: token,
      tokenKind: row.token_kind?.trim() || null,
      clientBusinessId: row.client_business_id?.trim() || null,
    });
  }
  const grants = Array.from(grantsByFingerprint.entries()).map(
    ([fingerprint, grant]) => ({ fingerprint, ...grant }),
  );

  // Remove dependent mappings first, then the actual page connections for this tenant.
  const mappingResult = await sb.from("meta_form_agent_mapping").delete().eq("tenant_id", session.tenantId);
  if (mappingResult.error) {
    return NextResponse.json({ error: mappingResult.error.message }, { status: 500 });
  }

  const connResult = await sb
    .from("meta_connections")
    .delete()
    .eq("tenant_id", session.tenantId)
    .select("page_id, page_name");
  if (connResult.error) {
    return NextResponse.json({ error: connResult.error.message }, { status: 500 });
  }
  const grantDeleteResult = await sb
    .from("meta_lead_grants")
    .delete()
    .eq("tenant_id", session.tenantId);
  if (grantDeleteResult.error) {
    return NextResponse.json(
      { error: grantDeleteResult.error.message },
      { status: 500 },
    );
  }

  const { count: remainingConnections, error: verifyError } = await sb
    .from("meta_connections")
    .select("page_id", { count: "exact", head: true })
    .eq("tenant_id", session.tenantId);

  if (verifyError) {
    return NextResponse.json({ error: verifyError.message }, { status: 500 });
  }

  if ((remainingConnections ?? 0) > 0) {
    return NextResponse.json({ error: "Meta connections could not be fully disconnected." }, { status: 500 });
  }

  const revokeResults = await Promise.all(
    grants.map(async (grant) => {
      const isBusinessSystemGrant =
        Boolean(grant.clientBusinessId) ||
        grant.tokenKind?.toUpperCase().includes("SYSTEM_USER") === true;
      if (isBusinessSystemGrant) {
        return {
          ok: false,
          skipped: true,
          error: "business_integration_grant_preserved",
        };
      }

      const { count: tokenReferences, error: tokenReferencesError } = await sb
        .from("meta_connections")
        .select("page_id", { count: "exact", head: true })
        .eq("user_token_fingerprint", grant.fingerprint);
      if (tokenReferencesError) {
        return {
          ok: false,
          skipped: true,
          error: "grant_reference_check_failed",
        };
      }
      if ((tokenReferences ?? 0) > 0) {
        return {
          ok: false,
          skipped: true,
          error: "grant_still_referenced",
        };
      }
      const { count: grantReferences, error: grantReferencesError } = await sb
        .from("meta_lead_grants")
        .select("tenant_id", { count: "exact", head: true })
        .eq("user_token_fingerprint", grant.fingerprint);
      if (grantReferencesError) {
        return {
          ok: false,
          skipped: true,
          error: "grant_reference_check_failed",
        };
      }
      if ((grantReferences ?? 0) > 0) {
        return {
          ok: false,
          skipped: true,
          error: "grant_still_referenced",
        };
      }
      return {
        ...(await revokeFacebookUserToken(grant.userAccessToken)),
        skipped: false,
      };
    }),
  );
  const revokedCount = revokeResults.filter((result) => result.ok).length;
  const revokeSkippedCount = revokeResults.filter((result) => result.skipped).length;
  const revokeErrorCount = revokeResults.length - revokedCount - revokeSkippedCount;

  if (revokeErrorCount > 0) {
    console.warn("[meta-disconnect] facebook revoke failed", {
      tenant_id: session.tenantId,
      revoke_error_count: revokeErrorCount,
      token_count: grants.length,
      errors: revokeResults.filter((result) => !result.ok).map((result) => result.error ?? "unknown_error"),
    });
  }

  const deletedConnections = (connResult.data ?? []) as DeletedMetaConnectionRow[];
  await Promise.allSettled(
    deletedConnections.map((conn) =>
      notifyTenantIntegrationDisconnected({
        tenantId: session.tenantId,
        integration: "facebook",
        source: "meta_manual_disconnect",
        sourceKey: conn.page_id,
        pageId: conn.page_id,
        pageName: conn.page_name,
        state: "deleted",
        manual: true,
        metadata: {
          facebook_tokens_found: grants.length,
          facebook_tokens_revoked: revokedCount,
          facebook_tokens_preserved: revokeSkippedCount,
          facebook_revoke_errors: revokeErrorCount,
        },
      }),
    ),
  );

  console.info("[meta-disconnect]", {
    tenant_id: session.tenantId,
    deleted_connections: connResult.data?.length ?? 0,
    remaining_connections: remainingConnections ?? 0,
    facebook_tokens_found: grants.length,
    facebook_tokens_revoked: revokedCount,
    facebook_tokens_preserved: revokeSkippedCount,
    facebook_revoke_errors: revokeErrorCount,
  });

  return NextResponse.json({
    ok: true,
    deleted_connections: connResult.data?.length ?? 0,
    remaining_connections: remainingConnections ?? 0,
    facebook_tokens_found: grants.length,
    facebook_tokens_revoked: revokedCount,
    facebook_tokens_preserved: revokeSkippedCount,
    facebook_revoke_errors: revokeErrorCount,
  });
}
