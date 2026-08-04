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
import { notifyTenantIntegrationConnected } from "@/lib/server/integration-disconnect-notifications";
import { verifyMetaOAuthState } from "@/lib/server/meta-oauth-state";
import {
  META_GRAPH_BASE_URL,
  MetaGraphRequestError,
  metaGraphErrorCode,
  metaGraphRequest,
} from "@/lib/server/meta-graph-api";
import { metaLeadsBusinessLoginConfiguration } from "@/lib/server/meta-leads-config";
import {
  metaCredentialFingerprint,
  persistMetaConnectionHealth,
  verifyMetaAppLeadgenWebhook,
  verifyMetaPageLeadConnection,
  verifyMetaUserAccessToken,
} from "@/lib/server/meta-lead-connection-health";
import { restoreMetaLeadRuleArtifactsForReadyPages } from "@/lib/server/lead-rules-meta-sync";
import { upsertWhatsAppCloudConnection } from "@/lib/server/whatsapp-cloud-connections";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const META_LEADS_GRAPH = META_GRAPH_BASE_URL;
// Keep WhatsApp onboarding isolated from Lead Ads version/config rollouts.
const WHATSAPP_GRAPH = "https://graph.facebook.com/v24.0";

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
  paging?: { next?: string };
  error?: { message: string; type?: string; code?: number };
};

