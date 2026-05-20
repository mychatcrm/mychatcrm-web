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
  error?: { message: string; type?: string; code?: number };
};

type MeResponse = {
  id?: string;
  error?: { message: string };
};

type LongLivedTokenResponse = {
  access_token?: string;
  error?: { message: string };
};

function metaOAuthPublicOrigin(req: NextRequest): string {
  try {
    const origin = req.nextUrl.origin;
    if (origin.startsWith("http://") || origin.startsWith("https://")) {
      // Sempre normaliza para sem-www para que o cookie setado em mychatcrm.com.br
      // seja enviado no redirect imediato (www. e não-www têm scopes de cookie distintos).
      return origin.replace(/\/$/, "").replace(/^(https?:\/\/)www\./, "$1");
    }
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
  sessionRestore?: { tenantId: string; employeeId?: string; employeeEmail?: string },
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
    employeeEmailPresent: Boolean(sessionRestore.employeeEmail),
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
    : await buildClientSessionForTenant(
        sessionRestore.tenantId,
        sessionRestore.employeeId,
        sessionRestore.employeeEmail,
      );

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
      domain: ".mychatcrm.com.br", // válido para mychatcrm.com.br e www.mychatcrm.com.br
    });
    console.info("[meta-callback] cookie set ok", {
      sameSite: "lax",
      domain: ".mychatcrm.com.br",
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

  const { tenantId, employeeId, employeeEmail } = oauthState;
  const sessionRestore = { tenantId, employeeId, employeeEmail };

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
  async function fetchPagesAttempt(
    attempt: string,
    url: string,
  ): Promise<{ pages: FacebookPage[]; apiError?: string }> {
    const pagesRes = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const rawBody: unknown = await pagesRes.json();
    console.info("[meta-callback] pages-fetch attempt", {
      attempt,
      tenantId,
      httpStatus: pagesRes.status,
      httpOk: pagesRes.ok,
      requestUrl: url.replace(userAccessToken, "[REDACTED]"),
      apiResponse: rawBody,
    });
    const pagesData = rawBody as PagesResponse;
    if (pagesData.error) {
      return { pages: [], apiError: pagesData.error.message };
    }
    const rows = (pagesData.data ?? []).filter(
      (p): p is FacebookPage => Boolean(p?.id && p?.name && p?.access_token),
    );
    return { pages: rows };
  }

  let pages: FacebookPage[] = [];
  let pagesFetchError: string | undefined;
  try {
    const attempt1Url = `${GRAPH}/me/accounts?access_token=${encodeURIComponent(userAccessToken)}&fields=id,name,access_token`;
    const attempt1 = await fetchPagesAttempt("me/accounts (fields=id,name,access_token)", attempt1Url);
    pages = attempt1.pages;
    pagesFetchError = attempt1.apiError;

    if (!pages.length) {
      const attempt2Url = `${GRAPH}/me/accounts?access_token=${encodeURIComponent(userAccessToken)}&fields=id,name,access_token,instagram_business_account`;
      const attempt2 = await fetchPagesAttempt(
        "me/accounts (fields=id,name,access_token,instagram_business_account)",
        attempt2Url,
      );
      pages = attempt2.pages;
      pagesFetchError = attempt2.apiError ?? pagesFetchError;

      if (!pages.length) {
        const meUrl = `${GRAPH}/me?access_token=${encodeURIComponent(userAccessToken)}&fields=id`;
        const meRes = await fetch(meUrl, { signal: AbortSignal.timeout(10_000) });
        const meRaw: unknown = await meRes.json();
        console.info("[meta-callback] me/id for accounts fallback", {
          tenantId,
          httpStatus: meRes.status,
          httpOk: meRes.ok,
          requestUrl: meUrl.replace(userAccessToken, "[REDACTED]"),
          apiResponse: meRaw,
        });
        const meData = meRaw as MeResponse;
        const userId = meData.id;
        if (userId) {
          const attempt3Url = `${GRAPH}/${userId}/accounts?access_token=${encodeURIComponent(userAccessToken)}`;
          const attempt3 = await fetchPagesAttempt(`${userId}/accounts (no field filters)`, attempt3Url);
          pages = attempt3.pages;
          pagesFetchError = attempt3.apiError ?? pagesFetchError;
        } else {
          console.warn("[meta-callback] Could not resolve user id for accounts fallback", {
            tenantId,
            meError: meData.error?.message,
          });
        }
      }
    }
  } catch (err) {
    console.error("[meta-callback] Pages fetch request failed", err instanceof Error ? err.message : String(err));
    return redirectToIntegracoes(req, "meta=error&reason=network", sessionRestore);
  }

  if (pagesFetchError && !pages.length) {
    console.error("[meta-callback] Failed to fetch pages after all attempts", { message: pagesFetchError });
    return redirectToIntegracoes(req, "meta=error&reason=pages_fetch", sessionRestore);
  }

  if (!pages.length) {
    console.warn("[meta-callback] No pages returned for tenant after all attempts", { tenantId });
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
