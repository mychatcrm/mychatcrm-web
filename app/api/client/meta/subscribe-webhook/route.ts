import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  fetchPageSubscribedApps,
  pageHasLeadgenSubscription,
  subscribePageToLeadgenWebhooks,
} from "@/lib/server/meta-page-webhook-subscribe";

export const dynamic = "force-dynamic";

type ConnectionRow = { page_id: string; page_name: string | null; page_access_token: string };

/**
 * Re-subscreve todas as páginas Meta do tenant para webhooks leadgen/leadgen_update.
 * Útil quando o callback URL está correcto mas a página não estava ligada ao app.
 */
export async function POST(): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const appId = process.env.META_APP_ID?.trim();
  if (!appId) {
    return NextResponse.json({ error: "META_APP_ID não configurado no servidor." }, { status: 503 });
  }

  const sb = createSupabaseServiceClient();
  const { data: connections, error } = await sb
    .from("meta_connections")
    .select("page_id, page_name, page_access_token")
    .eq("tenant_id", session.tenantId)
    .returns<ConnectionRow[]>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!connections?.length) {
    return NextResponse.json({ error: "Nenhuma página Meta conectada." }, { status: 404 });
  }

  const results = [];
  for (const conn of connections) {
    const before = await fetchPageSubscribedApps(conn.page_id, conn.page_access_token);
    const wasSubscribed = pageHasLeadgenSubscription(before, appId);
    const subscribe = wasSubscribed
      ? { pageId: conn.page_id, ok: true, subscribedFields: before.apps.find((a) => a.appId === appId)?.subscribedFields }
      : await subscribePageToLeadgenWebhooks(conn.page_id, conn.page_access_token);
    const after = await fetchPageSubscribedApps(conn.page_id, conn.page_access_token);
    results.push({
      page_id: conn.page_id,
      page_name: conn.page_name,
      was_subscribed: wasSubscribed,
      subscribe,
      subscribed_apps: after.apps,
    });
  }

  console.info("[meta/subscribe-webhook] tenant subscribed pages", {
    tenantId: session.tenantId,
    pageCount: results.length,
    okCount: results.filter((r) => r.subscribe.ok).length,
  });

  const okCount = results.filter((result) => result.subscribe.ok).length;
  const allOk = okCount === results.length;
  return NextResponse.json(
    {
      ok: allOk,
      app_id: appId,
      webhook_url: "https://www.mychatcrm.com.br/api/webhooks/meta",
      pages: results,
    },
    { status: allOk ? 200 : okCount > 0 ? 207 : 409 },
  );
}