type MeResponse = {
  id?: string;
  client_business_id?: string;
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

type WabaListResponse = { data?: { id: string }[]; error?: { message: string } };
type WaPhoneNumbersResponse = {
  data?: { id: string; display_phone_number?: string; verified_name?: string }[];
  error?: { message: string };
};

/**
 * WhatsApp Cloud API branch — triggered when oauthState.flow === "whatsapp".
 * Exchanges code for a long-lived token, discovers the first phone number from the
 * connected WABA, and saves it to whatsapp_cloud_connections.
 * 100% isolated from the Lead Ads flow.
 */
async function handleWhatsAppCloudCallback(
  req: NextRequest,
  code: string,
  sessionRestore: { tenantId: string; employeeId?: string; employeeEmail?: string },
  tokenExchangeSiteUrl: string,
): Promise<NextResponse> {
  const { tenantId } = sessionRestore;

  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appId || !appSecret) {
    console.error("[meta-callback/whatsapp] META_APP_ID or META_APP_SECRET not set");
    return redirectToIntegracoes(req, "whatsapp=error&reason=server_config", sessionRestore);
  }

  const redirectUri = metaOAuthRedirectUri(tokenExchangeSiteUrl);

  // 1. Exchange code → short-lived token
  const tokenUrl = new URL(`${WHATSAPP_GRAPH}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", appId);
  tokenUrl.searchParams.set("client_secret", appSecret);
  tokenUrl.searchParams.set("redirect_uri", redirectUri);
  tokenUrl.searchParams.set("code", code);

  let shortLivedToken: string;
  try {
    const tokenRes = await fetch(tokenUrl.toString(), { signal: AbortSignal.timeout(10_000) });
    const tokenData = (await tokenRes.json()) as TokenResponse;
    if (!tokenData.access_token) {
      console.error("[meta-callback/whatsapp] Token exchange failed", tokenData.error?.message);
      return redirectToIntegracoes(req, "whatsapp=error&reason=token_exchange", sessionRestore);
    }
    shortLivedToken = tokenData.access_token;
  } catch (err) {
    console.error("[meta-callback/whatsapp] Token exchange request failed", err instanceof Error ? err.message : String(err));
    return redirectToIntegracoes(req, "whatsapp=error&reason=network", sessionRestore);
  }

  // 2. Exchange → long-lived token
  const longLivedUrl = new URL(`${WHATSAPP_GRAPH}/oauth/access_token`);
  longLivedUrl.searchParams.set("grant_type", "fb_exchange_token");
  longLivedUrl.searchParams.set("client_id", appId);
  longLivedUrl.searchParams.set("client_secret", appSecret);
  longLivedUrl.searchParams.set("fb_exchange_token", shortLivedToken);

  let accessToken: string;
  try {
    const llRes = await fetch(longLivedUrl.toString(), { signal: AbortSignal.timeout(10_000) });
    const llData = (await llRes.json()) as LongLivedTokenResponse;
    accessToken = llData.access_token ?? shortLivedToken;
  } catch {
    accessToken = shortLivedToken;
  }

  // 3. List WABAs accessible with this token.
  //    Try /me/whatsapp_business_accounts first; if empty, fall back to
  //    WABAs accessible via Business Manager portfolios the user manages.
  //    (Businesses owned through BM are NOT returned by the direct /me endpoint.)
  let wabaId: string | null = null;

  try {
    const wabasUrl = `${WHATSAPP_GRAPH}/me/whatsapp_business_accounts?access_token=${encodeURIComponent(accessToken)}&fields=id&limit=5`;
    const wabasRes = await fetch(wabasUrl, { signal: AbortSignal.timeout(10_000) });
    const wabasData = (await wabasRes.json()) as WabaListResponse;
    wabaId = wabasData.data?.[0]?.id ?? null;
    console.info("[meta-callback/whatsapp] WABAs (me/whatsapp_business_accounts)", {
      tenantId, count: wabasData.data?.length ?? 0, wabaId, apiError: wabasData.error?.message ?? null,
    });
  } catch (err) {
    console.warn("[meta-callback/whatsapp] WABA list (me) failed", err instanceof Error ? err.message : String(err));
  }

  // Fallback: enumerate Business Manager portfolios the user manages and look for WABAs there.
  if (!wabaId) {
    try {
      const bizUrl = `${WHATSAPP_GRAPH}/me/businesses?access_token=${encodeURIComponent(accessToken)}&fields=id,name&limit=10`;
      const bizRes = await fetch(bizUrl, { signal: AbortSignal.timeout(10_000) });
      const bizData = (await bizRes.json()) as { data?: { id: string; name?: string }[]; error?: { message: string } };
      console.info("[meta-callback/whatsapp] businesses (me/businesses)", {
        tenantId, count: bizData.data?.length ?? 0, apiError: bizData.error?.message ?? null,
      });

      for (const biz of bizData.data ?? []) {
        if (wabaId) break;

        // Owned WABAs
        try {
          const ownedUrl = `${WHATSAPP_GRAPH}/${encodeURIComponent(biz.id)}/owned_whatsapp_business_accounts?access_token=${encodeURIComponent(accessToken)}&fields=id&limit=5`;
          const ownedRes = await fetch(ownedUrl, { signal: AbortSignal.timeout(10_000) });
          const ownedData = (await ownedRes.json()) as WabaListResponse;
          wabaId = ownedData.data?.[0]?.id ?? null;
          console.info("[meta-callback/whatsapp] owned WABAs", {
            tenantId, bizId: biz.id, bizName: biz.name ?? null, count: ownedData.data?.length ?? 0, wabaId, apiError: ownedData.error?.message ?? null,
          });
        } catch (e) {
          console.warn("[meta-callback/whatsapp] owned WABAs fetch failed", e instanceof Error ? e.message : String(e));
        }

        if (wabaId) break;

        // Client WABAs
        try {
          const clientUrl = `${WHATSAPP_GRAPH}/${encodeURIComponent(biz.id)}/client_whatsapp_business_accounts?access_token=${encodeURIComponent(accessToken)}&fields=id&limit=5`;
          const clientRes = await fetch(clientUrl, { signal: AbortSignal.timeout(10_000) });
          const clientData = (await clientRes.json()) as WabaListResponse;
          wabaId = clientData.data?.[0]?.id ?? null;
          console.info("[meta-callback/whatsapp] client WABAs", {
            tenantId, bizId: biz.id, bizName: biz.name ?? null, count: clientData.data?.length ?? 0, wabaId, apiError: clientData.error?.message ?? null,
          });
        } catch (e) {
          console.warn("[meta-callback/whatsapp] client WABAs fetch failed", e instanceof Error ? e.message : String(e));
        }
      }
    } catch (err) {
      console.warn("[meta-callback/whatsapp] businesses fallback failed", err instanceof Error ? err.message : String(err));
    }
  }

  // 4. Get phone numbers from the first WABA
  let phoneNumberId: string | null = null;
  let displayPhone: string | null = null;
  let verifiedName: string | null = null;

  if (wabaId) {
    const phonesUrl = `${WHATSAPP_GRAPH}/${encodeURIComponent(wabaId)}/phone_numbers?access_token=${encodeURIComponent(accessToken)}&fields=id,display_phone_number,verified_name`;
    try {
      const phonesRes = await fetch(phonesUrl, { signal: AbortSignal.timeout(10_000) });
      const phonesData = (await phonesRes.json()) as WaPhoneNumbersResponse;
      const first = phonesData.data?.[0];
      if (first) {
        phoneNumberId = first.id;
        displayPhone = first.display_phone_number ?? null;
        verifiedName = first.verified_name ?? null;
      }
      console.info("[meta-callback/whatsapp] Phone numbers fetched", { tenantId, wabaId, count: phonesData.data?.length ?? 0, phoneNumberId, apiError: phonesData.error?.message ?? null });
    } catch (err) {
      console.warn("[meta-callback/whatsapp] Phone numbers fetch failed", err instanceof Error ? err.message : String(err));
    }
  }

  if (!phoneNumberId) {
    console.warn("[meta-callback/whatsapp] No phone number found for tenant", { tenantId, wabaId });
    return redirectToIntegracoes(req, "whatsapp=no_numbers", sessionRestore);
  }

  // 5. Save to DB
  const { error: dbErr } = await upsertWhatsAppCloudConnection({
    tenantId,
    slotIndex: 0,
    phoneNumberId,
    wabaId,
    accessToken,
    displayPhone,
    verifiedName,
  });
  if (dbErr) {
    console.error("[meta-callback/whatsapp] DB save failed", dbErr);
    return redirectToIntegracoes(req, "whatsapp=error&reason=db_save", sessionRestore);
  }

  console.info("[meta-callback/whatsapp] Connected WhatsApp Cloud for tenant", { tenantId, phoneNumberId, displayPhone });
  return redirectToIntegracoes(req, "whatsapp=connected", sessionRestore);
}

/** Handles the Facebook OAuth callback — exchanges code for tokens and saves pages. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const callbackStartedAt = Date.now();
  const params = req.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const error = params.get("error");

  // Must be byte-for-byte identical to the redirect_uri created by /connect.
  const tokenExchangeSiteUrl = SITE_URL.replace(/\/$/, "");

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

  // ── WhatsApp Cloud API (Embedded Signup) — completely isolated branch ─────
  if (oauthState.flow === "whatsapp") {
    return handleWhatsAppCloudCallback(req, code, sessionRestore, tokenExchangeSiteUrl);
  }

  const oauthNonce = oauthState.nonce?.trim();
  if (!oauthNonce) {
    return redirectToIntegracoes(req, "meta=error&reason=invalid_state", sessionRestore);
  }
  const oauthSb = createSupabaseServiceClient();
  const { data: callbackClaimed, error: callbackClaimError } = await oauthSb.rpc(
    "claim_meta_lead_oauth_callback",
    { p_tenant_id: tenantId, p_nonce: oauthNonce },
  );
  if (callbackClaimError || callbackClaimed !== true) {
    console.info("[meta-callback] stale or replayed callback rejected", { tenantId });
    return redirectToIntegracoes(req, "meta=error&reason=stale_callback", sessionRestore);
  }

  // ── Lead Ads OAuth (existing code below, untouched) ───────────────────────
  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appId || !appSecret) {
    console.error("[meta-callback] META_APP_ID or META_APP_SECRET not set");
    return redirectToIntegracoes(req, "meta=error&reason=server_config", sessionRestore);
  }

  const redirectUri = metaOAuthRedirectUri(tokenExchangeSiteUrl);

  // 1. Exchange code for short-lived user access token
  const tokenUrl = new URL(`${META_LEADS_GRAPH}/oauth/access_token`);
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

  // 2. Facebook Login for Business with a system-user token already returns
  // the durable business integration token from the code exchange. Legacy
  // OAuth still needs the explicit long-lived exchange, and that exchange must
  // succeed — silently retaining a short token creates a connection that dies
  // days later without warning.
  const { configurationId, tokenMode } = metaLeadsBusinessLoginConfiguration();
  const usesBusinessLoginConfiguration = Boolean(configurationId);
  if (usesBusinessLoginConfiguration && !tokenMode) {
    console.error("[meta-callback] META_LEADS_TOKEN_MODE is missing or invalid");
    return redirectToIntegracoes(req, "meta=error&reason=server_config", sessionRestore);
  }
  let userAccessToken: string;
  if (usesBusinessLoginConfiguration && tokenMode === "business_integration_system_user") {
    userAccessToken = shortLivedToken;
  } else {
    const longLivedUrl = new URL(`${META_LEADS_GRAPH}/oauth/access_token`);
    longLivedUrl.searchParams.set("grant_type", "fb_exchange_token");
    longLivedUrl.searchParams.set("client_id", appId);
    longLivedUrl.searchParams.set("client_secret", appSecret);
    longLivedUrl.searchParams.set("fb_exchange_token", shortLivedToken);

    try {
      const llRes = await fetch(longLivedUrl.toString(), { signal: AbortSignal.timeout(10_000) });
      const llData = (await llRes.json()) as LongLivedTokenResponse;
      if (!llRes.ok || !llData.access_token) {
        console.error("[meta-callback] Long-lived token exchange failed", {
          tenantId,
          httpStatus: llRes.status,
          apiError: llData.error?.message ?? null,
        });
        return redirectToIntegracoes(
          req,
          "meta=error&reason=long_lived_token",
          sessionRestore,
        );
      }
      userAccessToken = llData.access_token;
    } catch (err) {
      console.error(
        "[meta-callback] Long-lived token exchange request failed",
        err instanceof Error ? err.message : String(err),
      );
      return redirectToIntegracoes(req, "meta=error&reason=network", sessionRestore);
    }
  }

  // Validate the grant before it can create an operational connection. The
  // explicit token mode comes from the Meta Business Login configuration,
  // never from the mere presence of a config_id.
  const [tokenCheck, appWebhook] = await Promise.all([
    verifyMetaUserAccessToken({
      userAccessToken,
      appId,
      appSecret,
      requireDurable: true,
    }),
    verifyMetaAppLeadgenWebhook({
      appId,
      appSecret,
    }),
  ]);
  const sb = oauthSb;
  const grantCredentialFingerprint = metaCredentialFingerprint(
    null,
    userAccessToken,
  );
  if (tokenCheck.ok || tokenCheck.retryable) {
    const tokenCheckRetrying = !tokenCheck.ok;
    const { data: savedFingerprint, error: grantError } = await sb.rpc(
      "save_meta_lead_oauth_grant",
      {
        p_tenant_id: tenantId,
        p_nonce: oauthNonce,
        p_user_access_token: userAccessToken,
        p_token_kind: tokenCheck.ok ? tokenCheck.tokenKind : null,
        p_token_mode: tokenMode ?? "user",
        p_discovery_status: tokenCheckRetrying ? "retrying" : "discovering",
        p_last_error_code: tokenCheckRetrying ? tokenCheck.code : null,
        p_next_discovery_at: tokenCheckRetrying
          ? new Date(Date.now() + 15 * 60_000).toISOString()
          : new Date().toISOString(),
      },
    );
    if (grantError || savedFingerprint !== grantCredentialFingerprint) {
      console.error("[meta-callback] Failed to save Meta grant", {
        tenantId,
        error: grantError?.message ?? "stale_callback",
      });
      return redirectToIntegracoes(
        req,
        "meta=error&reason=db_save",
        sessionRestore,
      );
    }
  }
  if (!tokenCheck.ok) {
    if (tokenCheck.retryable) {
      return redirectToIntegracoes(
        req,
        `meta=partial&reason=${encodeURIComponent(
          tokenCheck.code ?? "verification_retrying",
        )}`,
        sessionRestore,
      );
    }
    return redirectToIntegracoes(
      req,
      `meta=action_required&reason=${encodeURIComponent(
        tokenCheck.code ?? "permission_missing",
      )}`,
      sessionRestore,
    );
  }

  // 3. Fetch only assets explicitly returned by the grant. Business Login
  // system-user tokens expose client_business_id; we persist it for auditing
  // but do not enumerate unrelated businesses or infer ownership.
  function addPages(target: Map<string, FacebookPage>, rows: FacebookPage[]) {
    for (const page of rows) {
      if (!target.has(page.id)) target.set(page.id, page);
    }
  }

  const assetDiscoveryDeadline = callbackStartedAt + 35_000;
  let assetDiscoveryIncomplete = false;
  async function fetchPagesAttempt(
    attempt: string,
    path: string,
  ): Promise<FacebookPage[]> {
    const pages: FacebookPage[] = [];
    let nextUrl: string | undefined = path;
    let pageNumber = 0;
    let firstPage = true;

    while (nextUrl && pageNumber < 20) {
      if (Date.now() >= assetDiscoveryDeadline) {
        assetDiscoveryIncomplete = true;
        break;
      }
      pageNumber += 1;
      try {
        const pagesData: PagesResponse = await metaGraphRequest<PagesResponse>(
          nextUrl,
          {
            accessToken: userAccessToken,
            searchParams: firstPage
              ? { fields: "id,name,access_token", limit: 100 }
              : undefined,
          },
        );
        firstPage = false;
        const rows = (pagesData.data ?? []).filter(
          (page): page is FacebookPage =>
            Boolean(page?.id && page?.name && page?.access_token),
        );
        pages.push(...rows);
        console.info("[meta-callback] pages-fetch attempt", {
          attempt,
          tenantId,
          pageNumber,
          rowsReturned: pagesData.data?.length ?? 0,
          validPages: rows.length,
        });
        nextUrl = pagesData.paging?.next;
      } catch (error) {
        assetDiscoveryIncomplete = true;
        console.warn("[meta-callback] pages-fetch failed", {
          attempt,
          tenantId,
          pageNumber,
          code: metaGraphErrorCode(error),
        });
        break;
      }
    }
    if (nextUrl) assetDiscoveryIncomplete = true;

    return pages;
  }

  const collectedPages = new Map<string, FacebookPage>();
  let clientBusinessId: string | null = null;

  // `/me?fields=client_business_id` is useful for auditing Business Login
  // grants, but it is not a prerequisite for discovering Pages. Meta can
  // return a valid token from `/debug_token` while rejecting `/me` for some
  // business-scoped grants. Never turn that optional identity probe into a
  // fatal OAuth callback failure.
  try {
    const meData = await metaGraphRequest<MeResponse>("/me", {
      accessToken: userAccessToken,
      searchParams: { fields: "id,client_business_id" },
    });
    const userId = meData.id;
    clientBusinessId = meData.client_business_id?.trim() || null;
    if (tokenCheck.ok) {
      const { error: grantIdentityError } = await sb
        .from("meta_lead_grants")
        .update({
          client_business_id: clientBusinessId,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("credential_fingerprint", grantCredentialFingerprint)
        .eq("oauth_nonce", oauthNonce);
      if (grantIdentityError) {
        console.warn("[meta-callback] Failed to update Meta grant identity", {
          tenantId,
          error: grantIdentityError.message,
        });
      }
    }
    console.info("[meta-callback] grant identity resolved", {
      tenantId,
      userIdPresent: Boolean(userId),
      clientBusinessIdPresent: Boolean(clientBusinessId),
      tokenMode: tokenMode ?? "legacy_user",
    });
  } catch (error) {
    console.warn("[meta-callback] optional grant identity lookup failed", {
      tenantId,
      code: metaGraphErrorCode(error),
      tokenMode: tokenMode ?? "legacy_user",
    });
  }

  try {
    addPages(
      collectedPages,
      await fetchPagesAttempt("me/accounts", "/me/accounts"),
    );

    // Granular scope target IDs are an authoritative asset hint when a
    // Business Integration System User does not populate /me/accounts.
    if (collectedPages.size === 0) {
      const targetIds = Array.from(
        new Set(
          Object.values(tokenCheck.granularScopeTargets).flat(),
        ),
      ).slice(0, 100);
      for (let offset = 0; offset < targetIds.length; offset += 5) {
        if (Date.now() >= assetDiscoveryDeadline) {
          assetDiscoveryIncomplete = true;
          break;
        }
        const batch = targetIds.slice(offset, offset + 5);
        const resolved = await Promise.all(
          batch.map(async (targetId) => {
            try {
              return await metaGraphRequest<FacebookPage>(
                `/${encodeURIComponent(targetId)}`,
                {
                  accessToken: userAccessToken,
                  searchParams: { fields: "id,name,access_token" },
                },
              );
            } catch (error) {
              // A granular target can be a business rather than a Page.
              if (
                error instanceof MetaGraphRequestError &&
                error.retryable
              ) {
                assetDiscoveryIncomplete = true;
              }
              return null;
            }
          }),
        );
        for (const page of resolved) {
          if (page?.id && page.name && page.access_token) {
            addPages(collectedPages, [page]);
          }
        }
      }
    }
  } catch (err) {
    if (tokenCheck.ok) {
      await sb
        .from("meta_lead_grants")
        .update({
          discovery_status: "retrying",
          last_error_code: metaGraphErrorCode(err),
          next_discovery_at: new Date(Date.now() + 15 * 60_000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("credential_fingerprint", grantCredentialFingerprint)
        .eq("oauth_nonce", oauthNonce);
    }
    console.error("[meta-callback] Pages fetch request failed", {
      tenantId,
      code: metaGraphErrorCode(err),
    });
    return redirectToIntegracoes(req, "meta=error&reason=network", sessionRestore);
  }

  const pages = Array.from(collectedPages.values());
  if (tokenCheck.ok) {
    const discoveryStatus = assetDiscoveryIncomplete
      ? "retrying"
      : pages.length > 0
        ? "ready"
        : "action_required";
    const { error: grantStatusError } = await sb
      .from("meta_lead_grants")
      .update({
        discovery_status: discoveryStatus,
        last_error_code: assetDiscoveryIncomplete
          ? "asset_discovery_incomplete"
          : pages.length > 0
            ? null
            : "no_pages",
        discovered_page_count: pages.length,
        next_discovery_at: assetDiscoveryIncomplete
          ? new Date(Date.now() + 15 * 60_000).toISOString()
          : null,
        last_discovered_at: assetDiscoveryIncomplete
          ? null
          : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("credential_fingerprint", grantCredentialFingerprint)
      .eq("oauth_nonce", oauthNonce);
    if (grantStatusError) {
      console.warn("[meta-callback] Failed to update grant discovery status", {
        tenantId,
        error: grantStatusError.message,
      });
    }
  }

  if (
    usesBusinessLoginConfiguration &&
    tokenMode === "business_integration_system_user" &&
    !clientBusinessId
  ) {
    console.warn("[meta-callback] Business Login did not return client_business_id", {
      tenantId,
    });
    return redirectToIntegracoes(
      req,
      "meta=action_required&reason=client_business_missing",
      sessionRestore,
    );
  }

  if (!pages.length) {
    if (assetDiscoveryIncomplete) {
      return redirectToIntegracoes(
        req,
        "meta=error&reason=asset_discovery_incomplete",
        sessionRestore,
      );
    }
    if (!tokenCheck.ok) {
      return redirectToIntegracoes(
        req,
        `meta=action_required&reason=${encodeURIComponent(
          tokenCheck.code ?? "permission_missing",
        )}`,
        sessionRestore,
      );
    }
    console.warn("[meta-callback] No pages returned for tenant after all attempts", { tenantId });
    return redirectToIntegracoes(req, "meta=no_pages", sessionRestore);
  }

  // 4. Persist the discovered assets without overwriting the last-known-good
  // health of pages that were already connected. Absence from this grant is
  // never interpreted as revocation; only an explicit provider error or a
  // tenant-requested disconnect may revoke a page.
  const { data: existingPageRows } = await sb
    .from("meta_connections")
    .select("page_id")
    .eq("tenant_id", tenantId);
  const existingPageIds = new Set((existingPageRows ?? []).map((r) => (r as { page_id: string }).page_id));
  const newPages = pages.filter((p) => !existingPageIds.has(p.id));

  const rows = pages.map((p) => ({
    page_id: p.id,
    page_name: p.name,
    page_access_token: p.access_token,
  }));

  const { data: grantApplied, error: upsertErr } = await sb.rpc(
    "upsert_meta_grant_discovered_pages_v2",
    {
      p_tenant_id: tenantId,
      p_expected_grant_fingerprint: grantCredentialFingerprint,
      p_oauth_nonce: oauthNonce,
      p_pages: rows,
    },
  );

  if (upsertErr) {
    if (tokenCheck.ok) {
      await sb
        .from("meta_lead_grants")
        .update({
          discovery_status: "retrying",
          last_error_code: "meta_connections_upsert_failed",
          next_discovery_at: new Date(Date.now() + 15 * 60_000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("credential_fingerprint", grantCredentialFingerprint)
        .eq("oauth_nonce", oauthNonce);
    }
    console.error("[meta-callback] Failed to save meta_connections", upsertErr.message);
    return redirectToIntegracoes(req, "meta=error&reason=db_save", sessionRestore);
  }
  if (grantApplied !== true) {
    console.info("[meta-callback] Stale OAuth callback discarded", {
      tenantId,
    });
    return redirectToIntegracoes(
      req,
      "meta=partial&reason=connection_superseded",
      sessionRestore,
    );
  }

  // 5. Validate every selected Page with bounded concurrency. If a very large
  // grant exceeds the callback deadline, remaining rows stay unverified and
  // the periodic reconciler resumes idempotently.
  const healthByPage = new Map<
    string,
    Awaited<ReturnType<typeof verifyMetaPageLeadConnection>>
  >();
  const verificationDeadline = callbackStartedAt + 75_000;
  try {
    for (let offset = 0; offset < pages.length; offset += 4) {
      if (Date.now() >= verificationDeadline) break;
      const batch = pages.slice(offset, offset + 4);
      await Promise.all(
        batch.map(async (page) => {
          const health = await verifyMetaPageLeadConnection({
            pageId: page.id,
            pageAccessToken: page.access_token,
            tokenCheck,
            appWebhook,
          });
          const persisted = await persistMetaConnectionHealth({
            sb,
            tenantId,
            pageId: page.id,
            health,
            expectedCredentialFingerprint: metaCredentialFingerprint(
              page.access_token,
              userAccessToken,
            ),
          });
          healthByPage.set(page.id, {
            ...health,
            status: persisted.status,
            leadAccessStatus: persisted.leadAccessStatus,
          });

          const logPayload = {
            tenantId,
            pageId: page.id,
            healthStatus: health.status,
            healthCode: health.code,
            leadAccessStatus: health.leadAccessStatus,
            grantedScopeCount: health.grantedScopes.length,
            subscribedFields: health.subscribedFields,
          };
          if (health.status === "ready") {
            console.info("[meta-callback] Meta page verified ready", logPayload);
          } else {
            console.warn("[meta-callback] Meta page requires action", logPayload);
          }
        }),
      );
    }
  } catch (healthError) {
    console.error("[meta-callback] Failed to persist Meta health", {
      tenantId,
      error: healthError instanceof Error ? healthError.message : String(healthError),
    });
    return redirectToIntegracoes(req, "meta=error&reason=db_save", sessionRestore);
  }

  if (healthByPage.size === 0) {
    return redirectToIntegracoes(
      req,
      "meta=action_required&reason=verification_pending",
      sessionRestore,
    );
  }

  const readyPages = pages.filter((page) => healthByPage.get(page.id)?.status === "ready");
  if (readyPages.length > 0) {
    try {
      const restored = await restoreMetaLeadRuleArtifactsForReadyPages(
        sb,
        tenantId,
        readyPages.map((page) => page.id),
      );
      console.info("[meta-callback] Meta rule artifacts restored", {
        tenantId,
        readyPageCount: readyPages.length,
        syncedRuleCount: restored.syncedRuleCount,
      });
    } catch (restoreError) {
      console.error("[meta-callback] Failed to restore Meta rule artifacts", {
        tenantId,
        error: restoreError instanceof Error ? restoreError.message : String(restoreError),
      });
      return redirectToIntegracoes(
        req,
        "meta=action_required&reason=rule_sync_failed",
        sessionRestore,
      );
    }
  }
  const readyNewPages = readyPages.filter((page) => !existingPageIds.has(page.id));
  if (readyNewPages.length > 0) {
    try {
      await notifyTenantIntegrationConnected({
        tenantId,
        integration: "facebook",
        source: "meta_pages_oauth_verified",
        sourceKey: readyNewPages.map((page) => page.id).join(","),
        pageIds: readyNewPages.map((page) => page.id),
        pageNames: readyNewPages.map((page) => page.name),
        metadata: {
          ready_page_count: readyNewPages.length,
          total_pages_in_request: pages.length,
          onboarding: usesBusinessLoginConfiguration ? "facebook_login_for_business" : "legacy_oauth",
        },
      });
    } catch (notifyError) {
      console.warn("[meta-callback] verified connect notification failed", notifyError);
    }
  }

  if (readyPages.length === pages.length && !assetDiscoveryIncomplete) {
    await sb.rpc("complete_meta_lead_oauth", { p_tenant_id: tenantId, p_nonce: oauthNonce });
    return redirectToIntegracoes(req, "meta=connected", sessionRestore);
  }
  if (readyPages.length > 0) {
    return redirectToIntegracoes(
      req,
      `meta=partial&ready=${readyPages.length}&total=${pages.length}`,
      sessionRestore,
    );
  }

  const firstFailure = Array.from(healthByPage.values())[0];
  const reason = firstFailure?.code ?? appWebhook.code ?? tokenCheck.code ?? "verification_failed";
  return redirectToIntegracoes(
    req,
    `meta=action_required&reason=${encodeURIComponent(reason)}`,
    sessionRestore,
  );
}
