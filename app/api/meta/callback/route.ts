import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  CLIENT_SESSION_COOKIE,
  clientSessionCookieOptions,
  encodeClientSessionCookieValue,
  getClientSessionByToken,
} from "@/lib/client-auth";
import { SITE_URL } from "@/lib/constants";
import { buildClientSessionForTenant } from "@/lib/server/client-session-from-tenant";
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

function metaOAuthPublicOrigin(req: NextRequest): string {
  try {
    const origin = req.nextUrl.origin;
    if (origin.startsWith("http://") || origin.startsWith("https://")) return origin.replace(/\/$/, "");
  } catch {
    /* fall through */
  }
  return SITE_URL.replace(/\/$/, "");
}

function metaOAuthRedirectUri(siteUrl: string): string {
  return `${siteUrl}/api/meta/callback`;
}

/**
 * Redirect para integrações; repõe cookie de sessão quando o retorno OAuth não o envia.
 *
 * SameSite=strict: o cookie existente NÃO chega ao callback (request vem de facebook.com —
 * contexto cross-site). Reconstituímos a sessão via buildClientSessionForTenant e setamos
 * um novo cookie com SameSite=lax para que o browser o envie no redirect imediato.
 */
async function redirectToIntegracoes(
  req: NextRequest,
  query: string,
  sessionRestore?: { tenantId: string; employeeId?: string },
): Promise<NextResponse> {
  const origin = metaOAuthPublicOrigin(req);
  const response = NextResponse.redirect(`${origin}/dashboard/integracoes?${query}`);

  if (!sessionRestore) return response;

  // 1. O cookie SameSite=strict NÃO chega neste callback (cross-site desde facebook.com).
  //    Tentamos mesmo assim para o caso de futuros ajustes ou testes locais.
  const existingToken = req.cookies.get(CLIENT_SESSION_COOKIE)?.value;
  console.info("[meta-callback] session-restore start", {
    tenantId: sessionRestore.tenantId,
    employeeId: sessionRestore.employeeId ?? null,
    existingCookiePresent: Boolean(existingToken),
  });

  const existing = existingToken ? await getClientSessionByToken(existingToken) : null;
  const canReuseExisting =
    existing?.tenantId === sessionRestore.tenantId &&
    existing.status !== "cancelada" &&
    !existing.accountSuspended;

  console.info("[meta-callback] existing-session", {
    found: Boolean(existing),
    canReuse: canReuseExisting,
  });

  // 2. Se não puder reutilizar a sessão existente, reconstrói a partir do Supabase.
  const session = canReuseExisting
    ? existing
    : await buildClientSessionForTenant(sessionRestore.tenantId, sessionRestore.employeeId);

  console.info("[meta-callback] built-session", {
    present: Boolean(session),
    token: session?.token?.slice(0, 12) ?? null,
  });

  if (!session) {
    console.warn("[meta-callback] Could not restore client session — redirecting without cookie", {
      tenantId: sessionRestore.tenantId,
    });
    return response;
  }

  // 3. Serializa a sessão em cookie assinado (mc1.*) — cross-process safe no Vercel.
  //    SameSite=lax (em vez de strict) para que o browser envie o cookie no redirect
  //    imediato que ainda carrega o contexto de navegação cross-site do OAuth.
  try {
    const cookieValue = await encodeClientSessionCookieValue(session);
    const baseOpts = clientSessionCookieOptions();
    response.cookies.set({
      ...baseOpts,
      value: cookieValue,
      sameSite: "lax", // override: strict bloqueia envio em redirect cross-site (OAuth)
    });
    console.info("[meta-callback] cookie set ok", {
      sameSite: "lax",
      secure: baseOpts.secure,
      valuePrefix: cookieValue.slice(0, 8),
    });
  } catch (err) {
    console.error("[meta-callback] Failed to set session cookie", err instanceof Error ? err.message : String(err));
  }

  return response;
}

/** Handles the Facebook OAuth callback — exchanges code for tokens and saves pages. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const error = params.get("error");

  const siteUrl = metaOAuthPublicOrigin(req);
  const tokenExchangeSiteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? siteUrl).replace(/\/$/, "");

  if (error) {
    console.warn("[meta-callback] User denied Facebook OAuth", { error });
    return redirectToIntegracoes(req, "meta=denied");
  }

  if (!code || !state) {
    return redirectToIntegracoes(req, "meta=error&reason=missing_params");
  }

  const oauthState = await verifyMetaOAuthState(state);
  if (!oauthState) {
    console.warn("[meta-callback] Invalid or expired OAuth state");
    return redirectToIntegracoes(req, "meta=error&reason=invalid_state");
  }

  const { tenantId, employeeId } = oauthState;
  const sessionRestore = { tenantId, employeeId };

  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appId || !appSecret) {
    console.error("[meta-callback] META_APP_ID or META_APP_SECRET not set");
    return redirectToIntegracoes(req, "meta=error&reason=server_config", sessionRestore);
  }

  const redirectUri = metaOAuthRedirectUri(tokenExchangeSiteUrl);

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
      return redirectToIntegracoes(req, "meta=error&reason=token_exchange", sessionRestore);
    }
    shortLivedToken = tokenData.access_token;
  } catch (err) {
    console.error("[meta-callback] Token exchange request failed", err instanceof Error ? err.message : String(err));
    return redirectToIntegracoes(req, "meta=error&reason=network", sessionRestore);
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
      return redirectToIntegracoes(req, "meta=error&reason=pages_fetch", sessionRestore);
    }
    pages = pagesData.data ?? [];
  } catch (err) {
    console.error("[meta-callback] Pages fetch request failed", err instanceof Error ? err.message : String(err));
    return redirectToIntegracoes(req, "meta=error&reason=network", sessionRestore);
  }

  if (!pages.length) {
    console.warn("[meta-callback] No pages returned for tenant", { tenantId });
    return redirectToIntegracoes(req, "meta=no_pages", sessionRestore);
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
    return redirectToIntegracoes(req, "meta=error&reason=db_save", sessionRestore);
  }

  console.info("[meta-callback] Connected Meta pages for tenant", { tenantId, pageCount: pages.length });
  return redirectToIntegracoes(req, "meta=connected", sessionRestore);
}
