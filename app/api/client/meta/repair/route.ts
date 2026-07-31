import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  buildMetaConnectionFailureHealth,
  persistMetaConnectionHealth,
  verifyMetaAppLeadgenWebhook,
  verifyMetaPageLeadConnection,
  verifyMetaUserAccessToken,
} from "@/lib/server/meta-lead-connection-health";

export const dynamic = "force-dynamic";

type ConnectionRow = {
  page_id: string;
  page_name: string | null;
  page_access_token: string;
  user_access_token: string | null;
  credential_fingerprint: string;
};

/** Idempotently verifies and repairs every Meta Lead Ads page for this tenant. */
export async function POST(): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appId || !appSecret) {
    return NextResponse.json(
      { error: "A integração Meta não está configurada no servidor." },
      { status: 503 },
    );
  }

  const sb = createSupabaseServiceClient();
  const { data: connections, error } = await sb
    .from("meta_connections")
    .select(
      "page_id, page_name, page_access_token, user_access_token, credential_fingerprint",
    )
    .eq("tenant_id", session.tenantId)
    .returns<ConnectionRow[]>();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!connections?.length) {
    return NextResponse.json({ error: "Nenhuma Página Meta conectada." }, { status: 404 });
  }

  const appWebhook = await verifyMetaAppLeadgenWebhook({ appId, appSecret });
  const tokenChecks = new Map<
    string,
    Awaited<ReturnType<typeof verifyMetaUserAccessToken>>
  >();
  const results = [];

  for (const connection of connections) {
    const userAccessToken = connection.user_access_token?.trim();
    if (!userAccessToken) {
      const missingTokenHealth = buildMetaConnectionFailureHealth({
        code: "user_token_missing",
        appWebhook,
      });
      let persisted;
      try {
        persisted = await persistMetaConnectionHealth({
          sb,
          tenantId: session.tenantId,
          pageId: connection.page_id,
          health: missingTokenHealth,
          expectedCredentialFingerprint: connection.credential_fingerprint,
        });
      } catch (persistError) {
        return NextResponse.json(
          {
            error: `Falha ao salvar a verificação: ${
              persistError instanceof Error ? persistError.message : String(persistError)
            }`,
          },
          { status: 500 },
        );
      }
      results.push({
        page_id: connection.page_id,
        page_name: connection.page_name,
        status: persisted.status,
        code: "user_token_missing",
        message: missingTokenHealth.message,
      });
      continue;
    }

    let tokenCheck = tokenChecks.get(userAccessToken);
    if (!tokenCheck) {
      tokenCheck = await verifyMetaUserAccessToken({
        userAccessToken,
        appId,
        appSecret,
        requireDurable: true,
      });
      tokenChecks.set(userAccessToken, tokenCheck);
    }

    const health = await verifyMetaPageLeadConnection({
      pageId: connection.page_id,
      pageAccessToken: connection.page_access_token,
      tokenCheck,
      appWebhook,
    });
    const persisted = await persistMetaConnectionHealth({
      sb,
      tenantId: session.tenantId,
      pageId: connection.page_id,
      health,
      expectedCredentialFingerprint: connection.credential_fingerprint,
    });
    results.push({
      page_id: connection.page_id,
      page_name: connection.page_name,
      status: persisted.status,
      code: health.code,
      message: health.message,
    });
  }

  const readyCount = results.filter((result) => result.status === "ready").length;
  const allReady = readyCount === results.length;
  console.info("[meta/repair] verification complete", {
    tenantId: session.tenantId,
    pageCount: results.length,
    readyCount,
    appWebhookVerified: appWebhook.ok,
  });

  return NextResponse.json(
    {
      ok: allReady,
      ready_count: readyCount,
      total_count: results.length,
      pages: results,
    },
    {
      status: allReady ? 200 : readyCount > 0 ? 207 : 409,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
