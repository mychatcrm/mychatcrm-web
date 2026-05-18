import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { verifyMetaOAuthState } from "@/lib/server/meta-oauth-state";

export const dynamic = "force-dynamic";

const GRAPH = "https://graph.facebook.com/v19.0";

type TokenResponse = {
  access_token?: string;
  token_type?: string;
  error?: { message: string };
};

type FacebookPage = {
  id: string;
  name: string;
  access_token: string;
};

type PagesResponse = {
  data?: FacebookPage[];
  error?: { message: string };
};

type LongLivedTokenResponse = {
  access_token?: string;
  error?: { message: string };
};

/** Handles the Facebook OAuth callback — exchanges code for tokens and saves pages. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const error = params.get("error");

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://mychatcrm.vercel.app").replace(/\/$/, "");
  const redirectBase = `${siteUrl}/dashboard/integracoes`;

  if (error) {
    console.warn("[meta-callback] User denied Facebook OAuth", { error });
    return NextResponse.redirect(`${redirectBase}?meta=denied`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${redirectBase}?meta=error&reason=missing_params`);
  }

  // Verify HMAC state → extract tenantId
  const tenantId = await verifyMetaOAuthState(state);
  if (!tenantId) {
    console.warn("[meta-callback] Invalid or expired OAuth state");
    return NextResponse.redirect(`${redirectBase}?meta=error&reason=invalid_state`);
  }

  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appId || !appSecret) {
    console.error("[meta-callback] META_APP_ID or META_APP_SECRET not set");
    return NextResponse.redirect(`${redirectBase}?meta=error&reason=server_config`);
  }

  const redirectUri = `${siteUrl}/api/meta/callback`;

  // 1. Exchange code for short-lived user access token
  const tokenUrl = new URL(`${GRAPH}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", appId);
  tokenUrl.searchParams.set("client_secret", appSecret);
  tokenUrl.searchParams.set("redirect_uri", redirectUri);
  tokenUrl.searchParams.set("code", code);

  let shortLivedToken: string;
  try {
    const tokenRes = await fetch(tokenUrl.toString(), { signal: AbortSignal.timeout(10_000) });
    const tokenData = (await tokenRes.json()) as TokenResponse;
    if (!tokenData.access_token) {
      console.error("[meta-callback] Token exchange failed", tokenData.error?.message);
      return NextResponse.redirect(`${redirectBase}?meta=error&reason=token_exchange`);
    }
    shortLivedToken = tokenData.access_token;
  } catch (err) {
    console.error("[meta-callback] Token exchange request failed", err instanceof Error ? err.message : String(err));
    return NextResponse.redirect(`${redirectBase}?meta=error&reason=network`);
  }

  // 2. Exchange for long-lived user token
  const longLivedUrl = new URL(`${GRAPH}/oauth/access_token`);
  longLivedUrl.searchParams.set("grant_type", "fb_exchange_token");
  longLivedUrl.searchParams.set("client_id", appId);
  longLivedUrl.searchParams.set("client_secret", appSecret);
  longLivedUrl.searchParams.set("fb_exchange_token", shortLivedToken);

  let userAccessToken: string;
  try {
    const llRes = await fetch(longLivedUrl.toString(), { signal: AbortSignal.timeout(10_000) });
    const llData = (await llRes.json()) as LongLivedTokenResponse;
    // If long-lived exchange fails, fall back to short-lived token
    userAccessToken = llData.access_token ?? shortLivedToken;
  } catch {
    userAccessToken = shortLivedToken;
  }

  // 3. Fetch pages (includes per-page access tokens which are already long-lived)
  const pagesUrl = `${GRAPH}/me/accounts?access_token=${encodeURIComponent(userAccessToken)}&fields=id,name,access_token`;
  let pages: FacebookPage[] = [];
  try {
    const pagesRes = await fetch(pagesUrl, { signal: AbortSignal.timeout(10_000) });
    const pagesData = (await pagesRes.json()) as PagesResponse;
    if (pagesData.error) {
      console.error("[meta-callback] Failed to fetch pages", pagesData.error.message);
      return NextResponse.redirect(`${redirectBase}?meta=error&reason=pages_fetch`);
    }
    pages = pagesData.data ?? [];
  } catch (err) {
    console.error("[meta-callback] Pages fetch request failed", err instanceof Error ? err.message : String(err));
    return NextResponse.redirect(`${redirectBase}?meta=error&reason=network`);
  }

  if (!pages.length) {
    console.warn("[meta-callback] No pages returned for tenant", { tenantId });
    return NextResponse.redirect(`${redirectBase}?meta=no_pages`);
  }

  // 4. Upsert all pages into meta_connections
  const sb = createSupabaseServiceClient();
  const rows = pages.map((p) => ({
    tenant_id: tenantId,
    page_id: p.id,
    page_name: p.name,
    page_access_token: p.access_token,
    user_access_token: userAccessToken,
    updated_at: new Date().toISOString(),
  }));

  const { error: upsertErr } = await sb
    .from("meta_connections")
    .upsert(rows, { onConflict: "tenant_id,page_id" });

  if (upsertErr) {
    console.error("[meta-callback] Failed to save meta_connections", upsertErr.message);
    return NextResponse.redirect(`${redirectBase}?meta=error&reason=db_save`);
  }

  console.info("[meta-callback] Connected Meta pages for tenant", { tenantId, pageCount: pages.length });
  return NextResponse.redirect(`${redirectBase}?meta=connected`);
}
