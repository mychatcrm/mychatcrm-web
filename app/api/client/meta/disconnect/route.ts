import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const GRAPH = "https://graph.facebook.com/v19.0";

type MetaConnectionTokenRow = {
  user_access_token: string | null;
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
    const meUrl = `${GRAPH}/me?fields=id&access_token=${encodeURIComponent(userAccessToken)}`;
    const meRes = await fetch(meUrl, { signal: AbortSignal.timeout(10_000) });
    const meData = (await meRes.json()) as MetaMeResponse;
    const userId = meData.id;

    if (!userId) {
      return { ok: false, error: meData.error?.message ?? "Could not resolve Facebook user id." };
    }

    const permissionsUrl = `${GRAPH}/${encodeURIComponent(userId)}/permissions?access_token=${encodeURIComponent(userAccessToken)}`;
    const permissionsRes = await fetch(permissionsUrl, {
      method: "DELETE",
      signal: AbortSignal.timeout(10_000),
    });
    const permissionsData = (await permissionsRes.json()) as MetaPermissionsResponse;

    if (!permissionsRes.ok || permissionsData.error) {
      return {
        ok: false,
        userId,
        error: permissionsData.error?.message ?? `Facebook permissions revoke failed with HTTP ${permissionsRes.status}.`,
      };
    }

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
    .select("user_access_token")
    .eq("tenant_id", session.tenantId)
    .returns<MetaConnectionTokenRow[]>();

  if (tokenRowsError) {
    return NextResponse.json({ error: tokenRowsError.message }, { status: 500 });
  }

  const userAccessTokens = Array.from(
    new Set((tokenRows ?? []).map((row) => row.user_access_token?.trim()).filter((token): token is string => Boolean(token))),
  );

  // Remove dependent mappings first, then the actual page connections for this tenant.
  const mappingResult = await sb.from("meta_form_agent_mapping").delete().eq("tenant_id", session.tenantId);
  if (mappingResult.error) {
    return NextResponse.json({ error: mappingResult.error.message }, { status: 500 });
  }

  const connResult = await sb.from("meta_connections").delete().eq("tenant_id", session.tenantId).select("page_id");
  if (connResult.error) {
    return NextResponse.json({ error: connResult.error.message }, { status: 500 });
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

  const revokeResults = await Promise.all(userAccessTokens.map((token) => revokeFacebookUserToken(token)));
  const revokedCount = revokeResults.filter((result) => result.ok).length;
  const revokeErrorCount = revokeResults.length - revokedCount;

  if (revokeErrorCount > 0) {
    console.warn("[meta-disconnect] facebook revoke failed", {
      tenant_id: session.tenantId,
      revoke_error_count: revokeErrorCount,
      token_count: userAccessTokens.length,
      errors: revokeResults.filter((result) => !result.ok).map((result) => result.error ?? "unknown_error"),
    });
  }

  console.info("[meta-disconnect]", {
    tenant_id: session.tenantId,
    deleted_connections: connResult.data?.length ?? 0,
    remaining_connections: remainingConnections ?? 0,
    facebook_tokens_found: userAccessTokens.length,
    facebook_tokens_revoked: revokedCount,
    facebook_revoke_errors: revokeErrorCount,
  });

  return NextResponse.json({
    ok: true,
    deleted_connections: connResult.data?.length ?? 0,
    remaining_connections: remainingConnections ?? 0,
    facebook_tokens_found: userAccessTokens.length,
    facebook_tokens_revoked: revokedCount,
    facebook_revoke_errors: revokeErrorCount,
  });
}
